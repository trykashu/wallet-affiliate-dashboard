import { getAffiliateContext } from "@/lib/affiliate-context";
import { getCommissionRate } from "@/lib/tier";
import { computeProjections } from "@/lib/projections";
import type { Earning, ReferredUser } from "@/types/database";
import EarningsCard from "@/components/dashboard/EarningsCard";
import EarningsGraph from "@/components/dashboard/EarningsGraph";
import RevenueProjection from "@/components/dashboard/RevenueProjection";
import EarningsTable from "@/components/dashboard/EarningsTable";

export const dynamic = "force-dynamic";

interface EarningRow extends Earning {
  referred_users: { full_name: string } | null;
}

export default async function EarningsPage() {
  const ctx = await getAffiliateContext();
  if (!ctx) return null;
  const { db, affiliate, affiliateId } = ctx;

  // ── Fetch all earnings with user name join ──────────────────
  const { data: earningsRaw } = await db
    .from("earnings")
    .select("*, referred_users(full_name)")
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false });

  const rows: EarningRow[] = (earningsRaw ?? []) as EarningRow[];

  // ── Fetch referred users (for projections) ──────────────────
  const { data: usersRaw } = await db
    .from("referred_users")
    .select("*")
    .eq("affiliate_id", affiliateId);

  const users: ReferredUser[] = (usersRaw ?? []) as ReferredUser[];

  // ── Compute summary totals ──────────────────────────────────
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let total = 0;
  let thisMonth = 0;
  let pending = 0;
  let paid = 0;

  for (const e of rows) {
    const amt = Number(e.amount) || 0;
    total += amt;
    if (new Date(e.created_at) >= monthStart) thisMonth += amt;
    if (e.status === "pending") pending += amt;
    if (e.status === "paid") paid += amt;
  }

  const earningsSummary = { total, thisMonth, pending, paid };

  // ── Compute monthly earnings totals (last 12 months) ────────
  const monthlyMap = new Map<string, number>();

  // Initialize the last 12 months with zeros
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthlyMap.set(key, 0);
  }

  // Sum earnings into month buckets
  for (const e of rows) {
    const d = new Date(e.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (monthlyMap.has(key)) {
      monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + (Number(e.amount) || 0));
    }
  }

  const monthlyEarnings = Array.from(monthlyMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));

  // ── Compute revenue projections ─────────────────────────────
  const commissionRate = getCommissionRate(affiliate.tier);
  const projections = computeProjections(users, rows, commissionRate);

  // ── Map earnings to table format ────────────────────────────
  const earningsWithUser = rows.map((e) => ({
    ...e,
    user_name: e.referred_users?.full_name ?? "Unknown User",
  }));

  return (
    <>
      <div className="animate-reveal-up">
        <h1 className="text-2xl font-bold text-gray-900">Earnings</h1>
        <p className="text-sm text-brand-400 mt-1">
          Track your commissions and payout history.
        </p>
      </div>

      {/* Summary card */}
      <div className="max-w-md">
        <EarningsCard
          summary={earningsSummary}
          tier={affiliate.tier}
          referredVolume={affiliate.referred_volume_total}
        />
      </div>

      {/* 12-month earnings history chart */}
      <EarningsGraph data={monthlyEarnings} />

      {/* Revenue projection chart */}
      <RevenueProjection
        projections={projections}
        actuals={monthlyEarnings}
      />

      {/* Earnings table */}
      <EarningsTable earnings={earningsWithUser} />
    </>
  );
}
