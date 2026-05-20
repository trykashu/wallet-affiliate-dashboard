/**
 * Payout cadence per affiliate brand. Most affiliates pay monthly on the
 * 15th; Payovas pays every other Monday (biweekly) so transactions have
 * time to clear.
 *
 * Pure functions — given a brand slug and the current date, returns the
 * projected next payout, the period it covers, and a human label.
 */

export type PayoutCadence = "monthly_15" | "weekly_monday";

const DAY_MS = 24 * 60 * 60 * 1000;

export function getCadenceForBrand(brandSlug: string | null | undefined): PayoutCadence {
  return brandSlug === "payova" ? "weekly_monday" : "monthly_15";
}

export function getCadenceLabel(cadence: PayoutCadence): string {
  return cadence === "weekly_monday"
    ? "Payouts run every Monday for the prior Mon–Sun week, paid the following Monday so transactions have time to clear."
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
  if (cadence === "weekly_monday") {
    return nextWeeklyMonday(now);
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

function nextWeeklyMonday(now: Date): NextPayout {
  // Find next Monday >= today. Monday = day-of-week 1 (Sun=0).
  const dow = now.getDay();
  const daysUntilMon = dow === 1 ? 0 : (8 - dow) % 7;
  const payoutDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilMon);

  // Period covered = the Mon–Sun week ending 8 days before payoutDate.
  // 5/25 payout → 5/11 (Mon) – 5/17 (Sun)
  const periodStart = new Date(payoutDate.getTime() - 14 * DAY_MS);
  const periodEnd = new Date(payoutDate.getTime() - 8 * DAY_MS);

  const daysUntil = Math.max(0, Math.ceil((payoutDate.getTime() - now.getTime()) / DAY_MS));

  // ISO-week period stamp keyed to the period start, not the payout date,
  // so 5/11–5/17 = "2026-W20" regardless of when it's paid out.
  const isoWeek = isoWeekNumber(periodStart);
  const periodStamp = `${periodStart.getFullYear()}-W${String(isoWeek).padStart(2, "0")}`;

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
