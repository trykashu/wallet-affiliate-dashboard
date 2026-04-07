/**
 * Wallet Affiliate Revenue Projection Engine
 * Pure TypeScript — no DB access. Takes historical data and returns projections.
 *
 * Adapted from MRP for the wallet affiliate model:
 * - One-time commission earnings (no residuals)
 * - Based on referred user conversion + transaction fee commissions
 */

import type { ReferredUser, Earning } from "@/types/database";

export interface ProjectionMonth {
  month:      string;   // 'YYYY-MM'
  projected:  number;
  lower:      number;
  upper:      number;
  confidence: number;   // 0–1
}

export interface ProjectionSummary {
  three_month:  number;
  six_month:    number;
  twelve_month: number;
}

export interface ProjectionAssumptions {
  avg_referrals_per_month: number;
  conversion_rate:         number;   // fraction of referred users who run a transaction
  avg_transaction_fee:     number;
  commission_rate:         number;
}

export interface ProjectionResult {
  months:      ProjectionMonth[];
  summary:     ProjectionSummary;
  assumptions: ProjectionAssumptions;
}

/** Returns 'YYYY-MM' for a date offset by N months from now. */
function futureMonth(offsetMonths: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Compute revenue projections for future months.
 *
 * Algorithm:
 * 1. Compute avg monthly referral rate from last 6 months of referred user data
 * 2. Compute conversion rate (referred users who reached transaction_run or beyond)
 * 3. Estimate avg transaction fee from earnings history
 * 4. For each future month: project new converted users * avg fee * commission rate
 * 5. Confidence: 0.95 for month 1, decays -0.04/month (min 0.40)
 * 6. Confidence band: projected +/- (1 - confidence) * projected
 */
export function computeProjections(
  users:            ReferredUser[],
  earnings:         Earning[],
  commissionRate:   number,          // decimal (0.05 for 5%)
  horizonMonths:    number = 12
): ProjectionResult {

  // ── Historical referral rate (last 6 months) ─────────────────────────────
  const now = new Date();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(now.getMonth() - 6);

  const recentUsers = users.filter((u) =>
    new Date(u.created_at) >= sixMonthsAgo
  );

  const avgReferralsPerMonth = Math.max(recentUsers.length / 6, 0.1);

  // ── Conversion rate: users who have run at least one transaction ──────────
  const convertedSlugs: Set<string> = new Set([
    "transaction_run", "funds_in_wallet", "ach_initiated", "funds_in_bank",
  ]);
  const convertedUsers = users.filter((u) => convertedSlugs.has(u.status_slug));
  const conversionRate = users.length > 0
    ? Math.max(convertedUsers.length / users.length, 0.05)
    : 0.15;  // default if no data

  // ── Average transaction fee from earnings ────────────────────────────────
  const feesWithData = earnings.filter((e) => Number(e.transaction_fee_amount) > 0);
  const avgTransactionFee = feesWithData.length > 0
    ? feesWithData.reduce((s, e) => s + Number(e.transaction_fee_amount), 0) / feesWithData.length
    : 50;  // fallback

  // ── Project forward ───────────────────────────────────────────────────────
  const projectionMonths: ProjectionMonth[] = [];

  for (let i = 1; i <= horizonMonths; i++) {
    // Expected new converted users this month
    const newConverted = avgReferralsPerMonth * conversionRate;

    // Projected earning = new converted users * avg txn fee * commission rate
    const projected = Math.round(newConverted * avgTransactionFee * commissionRate * 100) / 100;

    // Confidence decays over time
    const confidence = Math.max(0.95 - (i - 1) * 0.04, 0.40);

    // Confidence band widens as confidence drops
    const spread = (1 - confidence) * projected;
    const lower = Math.max(0, Math.round((projected - spread) * 100) / 100);
    const upper = Math.round((projected + spread) * 100) / 100;

    projectionMonths.push({
      month:     futureMonth(i),
      projected,
      lower,
      upper,
      confidence,
    });
  }

  const sum = (months: ProjectionMonth[]) =>
    months.reduce((s, m) => s + m.projected, 0);

  return {
    months: projectionMonths,
    summary: {
      three_month:  Math.round(sum(projectionMonths.slice(0, 3))),
      six_month:    Math.round(sum(projectionMonths.slice(0, 6))),
      twelve_month: Math.round(sum(projectionMonths.slice(0, 12))),
    },
    assumptions: {
      avg_referrals_per_month: Math.round(avgReferralsPerMonth * 10) / 10,
      conversion_rate:         Math.round(conversionRate * 1000) / 10,    // as %
      avg_transaction_fee:     Math.round(avgTransactionFee * 100) / 100,
      commission_rate:         commissionRate,
    },
  };
}

/** Format 'YYYY-MM' into 'Jan 26' style label. */
export function monthLabel(yyyyMM: string): string {
  const [y, m] = yyyyMM.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}
