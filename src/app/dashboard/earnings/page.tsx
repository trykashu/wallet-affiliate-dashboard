import { getAffiliateContext } from "@/lib/affiliate-context";
import type { Earning, Transaction } from "@/types/database";
import EarningsCard from "@/components/dashboard/EarningsCard";
import EarningsTable from "@/components/dashboard/EarningsTable";
import TransactionLedger from "@/components/dashboard/TransactionLedger";

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

      {/* Transaction ledger */}
      <TransactionLedger transactions={transactionsWithUser} />

      {/* Earnings table */}
      <EarningsTable earnings={earningsWithUser} />
    </>
  );
}
