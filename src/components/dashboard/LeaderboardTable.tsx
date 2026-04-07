"use client";

import { Fragment, useMemo } from "react";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/fmt";
import TierBadge from "@/components/ui/TierBadge";
import type { LeaderboardSnapshot, AffiliateTier } from "@/types/database";

interface Props {
  snapshots:          LeaderboardSnapshot[];
  previousSnapshots?: LeaderboardSnapshot[];
  currentAffiliateId: string;
  totalCount?:        number;
  periods?:           string[];
  currentPeriod?:     string;
}

function formatPeriodLabel(period: string): string {
  const parts = period.replace("monthly_", "").split("_");
  if (parts.length !== 2) return period;
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function ConversionBar({ rate }: { rate: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-surface-200/60 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-accent/70"
          style={{ width: `${Math.min(rate, 100)}%` }}
        />
      </div>
      <span className="text-xs text-brand-400 tabular-nums">{rate.toFixed(0)}%</span>
    </div>
  );
}

function RankChange({ affiliateId, currentRank, prevRankMap }: {
  affiliateId: string;
  currentRank: number;
  prevRankMap: Map<string, number>;
}) {
  if (prevRankMap.size === 0) return null;

  const prevRank = prevRankMap.get(affiliateId);

  if (prevRank === undefined) {
    return (
      <span className="bg-accent/10 text-brand-600 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
        NEW
      </span>
    );
  }

  const diff = prevRank - currentRank;
  if (diff > 0) {
    return <span className="text-green-600 text-xs font-medium">{"\u2191"}{diff}</span>;
  }
  if (diff < 0) {
    return <span className="text-red-500 text-xs font-medium">{"\u2193"}{Math.abs(diff)}</span>;
  }
  return <span className="text-gray-400 text-xs">{"\u2014"}</span>;
}

/** Infer tier from volume for display purposes */
function tierFromVolume(volume: number): AffiliateTier {
  return volume >= 250_000 ? "platinum" : "gold";
}

export default function LeaderboardTable({ snapshots, previousSnapshots, currentAffiliateId, totalCount, periods, currentPeriod }: Props) {
  const router = useRouter();
  const displayCount = totalCount ?? snapshots.length;

  const prevRankMap = useMemo(() => {
    const map = new Map<string, number>();
    if (previousSnapshots) {
      for (const s of previousSnapshots) {
        map.set(s.affiliate_id, s.rank);
      }
    }
    return map;
  }, [previousSnapshots]);

  if (snapshots.length === 0) {
    return (
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-200/60">
          <h3 className="text-sm font-semibold text-gray-900">Affiliate Leaderboard</h3>
          <p className="text-xs text-brand-400 mt-0.5">Rankings not yet available</p>
        </div>
        <div className="px-5 py-12 text-center">
          <p className="text-sm text-brand-400">
            No leaderboard data yet. Rankings are refreshed periodically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-surface-200/60 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Affiliate Leaderboard</h3>
          <p className="text-xs text-brand-400 mt-0.5">
            Rankings anonymised — your row is highlighted
          </p>
        </div>
        <div className="flex items-center gap-3">
          {periods && periods.length > 1 && (
            <select
              value={currentPeriod ?? ""}
              onChange={(e) => router.push(`/dashboard/analytics?period=${e.target.value}`)}
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-brand-600/30"
            >
              {periods.map((p) => (
                <option key={p} value={p}>{formatPeriodLabel(p)}</option>
              ))}
            </select>
          )}
          <span className="text-xs text-brand-600">
            {displayCount.toLocaleString()} affiliates
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-200/60">
              <th className="th w-16">Rank</th>
              {prevRankMap.size > 0 && (
                <th className="th text-center w-14 hidden sm:table-cell">Change</th>
              )}
              <th className="th">Affiliate</th>
              <th className="th text-right hidden sm:table-cell">Users</th>
              <th className="th text-right">Volume</th>
              <th className="th text-right hidden sm:table-cell">Earnings</th>
              <th className="th hidden md:table-cell">Conv. Rate</th>
              <th className="th hidden lg:table-cell">Tier</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-200/60">
            {snapshots.map((s, idx) => {
              const isCurrent = s.affiliate_id === currentAffiliateId;
              const prevRank  = idx > 0 ? snapshots[idx - 1].rank : s.rank;
              const gapCount  = idx > 0 ? s.rank - prevRank - 1 : 0;
              const showGap   = gapCount > 0;

              return (
                <Fragment key={s.id}>
                  {showGap && (
                    <tr>
                      <td colSpan={prevRankMap.size > 0 ? 8 : 7} className="px-5 py-2 bg-surface-50/60">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 border-t border-dashed border-gray-200" />
                          <span className="text-[10px] text-brand-500 whitespace-nowrap tabular-nums px-1">
                            ···&nbsp;&nbsp;{gapCount.toLocaleString()} affiliate{gapCount !== 1 ? "s" : ""}
                          </span>
                          <div className="flex-1 border-t border-dashed border-gray-200" />
                        </div>
                      </td>
                    </tr>
                  )}

                  <tr
                    className={`transition-colors ${
                      isCurrent
                        ? "bg-accent/5 border-l-2 border-l-accent"
                        : "hover:bg-surface-100/40"
                    }`}
                  >
                    <td className="px-3 sm:px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        {s.rank <= 3 ? (
                          <span
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                              s.rank === 1 ? "bg-amber-400/20 text-amber-500" :
                              s.rank === 2 ? "bg-gray-400/20 text-gray-500"  :
                                             "bg-amber-700/20 text-amber-600"
                            }`}
                          >
                            {s.rank}
                          </span>
                        ) : (
                          <span className="text-brand-400 font-medium text-sm w-6 text-center">
                            {s.rank}
                          </span>
                        )}
                      </div>
                    </td>

                    {prevRankMap.size > 0 && (
                      <td className="px-3 sm:px-5 py-3.5 text-center hidden sm:table-cell">
                        <RankChange affiliateId={s.affiliate_id} currentRank={s.rank} prevRankMap={prevRankMap} />
                      </td>
                    )}

                    <td className="px-3 sm:px-5 py-3.5">
                      {isCurrent ? (
                        <span className="text-accent font-semibold text-sm">You</span>
                      ) : (
                        <span className="text-brand-400 text-sm">Affiliate #{s.rank}</span>
                      )}
                    </td>

                    <td className="px-3 sm:px-5 py-3.5 text-right text-sm text-brand-400 hidden sm:table-cell">
                      {fmt.count(s.referred_user_count)}
                    </td>

                    <td className="px-3 sm:px-5 py-3.5 text-right text-sm font-semibold text-gray-900">
                      {fmt.currencyCompact(s.referred_volume)}
                    </td>

                    <td className="px-3 sm:px-5 py-3.5 text-right text-sm text-brand-400 hidden sm:table-cell">
                      {fmt.currencyCompact(s.total_earnings)}
                    </td>

                    <td className="px-3 sm:px-5 py-3.5 hidden md:table-cell">
                      <ConversionBar rate={s.conversion_rate} />
                    </td>

                    <td className="px-3 sm:px-5 py-3.5 hidden lg:table-cell">
                      <TierBadge tier={tierFromVolume(s.referred_volume)} size="sm" />
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
