import { redirect }            from "next/navigation";
import { createClient }        from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail }        from "@/lib/admin";
import { fmt }                 from "@/lib/fmt";
import PayoutBatchManager      from "@/components/admin/PayoutBatchManager";
import type { PayoutRow, PendingAffiliatePayout } from "@/components/admin/PayoutBatchManager";
import type { Payout, Earning, Affiliate, PayoutSettings } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AdminPayoutsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) redirect("/dashboard");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const [payoutsResult, earningsResult, affiliatesResult, settingsResult] = await Promise.all([
    db.from("payouts").select("*").order("created_at", { ascending: false }),
    db.from("earnings").select("affiliate_id, amount, status").eq("status", "approved"),
    db.from("affiliates").select("id, agent_name"),
    db.from("payout_settings").select("*").limit(1).maybeSingle(),
  ]);

  const allPayouts:     Payout[]   = payoutsResult.data   ?? [];
  const approvedEarnings: Earning[] = earningsResult.data  ?? [];
  const affiliates:      Affiliate[] = affiliatesResult.data ?? [];
  const settings: PayoutSettings | null = settingsResult.data ?? null;

  const minPayout = settings?.min_payout_amount ?? 25;

  // Build affiliate name lookup
  const affiliateMap = new Map<string, string>();
  for (const a of affiliates) affiliateMap.set(a.id, a.agent_name);

  // Enrich payouts
  const payoutRows: PayoutRow[] = allPayouts.map((p) => ({
    id:                    p.id,
    affiliate_id:          p.affiliate_id,
    affiliate_name:        affiliateMap.get(p.affiliate_id) ?? "Unknown",
    amount:                p.amount,
    status:                p.status,
    provider_reference_id: p.provider_reference_id,
    period:                p.period,
    created_at:            p.created_at,
  }));

  // Compute approved balances grouped by affiliate
  const balanceByAffiliate = new Map<string, number>();
  for (const e of approvedEarnings) {
    balanceByAffiliate.set(e.affiliate_id, (balanceByAffiliate.get(e.affiliate_id) ?? 0) + e.amount);
  }

  const pendingPayouts: PendingAffiliatePayout[] = [];
  for (const [affId, balance] of balanceByAffiliate) {
    if (balance >= minPayout) {
      pendingPayouts.push({
        affiliate_id: affId,
        affiliate_name: affiliateMap.get(affId) ?? "Unknown",
        approved_balance: balance,
      });
    }
  }
  pendingPayouts.sort((a, b) => b.approved_balance - a.approved_balance);

  // Summary stats
  const totalPaid     = allPayouts.filter((p) => p.status === "completed").reduce((s, p) => s + p.amount, 0);
  const totalPending  = allPayouts.filter((p) => p.status === "requested" || p.status === "processing").reduce((s, p) => s + p.amount, 0);
  const totalApproved = approvedEarnings.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card accent-top">
          <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Ready for Payout</p>
          <p className="text-display-sm font-bold tabular-nums mt-1 text-accent">{fmt.currencyCompact(totalApproved)}</p>
          <p className="text-[10px] text-brand-400 mt-1.5">{pendingPayouts.length} affiliates above {fmt.currency(minPayout)} min</p>
        </div>
        <div className="stat-card accent-top">
          <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">In Progress</p>
          <p className="text-display-sm font-bold tabular-nums mt-1 text-amber-500">{fmt.currencyCompact(totalPending)}</p>
          <p className="text-[10px] text-brand-400 mt-1.5">Requested or processing</p>
        </div>
        <div className="stat-card accent-top">
          <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Total Paid</p>
          <p className="text-display-sm font-bold tabular-nums mt-1 text-gray-900">{fmt.currencyCompact(totalPaid)}</p>
          <p className="text-[10px] text-brand-400 mt-1.5">{allPayouts.filter((p) => p.status === "completed").length} completed payouts</p>
        </div>
      </div>

      <PayoutBatchManager payouts={payoutRows} pendingPayouts={pendingPayouts} />
    </div>
  );
}
