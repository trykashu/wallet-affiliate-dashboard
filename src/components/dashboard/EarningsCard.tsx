import { fmt } from "@/lib/fmt";
import { TIER_THRESHOLDS } from "@/lib/tier";
import type { AffiliateTier } from "@/types/database";

interface EarningsSummary {
  total:     number;
  thisMonth: number;
  pending:   number;
  paid:      number;
}

interface Props {
  summary: EarningsSummary;
  tier: AffiliateTier;
  referredVolume: number;
}

const TIER_BADGE: Record<AffiliateTier, { label: string; class: string }> = {
  gold:     { label: "Gold",     class: "bg-amber-50 text-amber-700 border-amber-200" },
  platinum: { label: "Platinum", class: "bg-gradient-to-r from-slate-100 to-slate-200 text-slate-700 border-slate-300" },
  custom:   { label: "Custom",   class: "bg-purple-500/10 text-purple-700 border-purple-500/20" },
};

/** Next payout is the 15th of the following month. */
function getNextPayoutDate(): { label: string; daysUntil: number; periodLabel: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  // If we're before the 15th of this month, next payout is the 15th of this month
  // covering the previous month's period.
  // If we're on or after the 15th, next payout is the 15th of next month.
  let payoutDate: Date;
  let periodStart: Date;
  let periodEnd: Date;

  if (now.getDate() < 15) {
    payoutDate = new Date(year, month, 15);
    periodStart = new Date(year, month - 1, 1);
    periodEnd = new Date(year, month, 0); // last day of previous month
  } else {
    payoutDate = new Date(year, month + 1, 15);
    periodStart = new Date(year, month, 1);
    periodEnd = new Date(year, month + 1, 0); // last day of current month
  }

  const diffMs = payoutDate.getTime() - now.getTime();
  const daysUntil = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const label = `${monthNames[payoutDate.getMonth()]} ${payoutDate.getDate()}, ${payoutDate.getFullYear()}`;
  const periodLabel = `${monthNames[periodStart.getMonth()]} ${periodStart.getDate()} – ${monthNames[periodEnd.getMonth()]} ${periodEnd.getDate()}`;

  return { label, daysUntil, periodLabel };
}

export default function EarningsCard({ summary, tier, referredVolume }: Props) {
  const hasPending   = summary.pending > 0;
  const hasThisMonth = summary.thisMonth > 0;
  const paidPct      = summary.total > 0 ? Math.round((summary.paid / summary.total) * 100) : 0;

  const tierInfo     = TIER_BADGE[tier];
  const volumeTarget = TIER_THRESHOLDS.platinum;
  const volumePct    = Math.min(100, Math.round((referredVolume / volumeTarget) * 100));
  const isPlatinum   = tier === "platinum";

  const payout = getNextPayoutDate();

  return (
    <div className="card flex flex-col h-full overflow-hidden">

      {/* Header */}
      <div className="px-5 py-4 border-b border-surface-200/60 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Earnings Overview</h3>
          <p className="text-[10px] text-brand-400 mt-0.5">
            {tier === "gold" ? "5%" : "10%"} commission on Kashu&apos;s fee
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold border rounded-full px-2.5 py-1 ${tierInfo.class}`}>
          {tierInfo.label} Tier
        </span>
      </div>

      {/* Hero total */}
      <div className="px-5 pt-5 pb-4">
        <div className="relative overflow-hidden pb-1">
          {summary.total > 0 && (
            <div className="absolute -top-6 left-0 w-44 h-24 bg-accent/6 rounded-full blur-3xl pointer-events-none" />
          )}
          <p className="text-[10px] font-bold text-brand-400 uppercase tracking-[0.1em] mb-2">
            Lifetime Earnings
          </p>
          <p className={`text-display-sm sm:text-display font-bold tracking-tight leading-none tabular-nums ${summary.total > 0 ? "text-gradient" : "text-gray-900"}`}>
            {fmt.currency(summary.total)}
          </p>
        </div>
      </div>

      {/* 3-column stats */}
      <div className="px-5 pb-4">
        <div className="grid grid-cols-3 gap-2.5">
          {/* This Month */}
          <div className="relative overflow-hidden bg-gradient-to-br from-accent/[0.06] to-accent/[0.02] border border-accent/12 rounded-xl px-3 py-3">
            <p className="text-[9px] font-bold text-brand-400 uppercase tracking-[0.1em] mb-1">This Month</p>
            <p className={`text-sm font-bold tabular-nums ${hasThisMonth ? "text-accent" : "text-gray-900"}`}>
              {fmt.currency(summary.thisMonth)}
            </p>
            {hasThisMonth && (
              <div className="absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            )}
          </div>

          {/* Pending */}
          <div className={`relative overflow-hidden border rounded-xl px-3 py-3 ${hasPending ? "bg-amber-50/40 border-amber-200/40" : "bg-surface-100/60 border-surface-200/60"}`}>
            <p className="text-[9px] font-bold text-brand-400 uppercase tracking-[0.1em] mb-1">Pending</p>
            <p className={`text-sm font-bold tabular-nums ${hasPending ? "text-amber-600" : "text-gray-900"}`}>
              {fmt.currency(summary.pending)}
            </p>
          </div>

          {/* Paid */}
          <div className="relative overflow-hidden bg-surface-100/60 border border-surface-200/60 rounded-xl px-3 py-3">
            <p className="text-[9px] font-bold text-brand-400 uppercase tracking-[0.1em] mb-1">Paid Out</p>
            <p className="text-sm font-bold tabular-nums text-gray-900">
              {fmt.currency(summary.paid)}
            </p>
          </div>
        </div>
      </div>

      {/* Paid progress bar */}
      <div className="px-5 pb-4">
        <div className="h-1 rounded-full bg-surface-200/60 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-accent/60 transition-all duration-700"
            style={{ width: `${Math.max(paidPct, 1)}%` }}
          />
        </div>
        <p className="text-[10px] text-brand-400/60 mt-1 tabular-nums">{paidPct}% of total paid</p>
      </div>

      {/* Next Payout */}
      <div className="px-5 py-3.5 border-t border-surface-200/60 bg-gradient-to-r from-brand-50/40 to-surface-50/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-600/8 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-900">Next Payout</p>
              <p className="text-[10px] text-brand-400">For period: {payout.periodLabel}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold text-gray-900">{payout.label}</p>
            <p className="text-[10px] text-brand-400">{payout.daysUntil === 0 ? "Today" : `${payout.daysUntil} days`}</p>
          </div>
        </div>
      </div>

      {/* Volume tracker — Platinum threshold for gold; lifetime total for custom; hidden for platinum */}
      {tier === "gold" && (
        <div className="px-5 py-3.5 border-t border-surface-200/60">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-brand-400 font-medium">Volume to Platinum</span>
            <span className="font-semibold text-gray-900 tabular-nums">
              {fmt.currencyCompact(referredVolume)} / {fmt.currencyCompact(volumeTarget)}
            </span>
          </div>
          <div className="h-1 rounded-full bg-surface-200/60 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-slate-400 to-slate-600 transition-all duration-700"
              style={{ width: `${Math.max(volumePct, 1)}%` }}
            />
          </div>
          <p className="text-[10px] text-brand-400/60 mt-1 tabular-nums">{volumePct}% to Platinum tier</p>
        </div>
      )}

      {tier === "custom" && (
        <div className="px-5 py-3.5 border-t border-surface-200/60">
          <div className="flex items-center justify-between text-xs">
            <span className="text-brand-400 font-medium">Lifetime referred volume</span>
            <span className="font-semibold text-gray-900 tabular-nums">
              {fmt.currencyCompact(referredVolume)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
