/**
 * Payout cadence per affiliate brand. Most affiliates pay monthly on the
 * 15th; Payova is paid weekly — the prior Sat–Fri week is paid on the
 * FOLLOWING Friday (e.g. the 5/30–6/5 week is paid 6/12).
 *
 * Pure functions — given a brand slug and the current date, returns the
 * projected next payout, the period it covers, and a human label.
 */

export type PayoutCadence = "monthly_15" | "weekly_friday";

const DAY_MS = 24 * 60 * 60 * 1000;

export function getCadenceForBrand(brandSlug: string | null | undefined): PayoutCadence {
  return brandSlug === "payova" ? "weekly_friday" : "monthly_15";
}

export function getCadenceLabel(cadence: PayoutCadence): string {
  return cadence === "weekly_friday"
    ? "Payouts run weekly: the prior Saturday–Friday week is paid on the following Friday."
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
  if (cadence === "weekly_friday") {
    return nextWeeklyFriday(now);
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

function nextWeeklyFriday(now: Date): NextPayout {
  // Next Friday >= today. Friday = day-of-week 5 (Sun=0).
  const dow = now.getDay();
  const daysUntilFri = (5 - dow + 7) % 7;
  const payoutDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilFri);

  // Period covered = the prior full Sat–Fri week (ends the Friday before payout).
  // 6/12 payout → 5/30 (Sat) – 6/5 (Fri)
  const periodStart = new Date(payoutDate.getTime() - 13 * DAY_MS); // Saturday
  const periodEnd = new Date(payoutDate.getTime() - 7 * DAY_MS);    // Friday

  const daysUntil = Math.max(0, Math.ceil((payoutDate.getTime() - now.getTime()) / DAY_MS));

  // ISO-week stamp keyed to the period start (Saturday), matching the payout
  // records written by the weekly cron (markPayovaWeekPaid).
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
