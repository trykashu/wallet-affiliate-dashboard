import type { FunnelStatusSlug } from "@/types/database";
import { funnelColor, funnelLabel } from "@/lib/funnel-colors";
import { fmt } from "@/lib/fmt";

/** The 5-stage funnel in order. */
const STAGES: FunnelStatusSlug[] = [
  "signed_up",
  "transaction_run",
  "funds_in_wallet",
  "ach_initiated",
  "funds_in_bank",
];

interface Props {
  /** Count of users at each stage (cumulative — users at later stages also count). */
  stageCounts: Record<FunnelStatusSlug, number>;
  total: number;
}

export default function FunnelChart({ stageCounts, total }: Props) {
  const maxCount = Math.max(1, ...STAGES.map((s) => stageCounts[s] ?? 0));

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-surface-200/60">
        <h3 className="text-sm font-semibold text-gray-900">User Funnel</h3>
        <p className="text-[11px] text-brand-400/70 mt-0.5">
          {fmt.count(total)} total referred users
        </p>
      </div>

      {/* Bars */}
      <div className="px-5 py-4 space-y-3">
        {STAGES.map((slug, idx) => {
          const count = stageCounts[slug] ?? 0;
          const pct   = total > 0 ? Math.round((count / total) * 100) : 0;
          const barW  = maxCount > 0 ? Math.max(2, (count / maxCount) * 100) : 2;
          const color = funnelColor(slug);

          return (
            <div
              key={slug}
              className="animate-reveal-up"
              style={{ animationDelay: `${idx * 80}ms` }}
            >
              {/* Label row */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-xs font-medium text-gray-700">
                    {funnelLabel(slug)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-900 tabular-nums">
                    {fmt.count(count)}
                  </span>
                  <span className="text-[10px] text-brand-400/60 tabular-nums w-8 text-right">
                    {pct}%
                  </span>
                </div>
              </div>

              {/* Bar */}
              <div className="h-2.5 rounded-full bg-surface-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${barW}%`,
                    backgroundColor: color,
                  }}
                >
                  {/* Subtle shine */}
                  <div
                    className="h-full rounded-full opacity-30"
                    style={{
                      background: `linear-gradient(90deg, transparent, rgba(255,255,255,0.5) 50%, transparent)`,
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
