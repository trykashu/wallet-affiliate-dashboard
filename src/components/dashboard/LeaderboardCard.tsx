import TierBadge from "@/components/ui/TierBadge";
import { fmt } from "@/lib/fmt";
import { TIER_THRESHOLDS } from "@/lib/tier";
import type { LeaderboardSnapshot, AffiliateTier } from "@/types/database";

interface Props {
  snapshot:        LeaderboardSnapshot | null;
  tier:            AffiliateTier;
  referredVolume:  number;
  totalAffiliates: number;
  prevRank?:       number | null;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export default function LeaderboardCard({ snapshot, tier, referredVolume, totalAffiliates, prevRank }: Props) {
  const isGold = tier === "gold";
  const progressPct = isGold
    ? Math.min((referredVolume / TIER_THRESHOLDS.platinum) * 100, 100)
    : 100;
  const volumeLeft = isGold
    ? Math.max(TIER_THRESHOLDS.platinum - referredVolume, 0)
    : 0;

  return (
    <div className="card p-6 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">My Ranking</h3>
          <p className="text-xs text-brand-400 mt-0.5">Current period standing</p>
        </div>
        <TierBadge tier={tier} size="md" />
      </div>

      {/* Rank */}
      {snapshot ? (
        <div className="flex items-end gap-4">
          <div>
            <p className="text-[10px] text-brand-400 uppercase tracking-widest">Rank</p>
            <p className="text-display font-bold tabular-nums text-gray-900 mt-0.5">
              {ordinal(snapshot.rank)}
            </p>
          </div>
          <div className="pb-1.5">
            <p className="text-xs text-brand-400">
              of {totalAffiliates} affiliates
            </p>
            {prevRank != null && prevRank !== snapshot.rank && (
              <p className={`text-xs font-semibold mt-0.5 ${
                snapshot.rank < prevRank ? "text-accent" : "text-red-500"
              }`}>
                {snapshot.rank < prevRank
                  ? `\u2191 ${prevRank - snapshot.rank} from last month`
                  : `\u2193 ${snapshot.rank - prevRank} from last month`}
              </p>
            )}
            {snapshot.percentile !== null && snapshot.percentile >= 75 && (
              <p className="text-xs font-semibold text-accent mt-0.5">
                Top {(100 - snapshot.percentile).toFixed(0)}%
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-surface-100 border border-surface-200/60 flex items-center justify-center">
            <svg className="w-6 h-6 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
          </div>
          <div>
            <p className="text-sm text-brand-400">Not yet ranked</p>
            <p className="text-xs text-brand-600 mt-0.5">Refer users to earn your spot</p>
          </div>
        </div>
      )}

      {/* Stats row */}
      {snapshot && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Users",     value: fmt.count(snapshot.referred_user_count) },
            { label: "Volume",    value: fmt.currencyCompact(snapshot.referred_volume) },
            { label: "Conv. Rate", value: `${snapshot.conversion_rate.toFixed(0)}%` },
          ].map((s) => (
            <div key={s.label} className="bg-surface-100/60 rounded-xl p-3 text-center">
              <p className="text-[10px] text-brand-400">{s.label}</p>
              <p className="text-base font-bold text-gray-900 mt-0.5">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Progress to next tier */}
      {isGold && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-brand-400 uppercase tracking-wider">Progress to</p>
            <TierBadge tier="platinum" size="sm" />
          </div>
          <div className="h-1.5 bg-surface-200/60 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent/70 to-accent transition-all duration-700"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-[10px] text-brand-600 mt-1.5">
            {volumeLeft > 0
              ? `${fmt.currencyCompact(volumeLeft)} more volume to unlock Platinum`
              : "Eligible for Platinum \u2014 refresh leaderboard"}
          </p>
        </div>
      )}
    </div>
  );
}
