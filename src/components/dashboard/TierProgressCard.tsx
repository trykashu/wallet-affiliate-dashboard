import { fmt } from "@/lib/fmt";
import { TIER_THRESHOLDS } from "@/lib/tier";
import type { AffiliateTier } from "@/types/database";

interface Props {
  tier: AffiliateTier;
  referredVolume: number;
  customCommissionRate?: number | null;
  customCommissionBasis?: "tpv" | "kashu_fee" | null;
}

const TIER_BADGE: Record<AffiliateTier, { label: string; class: string }> = {
  gold:     { label: "Gold",     class: "bg-amber-50 text-amber-700 border-amber-200" },
  platinum: { label: "Platinum", class: "bg-gradient-to-r from-slate-100 to-slate-200 text-slate-700 border-slate-300" },
  custom:   { label: "Custom",   class: "bg-purple-500/10 text-purple-700 border-purple-500/20" },
};

export default function TierProgressCard({
  tier,
  referredVolume,
  customCommissionRate,
  customCommissionBasis,
}: Props) {
  const tierInfo = TIER_BADGE[tier];

  // Gold → progress toward Platinum
  if (tier === "gold") {
    const target = TIER_THRESHOLDS.platinum;
    const pct = Math.min(100, Math.round((referredVolume / target) * 100));
    const remaining = Math.max(0, target - referredVolume);
    return (
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Tier Progress</h3>
            <p className="text-[10px] text-brand-400 mt-0.5 uppercase tracking-wider font-medium">
              5% commission on Kashu&apos;s fee
            </p>
          </div>
          <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold border rounded-full px-2.5 py-1 ${tierInfo.class}`}>
            {tierInfo.label} Tier
          </span>
        </div>

        <div className="flex items-end justify-between mb-2">
          <div>
            <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium mb-1">Volume to Platinum</p>
            <p className="text-stat font-bold text-gray-900 tabular-nums">
              {fmt.currencyCompact(referredVolume)}
              <span className="text-sm font-medium text-brand-400 ml-1.5">
                / {fmt.currencyCompact(target)}
              </span>
            </p>
          </div>
          <p className="text-xs font-semibold text-gray-900 tabular-nums">{pct}%</p>
        </div>

        <div className="h-2 rounded-full bg-surface-200/60 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-slate-400 to-slate-600 transition-all duration-700"
            style={{ width: `${Math.max(pct, 1)}%` }}
          />
        </div>
        <p className="text-[10px] text-brand-400 mt-2 tabular-nums">
          {remaining > 0
            ? `${fmt.currencyCompact(remaining)} more to unlock Platinum (10% commission)`
            : "Threshold reached — Platinum upgrade pending review"}
        </p>
      </div>
    );
  }

  // Custom → no progression; show agreement summary
  if (tier === "custom") {
    const ratePct = customCommissionRate ? (customCommissionRate * 100).toFixed(2).replace(/\.?0+$/, "") : null;
    const basisLabel = customCommissionBasis === "tpv" ? "TPV" : customCommissionBasis === "kashu_fee" ? "Kashu's fee" : null;
    return (
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Custom Agreement</h3>
            <p className="text-[10px] text-brand-400 mt-0.5 uppercase tracking-wider font-medium">
              {ratePct && basisLabel ? `${ratePct}% commission on ${basisLabel}` : "Custom commission terms"}
            </p>
          </div>
          <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold border rounded-full px-2.5 py-1 ${tierInfo.class}`}>
            {tierInfo.label} Tier
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-surface-100/60 border border-surface-200/60 rounded-xl px-3 py-3">
            <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium mb-1">Lifetime Volume</p>
            <p className="text-sm font-bold text-gray-900 tabular-nums">{fmt.currencyCompact(referredVolume)}</p>
          </div>
          <div className="bg-purple-500/[0.04] border border-purple-500/15 rounded-xl px-3 py-3">
            <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium mb-1">Commission Rate</p>
            <p className="text-sm font-bold text-purple-700 tabular-nums">
              {ratePct ? `${ratePct}%` : "—"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Platinum — top of standard tiers; show lifetime + an achieved indicator
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Tier Progress</h3>
          <p className="text-[10px] text-brand-400 mt-0.5 uppercase tracking-wider font-medium">
            10% commission on Kashu&apos;s fee
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold border rounded-full px-2.5 py-1 ${tierInfo.class}`}>
          {tierInfo.label} Tier
        </span>
      </div>

      <div className="flex items-end justify-between mb-2">
        <div>
          <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium mb-1">Lifetime Volume</p>
          <p className="text-stat font-bold text-gray-900 tabular-nums">
            {fmt.currencyCompact(referredVolume)}
          </p>
        </div>
        <span className="text-[10px] font-semibold text-accent">Top Tier Achieved</span>
      </div>

      <div className="h-2 rounded-full bg-accent/10 overflow-hidden">
        <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent/60" style={{ width: "100%" }} />
      </div>
    </div>
  );
}
