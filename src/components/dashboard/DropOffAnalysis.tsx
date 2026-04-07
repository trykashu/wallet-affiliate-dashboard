"use client";

import { useMemo } from "react";
import type { ReferredUser, FunnelEvent, FunnelStatusSlug } from "@/types/database";
import { funnelLabel } from "@/lib/funnel-colors";

interface Props {
  users:  ReferredUser[];
  events: FunnelEvent[];
}

const FUNNEL_STAGES: FunnelStatusSlug[] = [
  "waitlist",
  "booked_call",
  "sent_onboarding",
  "signed_up",
  "transaction_run",
  "funds_in_wallet",
  "ach_initiated",
  "funds_in_bank",
];

const STAGE_INDEX: Record<string, number> = {};
FUNNEL_STAGES.forEach((s, i) => { STAGE_INDEX[s] = i; });

const STAGE_INSIGHTS: Record<string, { hypothesis: string; action: string }> = {
  signed_up: {
    hypothesis: "Users sign up but never run a transaction. Common causes: unclear onboarding flow, wallet setup friction, or lack of immediate value proposition.",
    action: "Simplify the first-transaction experience. Send a follow-up within 24h with a step-by-step guide. Consider incentivizing the first transaction.",
  },
  transaction_run: {
    hypothesis: "Users run a transaction but never deposit funds into their wallet. Possible trust issues or unclear instructions on how to add funds.",
    action: "Provide clear in-app prompts after the first transaction. Send an email explaining wallet funding options. Offer a walkthrough video.",
  },
  funds_in_wallet: {
    hypothesis: "Users have funds in their wallet but never initiate ACH transfer to their bank. May not understand the withdrawal process or have concerns about fees/timing.",
    action: "Make the withdrawal button prominent. Show estimated arrival times. Send a reminder if funds sit for more than 48h.",
  },
  ach_initiated: {
    hypothesis: "Users initiate ACH but funds never arrive in their bank. Could be bank verification issues, ACH failures, or users not waiting for settlement.",
    action: "Send clear status updates during ACH processing. Provide support contact for failed transfers. Consider faster payout methods.",
  },
};

/**
 * For each user that stopped progressing, find the last stage they reached.
 * A user is considered \"dropped off\" if their current stage is not the final stage.
 */
function getDropOff(users: ReferredUser[], events: FunnelEvent[]) {
  const finalStageIdx = FUNNEL_STAGES.length - 1;

  // Find the highest stage each user reached
  const userHighest: Record<string, number> = {};
  for (const u of users) {
    const currentIdx = STAGE_INDEX[u.status_slug] ?? 0;
    userHighest[u.id] = currentIdx;
  }

  for (const e of events) {
    if (!Object.prototype.hasOwnProperty.call(userHighest, e.referred_user_id)) continue;
    if (e.to_status) {
      const idx = STAGE_INDEX[e.to_status] ?? -1;
      if (idx > (userHighest[e.referred_user_id] ?? -1)) {
        userHighest[e.referred_user_id] = idx;
      }
    }
  }

  // Users who didn't reach the final stage are drop-offs at their highest stage
  const dropsByStage: Record<string, number> = {};
  for (const [, highest] of Object.entries(userHighest)) {
    if (highest < finalStageIdx) {
      const slug = FUNNEL_STAGES[highest];
      dropsByStage[slug] = (dropsByStage[slug] ?? 0) + 1;
    }
  }

  return dropsByStage;
}

function severityColor(count: number, stageTotal: number): string {
  if (stageTotal === 0) return "text-gray-400";
  const rate = count / stageTotal;
  if (rate >= 0.4) return "text-red-500";
  if (rate >= 0.2) return "text-amber-500";
  return "text-yellow-500";
}

export default function DropOffAnalysis({ users, events }: Props) {
  const { totalDropped, totalUsers, sorted } = useMemo(() => {
    const dropsByStage = getDropOff(users, events);
    const finalStageIdx = FUNNEL_STAGES.length - 1;

    const totalDropped = users.filter((u) => {
      const idx = STAGE_INDEX[u.status_slug] ?? 0;
      return idx < finalStageIdx;
    }).length;

    const sorted = FUNNEL_STAGES.slice(0, -1) // exclude final stage (can't drop off from there)
      .map((slug) => ({ slug: slug as FunnelStatusSlug, count: dropsByStage[slug] ?? 0 }))
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count);

    return { totalDropped, totalUsers: users.length, sorted };
  }, [users, events]);

  const overallDropRate = totalUsers > 0
    ? Math.round((totalDropped / totalUsers) * 100)
    : 0;

  if (users.length === 0) {
    return (
      <div className="card p-8 text-center">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Drop-Off Analysis</h3>
        <p className="text-xs text-brand-400">No data available yet.</p>
      </div>
    );
  }

  return (
    <div className="card p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Drop-Off Analysis</h3>
          <p className="text-xs text-brand-400 mt-0.5">Where users stop progressing</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold text-red-600">{overallDropRate}%</p>
          <p className="text-[10px] text-brand-400">overall drop rate</p>
        </div>
      </div>

      {/* Bar chart + insights */}
      <div className="space-y-4">
        {sorted.map(({ slug, count }) => {
          const stageDropRate = totalUsers > 0 ? Math.round((count / totalUsers) * 100) : 0;
          const insight = STAGE_INSIGHTS[slug];
          const severity = severityColor(count, totalUsers);

          return (
            <div key={slug} className="group">
              {/* Bar row */}
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-700">{funnelLabel(slug)}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold ${severity}`}>{count} stopped</span>
                  {stageDropRate > 0 && (
                    <span className="text-[10px] text-brand-400">({stageDropRate}% of total)</span>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-2 bg-surface-200/60 rounded-full overflow-hidden mb-2">
                <div
                  className="h-full rounded-full bg-red-400/70 transition-all duration-500"
                  style={{ width: `${totalUsers > 0 ? Math.max((count / totalUsers) * 100, 2) : 0}%` }}
                />
              </div>

              {/* Hypothesis + action card */}
              {insight && count > 0 && (
                <div className="mt-2 rounded-lg border border-surface-200/60 bg-surface-50/60 p-3">
                  <div className="flex items-start gap-2 mb-2">
                    <div className="w-4 h-4 rounded bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-2.5 h-2.5 text-amber-600" aria-hidden="true" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-brand-400 uppercase tracking-wider mb-0.5">Why this happens</p>
                      <p className="text-xs text-gray-700 leading-relaxed">{insight.hypothesis}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="w-4 h-4 rounded bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-2.5 h-2.5 text-emerald-600" aria-hidden="true" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-brand-400 uppercase tracking-wider mb-0.5">Recommended action</p>
                      <p className="text-xs text-gray-700 leading-relaxed">{insight.action}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary */}
      {sorted.length > 0 && (
        <div className="mt-5 pt-4 border-t border-surface-200/60">
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900">{totalDropped}</p>
              <p className="text-[10px] text-brand-400">Total Stopped</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-red-600">{overallDropRate}%</p>
              <p className="text-[10px] text-brand-400">Drop Rate</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900">
                {sorted[0] ? funnelLabel(sorted[0].slug) : "\u2014"}
              </p>
              <p className="text-[10px] text-brand-400">Biggest Bottleneck</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4 mt-3">
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="w-2 h-2 rounded-full bg-yellow-500" />
              <span className="text-brand-400">&lt;20% drop</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-brand-400">20-40% drop</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-brand-400">&gt;40% drop</span>
            </div>
          </div>
        </div>
      )}

      {sorted.length === 0 && totalUsers > 0 && (
        <div className="text-center py-6">
          <p className="text-sm text-brand-400">All users have completed the full funnel. Great job!</p>
        </div>
      )}
    </div>
  );
}
