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
}

export default async function AdminAffiliatesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) redirect("/dashboard");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const [affiliatesResult, usersResult, earningsResult] = await Promise.all([
    db.from("affiliates").select("*").order("created_at", { ascending: false }),
    db.from("referred_users").select("id, affiliate_id, first_transaction_amount"),
    db.from("earnings").select("affiliate_id, amount, status"),
  ]);

  const affiliates:  Affiliate[]    = affiliatesResult.data ?? [];
  const users:       ReferredUser[] = usersResult.data      ?? [];
  const allEarnings: Earning[]      = earningsResult.data   ?? [];

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
    };
  });

  return <AffiliateTable affiliates={enriched} />;
}
