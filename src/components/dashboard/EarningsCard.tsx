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
  platinum: { label: "Platinum", class: "bg-purple-50 text-purple-700 border-purple-200" },
};

export default function EarningsCard({ summary, tier, referredVolume }: Props) {
  const hasPending   = summary.pending > 0;
  const hasThisMonth = summary.thisMonth > 0;
  const paidPct      = summary.total > 0 ? Math.round((summary.paid / summary.total) * 100) : 0;

  const tierInfo     = TIER_BADGE[tier];
  const volumeTarget = TIER_THRESHOLDS.platinum;
  const volumePct    = Math.min(100, Math.round((referredVolume / volumeTarget) * 100));
  const isPlatinum   = tier === "platinum";

  return (
    <div className="card flex flex-col h-full overflow-hidden">

      {/* Header with tier badge */}
      <div className="px-5 py-4 border-b border-surface-200/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Earnings</h3>
        <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold border rounded-full px-2.5 py-1 ${tierInfo.class}`}>
          {tierInfo.label} Tier
        </span>
      </div>

      {/* Hero total */}
      <div className="px-4 sm:px-5 pt-4 pb-3">
        <div className="relative overflow-hidden pb-4">
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

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3">
          {/* This Month */}
          <div className="relative overflow-hidden bg-gradient-to-br from-accent/[0.06] to-accent/[0.02] border border-accent/12 rounded-2xl px-3.5 py-3.5">
            <p className="text-[10px] font-bold text-brand-400 uppercase tracking-[0.1em] mb-1.5">This Month</p>
            <p className={`text-stat font-bold tabular-nums ${hasThisMonth ? "text-gradient-mint" : "text-gray-900"}`}>
              {fmt.currency(summary.thisMonth)}
            </p>
            {hasThisMonth && (
              <div className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            )}
          </div>

          {/* Pending */}
          <div className={`relative overflow-hidden border rounded-2xl px-3.5 py-3.5 ${hasPending ? "bg-amber-50/40 border-amber-200/40" : "bg-surface-100/60 border-surface-200/60"}`}>
            <p className="text-[10px] font-bold text-brand-400 uppercase tracking-[0.1em] mb-1.5">Pending</p>
            <p className={`text-stat font-bold tabular-nums ${hasPending ? "text-amber-500" : "text-gray-900"}`}>
              {fmt.currency(summary.pending)}
            </p>
          </div>
        </div>
      </div>

      {/* Paid progress */}
      <div className="px-5 py-4 border-t border-surface-200/60">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="text-brand-400 font-medium">Paid out</span>
          <span className="font-semibold text-gray-900 tabular-nums">{fmt.currency(summary.paid)}</span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-200/60 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-accent/60 transition-all duration-700"
            style={{ width: `${paidPct}%` }}
          />
        </div>
        <p className="text-[10px] text-brand-400/60 mt-1.5 tabular-nums">{paidPct}% of total paid</p>
      </div>

      {/* Volume progress to Platinum */}
      {!isPlatinum && (
        <div className="px-5 py-4 border-t border-surface-200/60 bg-surface-50/60">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-brand-400 font-medium">Volume to Platinum</span>
            <span className="font-semibold text-gray-900 tabular-nums">
              {fmt.currencyCompact(referredVolume)} / {fmt.currencyCompact(volumeTarget)}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-200/60 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-purple-400 to-purple-600 transition-all duration-700"
              style={{ width: `${volumePct}%` }}
            />
          </div>
          <p className="text-[10px] text-brand-400/60 mt-1.5 tabular-nums">{volumePct}% to Platinum tier</p>
        </div>
      )}
    </div>
  );
}
