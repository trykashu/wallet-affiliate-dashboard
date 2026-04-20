import { getAffiliateContext } from "@/lib/affiliate-context";
import type { Earning, Transaction, LeaderboardSnapshot } from "@/types/database";
import EarningsCard from "@/components/dashboard/EarningsCard";
import EarningsTable from "@/components/dashboard/EarningsTable";
import TransactionLedger from "@/components/dashboard/TransactionLedger";
import LeaderboardCard from "@/components/dashboard/LeaderboardCard";

export const dynamic = "force-dynamic";

interface EarningRow extends Earning {
  referred_users: { full_name: string } | null;
}

function currentPeriod(): string {
  const now = new Date();
  return `monthly_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function previousPeriod(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `monthly_${prev.getFullYear()}_${String(prev.getMonth() + 1).padStart(2, "0")}`;
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

  // ── Fetch transactions with user info ──────────────────────
  const { data: txnRaw } = await db
    .from("transactions")
    .select("*, referred_users(full_name, email)")
    .eq("affiliate_id", affiliateId)
    .order("transaction_date", { ascending: false });

  interface TxnRow extends Transaction {
    referred_users: { full_name: string; email: string } | null;
  }
  const txnRows: TxnRow[] = (txnRaw ?? []) as TxnRow[];
  const transactionsWithUser = txnRows.map((t) => ({
    ...t,
    user_name: t.referred_users?.full_name ?? null,
    user_email: t.referred_users?.email ?? null,
  }));

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

  // ── Fetch leaderboard snapshot for ranking ──────────────────
  const period = currentPeriod();
  const { data: mySnapshotRaw } = await db
    .from("leaderboard_snapshots")
    .select("*")
    .eq("period", period)
    .eq("affiliate_id", affiliateId)
    .single();

  const mySnapshot: LeaderboardSnapshot | null = (mySnapshotRaw as LeaderboardSnapshot) ?? null;

  const { data: prevSnapshotRaw } = await db
    .from("leaderboard_snapshots")
    .select("rank")
    .eq("period", previousPeriod())
    .eq("affiliate_id", affiliateId)
    .single();

  const prevRank: number | null = (prevSnapshotRaw as { rank: number } | null)?.rank ?? null;

  const { count: totalAffiliates } = await db
    .from("affiliates")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");

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
          Track your commissions, transactions, and ranking.
        </p>
      </div>

      {/* Summary + Ranking side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <EarningsCard
          summary={earningsSummary}
          tier={affiliate.tier}
          referredVolume={affiliate.referred_volume_total}
        />
        <LeaderboardCard
          snapshot={mySnapshot}
          tier={affiliate.tier}
          referredVolume={affiliate.referred_volume_total}
          totalAffiliates={totalAffiliates ?? 0}
          prevRank={prevRank}
        />
      </div>

      {/* Transaction ledger */}
      <TransactionLedger transactions={transactionsWithUser} />

      {/* Earnings table */}
      <EarningsTable earnings={earningsWithUser} />
    </>
  );
}
