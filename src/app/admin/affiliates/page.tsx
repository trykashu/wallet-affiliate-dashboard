import { redirect }            from "next/navigation";
import { createClient }        from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail }        from "@/lib/admin";
import { getBrandScope, inScope } from "@/lib/admin/brand-scope";
import { getBankReviewReasons } from "@/lib/bank-quality";
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
  bank_review_reasons: string[];
}

export default async function AdminAffiliatesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) redirect("/dashboard");

  const scope = await getBrandScope();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const [affiliatesResult, usersResult, earningsResult, payoutAccountsResult] = await Promise.all([
    db.from("affiliates").select("*").order("created_at", { ascending: false }),
    db.from("referred_users").select("id, affiliate_id"),
    db.from("earnings").select("affiliate_id, amount, status"),
    db.from("payout_accounts").select("affiliate_id, account_name, metadata").eq("is_verified", true),
  ]);

  const affiliates:  Affiliate[]    = (affiliatesResult.data ?? []).filter((a: Affiliate) => inScope(a.whitelabel_brand_id, scope));
  const users:       ReferredUser[] = usersResult.data      ?? [];
  const allEarnings: Earning[]      = earningsResult.data   ?? [];

  type AccountRow = {
    affiliate_id: string;
    account_name: string | null;
    metadata: { full_account_number?: string } | null;
  };

  // Build set of affiliates with bank accounts on file + accumulate review reasons
  const affiliatesWithBank = new Set<string>();
  const reasonsByAffiliate = new Map<string, string[]>();
  for (const pa of (payoutAccountsResult.data as AccountRow[] | null) ?? []) {
    if (pa.affiliate_id) affiliatesWithBank.add(pa.affiliate_id);
    const reasons = getBankReviewReasons(pa);
    if (reasons.length > 0) {
      const existing = reasonsByAffiliate.get(pa.affiliate_id) ?? [];
      reasonsByAffiliate.set(pa.affiliate_id, [...existing, ...reasons]);
    }
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
    // Use the maintained running total — first_transaction_amount is only
    // the per-user first-deposit snapshot and undercounts true volume.
    const volume = Number(a.referred_volume_total) || 0;
    // Spread preserves all Affiliate fields including `status`, which
    // AffiliateTable uses to render the "Archived" badge.
    return {
      ...a,
      referredUserCount: refUsers.length,
      volume,
      totalEarnings: earningsByAffiliate.get(a.id) ?? 0,
      hasBankAccount: affiliatesWithBank.has(a.id),
      hasLogin: !!a.user_id,
      hasPassword: !!a.has_password,
      lastLoginAt: a.last_login_at,
      bank_review_reasons: reasonsByAffiliate.get(a.id) ?? [],
    };
  });

  return <AffiliateTable affiliates={enriched} />;
}
