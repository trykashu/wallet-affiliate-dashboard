import { redirect }            from "next/navigation";
import { createClient }        from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail }        from "@/lib/admin";
import AffiliateTable          from "@/components/admin/AffiliateTable";
import type { Affiliate, ReferredUser, Earning } from "@/types/database";

export const dynamic = "force-dynamic";

export interface AffiliateWithCounts extends Affiliate {
  referredUserCount: number;
  volume: number;
  totalEarnings: number;
  hasBankAccount: boolean;
  hasLogin: boolean;        // user_id is set (invite accepted)
  hasPassword: boolean;     // account fully set up
  lastLoginAt: string | null;
}

export default async function AdminAffiliatesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) redirect("/dashboard");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const [affiliatesResult, usersResult, earningsResult, payoutAccountsResult] = await Promise.all([
    db.from("affiliates").select("*").order("created_at", { ascending: false }),
    db.from("referred_users").select("id, affiliate_id, first_transaction_amount"),
    db.from("earnings").select("affiliate_id, amount, status"),
    db.from("payout_accounts").select("affiliate_id").eq("is_verified", true),
  ]);

  const affiliates:  Affiliate[]    = affiliatesResult.data ?? [];
  const users:       ReferredUser[] = usersResult.data      ?? [];
  const allEarnings: Earning[]      = earningsResult.data   ?? [];

  // Build set of affiliates with bank accounts on file
  const affiliatesWithBank = new Set<string>();
  for (const pa of payoutAccountsResult.data ?? []) {
    if (pa.affiliate_id) affiliatesWithBank.add(pa.affiliate_id);
  }

  // Build lookup maps
  const usersByAffiliate = new Map<string, ReferredUser[]>();
  for (const u of users) {
    const arr = usersByAffiliate.get(u.affiliate_id) ?? [];
    arr.push(u);
    usersByAffiliate.set(u.affiliate_id, arr);
  }

  const earningsByAffiliate = new Map<string, number>();
  for (const e of allEarnings) {
    earningsByAffiliate.set(e.affiliate_id, (earningsByAffiliate.get(e.affiliate_id) ?? 0) + e.amount);
  }

  const enriched: AffiliateWithCounts[] = affiliates.map((a) => {
    const refUsers = usersByAffiliate.get(a.id) ?? [];
    const volume = refUsers.reduce((sum, u) => sum + (u.first_transaction_amount ?? 0), 0);
    return {
      ...a,
      referredUserCount: refUsers.length,
      volume,
      totalEarnings: earningsByAffiliate.get(a.id) ?? 0,
      hasBankAccount: affiliatesWithBank.has(a.id),
      hasLogin: !!a.user_id,
      hasPassword: !!a.has_password,
      lastLoginAt: a.last_login_at,
    };
  });

  return <AffiliateTable affiliates={enriched} />;
}
