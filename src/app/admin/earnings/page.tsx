import { redirect }            from "next/navigation";
import { createClient }        from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail }        from "@/lib/admin";
import { fmt }                 from "@/lib/fmt";
import AdminEarningsTable      from "@/components/admin/AdminEarningsTable";
import type { AdminEarning }   from "@/components/admin/AdminEarningsTable";
import type { Earning, Affiliate, ReferredUser, Transaction } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AdminEarningsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) redirect("/dashboard");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const [earningsResult, affiliatesResult, usersResult] = await Promise.all([
    db.from("earnings").select("*").order("created_at", { ascending: false }),
    db.from("affiliates").select("id, agent_name"),
    db.from("referred_users").select("id, full_name"),
  ]);

  const allEarnings:  Earning[]      = earningsResult.data   ?? [];
  const affiliates:   Affiliate[]    = affiliatesResult.data ?? [];
  const referredUsers: ReferredUser[] = usersResult.data     ?? [];

  const affiliateMap = new Map<string, string>();
  for (const a of affiliates) affiliateMap.set(a.id, a.agent_name);

  const userMap = new Map<string, string>();
  for (const u of referredUsers) userMap.set(u.id, u.full_name);

  // Look up TPV per earning by joining on transaction_ref ↔ transactions.airtable_record_id
  const earningRefs = allEarnings.map((e) => e.transaction_ref).filter((r): r is string => !!r);
  const tpvByRef = new Map<string, number>();
  if (earningRefs.length > 0) {
    const { data: refTxns } = await db
      .from("transactions")
      .select("airtable_record_id, amount")
      .in("airtable_record_id", earningRefs);
    for (const t of (refTxns ?? []) as Pick<Transaction, "airtable_record_id" | "amount">[]) {
      tpvByRef.set(t.airtable_record_id, Number(t.amount) || 0);
    }
  }

  const enriched: AdminEarning[] = allEarnings.map((e) => ({
    id:                     e.id,
    created_at:             e.created_at,
    affiliate_id:           e.affiliate_id,
    affiliate_name:         affiliateMap.get(e.affiliate_id) ?? "Unknown",
    referred_user_name:     userMap.get(e.referred_user_id) ?? "Unknown",
    transaction_fee_amount: e.transaction_fee_amount,
    tier_at_earning:        e.tier_at_earning,
    amount:                 e.amount,
    status:                 e.status,
    tpv:                    e.transaction_ref ? (tpvByRef.get(e.transaction_ref) ?? null) : null,
  }));

  // Summary stats
  const pending  = allEarnings.filter((e) => e.status === "pending").reduce((s, e) => s + e.amount, 0);
  const approved = allEarnings.filter((e) => e.status === "approved").reduce((s, e) => s + e.amount, 0);
  const paid     = allEarnings.filter((e) => e.status === "paid").reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card accent-top">
          <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Pending</p>
          <p className="text-display-sm font-bold tabular-nums mt-1 text-amber-500">{fmt.currencyCompact(pending)}</p>
          <p className="text-[10px] text-brand-400 mt-1.5">{allEarnings.filter((e) => e.status === "pending").length} earnings</p>
        </div>
        <div className="stat-card accent-top">
          <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Approved</p>
          <p className="text-display-sm font-bold tabular-nums mt-1 text-accent">{fmt.currencyCompact(approved)}</p>
          <p className="text-[10px] text-brand-400 mt-1.5">{allEarnings.filter((e) => e.status === "approved").length} earnings</p>
        </div>
        <div className="stat-card accent-top">
          <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Paid</p>
          <p className="text-display-sm font-bold tabular-nums mt-1 text-gray-900">{fmt.currencyCompact(paid)}</p>
          <p className="text-[10px] text-brand-400 mt-1.5">{allEarnings.filter((e) => e.status === "paid").length} earnings</p>
        </div>
      </div>

      <AdminEarningsTable earnings={enriched} />
    </div>
  );
}
