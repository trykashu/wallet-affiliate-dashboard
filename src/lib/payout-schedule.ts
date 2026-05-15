/**
 * Payout cadence per affiliate brand. Most affiliates pay monthly on the
 * 15th; Payovas pays every other Monday (biweekly) so transactions have
 * time to clear.
 *
 * Pure functions — given a brand slug and the current date, returns the
 * projected next payout, the period it covers, and a human label.
 */

export type PayoutCadence = "monthly_15" | "biweekly_monday";

// Anchor Monday for the biweekly_monday cadence. Pick a known past Monday;
// every other Monday from this date (+14n days) is a payout.
//   Mon 2026-01-05  ← first Monday of 2026
const BIWEEKLY_ANCHOR = new Date(Date.UTC(2026, 0, 5));
const DAY_MS = 24 * 60 * 60 * 1000;

export function getCadenceForBrand(brandSlug: string | null | undefined): PayoutCadence {
  return brandSlug === "payova" ? "biweekly_monday" : "monthly_15";
}

export function getCadenceLabel(cadence: PayoutCadence): string {
  return cadence === "biweekly_monday"
    ? "Payouts run every other Monday so transactions have time to clear."
    : "Payouts are processed automatically on the 15th of each month.";
}

export interface NextPayout {
  /** Localized date label, e.g. "May 25, 2026" */
  label: string;
  daysUntil: number;
  /** Localized period covered, e.g. "May 11 – May 24" or "April 1 – April 30" */
  periodLabel: string;
  /** Period stamp for storage / matching to payout.period, e.g. "2026-W21" or "2026-04" */
  periodStamp: string;
  /** The Date object for the projected payout. */
  payoutDate: Date;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function fmtMonthDay(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

export function getNextPayoutDate(cadence: PayoutCadence, now: Date = new Date()): NextPayout {
  if (cadence === "biweekly_monday") {
    return nextBiweeklyMonday(now);
  }
  return nextMonthly15(now);
}

function nextMonthly15(now: Date): NextPayout {
  const year = now.getFullYear();
  const month = now.getMonth();

  let payoutDate: Date;
  let periodStart: Date;
  let periodEnd: Date;

  if (now.getDate() < 15) {
    payoutDate = new Date(year, month, 15);
    periodStart = new Date(year, month - 1, 1);
    periodEnd = new Date(year, month, 0);
  } else {
    payoutDate = new Date(year, month + 1, 15);
    periodStart = new Date(year, month, 1);
    periodEnd = new Date(year, month + 1, 0);
  }

  const daysUntil = Math.max(0, Math.ceil((payoutDate.getTime() - now.getTime()) / DAY_MS));
  const periodStamp = `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, "0")}`;

  return {
    label: fmtDate(payoutDate),
    daysUntil,
    periodLabel: `${fmtMonthDay(periodStart)} – ${fmtMonthDay(periodEnd)}`,
    periodStamp,
    payoutDate,
  };
}

function nextBiweeklyMonday(now: Date): NextPayout {
  const today0 = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const daysSinceAnchor = Math.floor((today0.getTime() - BIWEEKLY_ANCHOR.getTime()) / DAY_MS);
  const cyclesPast = Math.floor(daysSinceAnchor / 14);

  let payoutUTC = new Date(BIWEEKLY_ANCHOR.getTime() + cyclesPast * 14 * DAY_MS);
  if (payoutUTC.getTime() < today0.getTime()) {
    payoutUTC = new Date(payoutUTC.getTime() + 14 * DAY_MS);
  }

  // Local-date projection
  const payoutDate = new Date(payoutUTC.getUTCFullYear(), payoutUTC.getUTCMonth(), payoutUTC.getUTCDate());
  const periodStart = new Date(payoutDate.getTime() - 14 * DAY_MS);
  const periodEnd = new Date(payoutDate.getTime() - DAY_MS);

  const daysUntil = Math.max(0, Math.ceil((payoutDate.getTime() - now.getTime()) / DAY_MS));

  // ISO-week period stamp for biweekly payouts
  const isoWeek = isoWeekNumber(payoutDate);
  const periodStamp = `${payoutDate.getFullYear()}-W${String(isoWeek).padStart(2, "0")}`;

  return {
    label: fmtDate(payoutDate),
    daysUntil,
    periodLabel: `${fmtMonthDay(periodStart)} – ${fmtMonthDay(periodEnd)}`,
    periodStamp,
    payoutDate,
  };
}

function isoWeekNumber(d: Date): number {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
}
