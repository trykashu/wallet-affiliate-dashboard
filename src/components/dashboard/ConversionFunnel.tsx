"use client";

import { useMemo } from "react";
import type { ReferredUser, FunnelEvent, FunnelStatusSlug } from "@/types/database";
import { funnelColor, funnelLabel } from "@/lib/funnel-colors";
import { useBrand } from "@/lib/brand-context";

interface Props {
  users: ReferredUser[];
  events: FunnelEvent[];
  stageDurations?: { status_slug: string; avg_hours: number }[];
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

function formatHours(h: number): string {
  if (h < 1)  return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function contrastText(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#1F2937" : "#FFFFFF";
}

function conversionVariant(rate: number): "success" | "warning" | "danger" {
  if (rate >= 0.8) return "success";
  if (rate >= 0.6) return "warning";
  return "danger";
}

const VARIANT_CLASSES = {
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger:  "bg-red-50 text-red-700",
} as const;

function MetricBadge({
  label,
  value,
  suffix,
  variant,
}: {
  label: string;
  value: string;
  suffix?: string;
  variant: "success" | "warning" | "danger" | "neutral";
}) {
  const cls = variant === "neutral"
    ? "bg-surface-100/80 text-brand-500"
    : VARIANT_CLASSES[variant];
  return (
    <div className={`inline-flex items-baseline gap-1.5 px-2.5 py-1 rounded-md text-xs tabular-nums ${cls}`}>
      <span className="text-[10px] uppercase tracking-[0.1em] opacity-75">{label}</span>
      <span className="font-bold">{value}{suffix && <span className="text-[10px] opacity-75 ml-0.5">{suffix}</span>}</span>
    </div>
  );
}

export default function ConversionFunnel({ users, events, stageDurations }: Props) {
  const brand = useBrand();
  const accentHex = brand?.accent_hex;

  const { funnelData, total } = useMemo(() => {
    const durationBySlug = Object.fromEntries(
      (stageDurations ?? []).map((d) => [d.status_slug, d])
    );

    // Determine the highest funnel stage each user ever reached
    const userHighest: Record<string, number> = {};
    for (const u of users) {
      const currentIdx = STAGE_INDEX[u.status_slug] ?? -1;
      userHighest[u.id] = Math.max(userHighest[u.id] ?? -1, currentIdx);
    }

    if (events && events.length > 0) {
      for (const e of events) {
        if (!Object.prototype.hasOwnProperty.call(userHighest, e.referred_user_id)) continue;
        if (e.to_status) {
          const idx = STAGE_INDEX[e.to_status] ?? -1;
          if (idx > (userHighest[e.referred_user_id] ?? -1)) {
            userHighest[e.referred_user_id] = idx;
          }
        }
        if (e.from_status) {
          const idx = STAGE_INDEX[e.from_status] ?? -1;
          if (idx > (userHighest[e.referred_user_id] ?? -1)) {
            userHighest[e.referred_user_id] = idx;
          }
        }
      }
    }

    // Cumulative pass-through: how many users reached AT LEAST this stage
    const reachedCounts = FUNNEL_STAGES.map((_, stageIdx) => {
      let count = 0;
      for (const u of users) {
        const highest = userHighest[u.id] ?? -1;
        if (highest < 0 && stageIdx === 0) {
          count++;
        } else if (highest >= stageIdx) {
          count++;
        }
      }
      return count;
    });

    const total = users.length;

    const funnelData = FUNNEL_STAGES.map((slug, i) => ({
      slug,
      label:        funnelLabel(slug),
      color:        funnelColor(slug, accentHex),
      reachedCount: reachedCounts[i],
      duration:     durationBySlug[slug] ?? null,
    }));

    return { funnelData, total };
  }, [users, events, stageDurations, accentHex]);

  // SVG trapezoid geometry
  const W = 700;
  const H = 160;
  const padX = 0;
  const padY = 16;
  const innerH = H - padY * 2;
  const centerY = padY + innerH / 2;
  const n = funnelData.length;
  const segW = (W - padX * 2) / n;

  const funnelTop = funnelData[0]?.reachedCount ?? 1;
  const lastStageReached = funnelData[funnelData.length - 1]?.reachedCount ?? 0;
  const overallConversion = funnelTop > 0 ? (lastStageReached / funnelTop) * 100 : 0;
  const totalDropOff = funnelTop - lastStageReached;

  const heights = useMemo(() => {
    return funnelData.map((stage) => {
      const ratio = funnelTop > 0 ? stage.reachedCount / funnelTop : 0;
      return Math.max(ratio * innerH, 24);
    });
  }, [funnelData, funnelTop, innerH]);

  const trapezoids = useMemo(() => {
    return funnelData.map((stage, i) => {
      const x1 = padX + i * segW;
      const x2 = padX + (i + 1) * segW;
      const htRight = heights[i];
      const leftH = i === 0 ? innerH : heights[i - 1];
      const y1t = centerY - leftH  / 2;
      const y1b = centerY + leftH  / 2;
      const y2t = centerY - htRight / 2;
      const y2b = centerY + htRight / 2;

      const avgH = (leftH + htRight) / 2;

      return {
        ...stage,
        path: `M ${x1} ${y1t} L ${x2} ${y2t} L ${x2} ${y2b} L ${x1} ${y1b} Z`,
        topLine: `M ${x1} ${y1t} L ${x2} ${y2t}`,
        bottomLine: `M ${x1} ${y1b} L ${x2} ${y2b}`,
        midX: (x1 + x2) / 2,
        x1,
        avgH,
      };
    });
  }, [funnelData, heights, centerY, padX, segW, innerH]);

  const avgStageConversion = useMemo(() => {
    if (funnelData.length <= 1) return 100;
    let sum = 0;
    let count = 0;
    for (let i = 1; i < funnelData.length; i++) {
      const prev = funnelData[i - 1].reachedCount;
      if (prev > 0) {
        sum += funnelData[i].reachedCount / prev;
        count++;
      }
    }
    return count > 0 ? (sum / count) * 100 : 0;
  }, [funnelData]);

  const healthRate = funnelTop > 0 ? lastStageReached / funnelTop : 0;
  const healthLabel = healthRate >= 0.15 ? "Excellent" : healthRate >= 0.08 ? "Good" : "Needs Attention";
  const healthColor = healthRate >= 0.15 ? "text-emerald-600" : healthRate >= 0.08 ? "text-amber-600" : "text-red-600";

  if (total === 0) {
    return (
      <div className="card p-8 text-center">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Conversion Funnel</h3>
        <p className="text-xs text-brand-400">No funnel data available yet.</p>
        <p className="text-[10px] text-brand-500 mt-1">Start referring users to see your conversion funnel.</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-surface-200/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Conversion Funnel</h3>
          <p className="text-xs text-brand-400 mt-0.5">
            Track user progression through your referral funnel &middot;{" "}
            <span className="font-semibold text-gray-700 tabular-nums">{funnelTop.toLocaleString()}</span> total users
          </p>
        </div>
      </div>

      {/* SVG Trapezoid Funnel */}
      <div className="px-4 sm:px-6 pt-4 sm:pt-5">
        <div className="w-full">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
            {trapezoids.map((t) => (
              <g key={t.slug}>
                <path d={t.path} fill={t.color} fillOpacity={0.5} />
                <path d={t.topLine} fill="none" stroke={t.color} strokeWidth="1.5" strokeLinecap="round" />
                <path d={t.bottomLine} fill="none" stroke={t.color} strokeWidth="1.5" strokeLinecap="round" />
                <text
                  x={t.midX} y={centerY - Math.min(t.avgH * 0.08, 5)}
                  textAnchor="middle" dominantBaseline="auto"
                  fill="#111827" fontSize={t.avgH < 40 ? "9" : "11"} fontWeight="700"
                >
                  {t.reachedCount}
                </text>
                <text
                  x={t.midX} y={centerY + Math.min(t.avgH * 0.15, 11)}
                  textAnchor="middle" dominantBaseline="auto"
                  fill="#374151" fontSize={t.avgH < 40 ? "7" : "9"} fontWeight="600"
                >
                  {funnelTop > 0 ? `${Math.round((t.reachedCount / funnelTop) * 100)}%` : "0%"}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </div>

      {/* Stage grid */}
      <div className="px-4 sm:px-6 py-4 sm:py-5">
        <div className="grid gap-2 sm:gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-8">
          {funnelData.map((stage, i) => {
            const prevReached = i === 0 ? funnelTop : funnelData[i - 1].reachedCount;
            const stageConversion = prevReached > 0 ? stage.reachedCount / prevReached : 0;
            const ofTotal = funnelTop > 0 ? (stage.reachedCount / funnelTop) * 100 : 0;
            const barWidth = funnelTop > 0 ? Math.max((stage.reachedCount / funnelTop) * 100, 3) : 0;

            return (
              <div
                key={stage.slug}
                className="rounded-2xl border border-surface-200/60 bg-white p-3 sm:p-4 transition-all duration-200 hover:border-surface-200/80 hover:shadow-sm"
              >
                <div className="flex items-center gap-2.5 mb-3">
                  <span
                    className="flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold flex-shrink-0"
                    style={{ backgroundColor: stage.color, color: contrastText(stage.color) }}
                  >
                    {i + 1}
                  </span>
                  <span className="text-xs font-semibold text-gray-700 capitalize leading-tight truncate">
                    {stage.label}
                  </span>
                </div>

                <div className="mb-2">
                  <p className="text-sm font-bold text-gray-900 tabular-nums leading-none">
                    {stage.reachedCount.toLocaleString()}
                  </p>
                  <p className="text-[10px] font-medium text-brand-400 uppercase tracking-[0.1em] mt-0.5">
                    Users
                  </p>
                </div>

                <div className="flex flex-col gap-1 mb-2">
                  <MetricBadge label="Of Total" value={ofTotal.toFixed(1)} suffix="%" variant="neutral" />
                  {i > 0 && (
                    <MetricBadge
                      label="Conversion"
                      value={(stageConversion * 100).toFixed(1)}
                      suffix="%"
                      variant={conversionVariant(stageConversion)}
                    />
                  )}
                </div>

                <div className="h-2 bg-surface-200/60 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${barWidth}%`, backgroundColor: stage.color }}
                  />
                </div>

                {stage.duration && (
                  <p className="text-[10px] text-brand-400 mt-2 tabular-nums">
                    avg {formatHours(stage.duration.avg_hours)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Summary footer */}
      <div className="px-4 sm:px-6 py-4 border-t border-surface-200/60 bg-surface-50/60">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.1em] text-brand-400 font-medium mb-1">Overall Conversion</p>
            <p className="text-lg sm:text-xl font-bold text-gray-900 tabular-nums">{overallConversion.toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.1em] text-brand-400 font-medium mb-1">Total Drop-Off</p>
            <p className="text-lg sm:text-xl font-bold text-red-500 tabular-nums">{totalDropOff.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.1em] text-brand-400 font-medium mb-1">Avg Stage Conversion</p>
            <p className="text-lg sm:text-xl font-bold text-gray-900 tabular-nums">{avgStageConversion.toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.1em] text-brand-400 font-medium mb-1">Funnel Health</p>
            <p className={`text-lg sm:text-xl font-bold ${healthColor}`}>{healthLabel}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
