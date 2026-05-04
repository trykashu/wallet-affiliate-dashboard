"use client";

import { useMemo, useState } from "react";
import { monthLabel } from "@/lib/projections";
import type { ProjectionResult } from "@/lib/projections";

interface Props {
  projections: ProjectionResult;
  actuals:     { month: string; total: number }[];
}

type Scenario = "optimistic" | "expected" | "conservative";

const SCENARIO_MULTIPLIERS: Record<Scenario, number> = {
  optimistic:   1.2,
  expected:     1.0,
  conservative: 0.8,
};

function fmtCompact(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export default function RevenueProjection({ projections, actuals }: Props) {
  const [scenario, setScenario] = useState<Scenario>("expected");
  const mult = SCENARIO_MULTIPLIERS[scenario];

  // Merge actuals + projected into a combined dataset
  const { combinedPts, maxVal, W, H, padX, padY, innerW, innerH, actualCount } = useMemo(() => {
    const W = 560, H = 200, padX = 8, padY = 20;
    const innerW = W - padX * 2;
    const innerH = H - padY * 2;

    // Take the last 6 months of actuals
    const recentActuals = actuals.slice(-6);

    // Apply scenario multiplier to projections
    const scaledProjections = projections.months.map((m) => ({
      month:     m.month,
      value:     m.projected * mult,
      lower:     m.lower * mult,
      upper:     m.upper * mult,
      isActual:  false,
      confidence: m.confidence,
    }));

    const actualPts = recentActuals.map((a) => ({
      month:     a.month,
      value:     a.total,
      lower:     a.total,
      upper:     a.total,
      isActual:  true,
      confidence: 1,
    }));

    const combined = [...actualPts, ...scaledProjections];
    const maxVal = Math.max(...combined.map((d) => d.upper), 1);

    const pts = combined.map((d, i) => ({
      x: padX + (combined.length > 1 ? i / (combined.length - 1) : 0.5) * innerW,
      y: padY + innerH - (d.value / maxVal) * innerH,
      yLower: padY + innerH - (d.lower / maxVal) * innerH,
      yUpper: padY + innerH - (d.upper / maxVal) * innerH,
      ...d,
    }));

    return {
      combinedPts: pts,
      maxVal,
      W, H, padX, padY, innerW, innerH,
      actualCount: actualPts.length,
    };
  }, [actuals, projections.months, mult]);

  function smoothPath(points: { x: number; y: number }[]) {
    if (points.length <= 1) return points.length === 1 ? `M ${points[0].x} ${points[0].y}` : "";
    return points.reduce((acc, pt, i) => {
      if (i === 0) return `M ${pt.x} ${pt.y}`;
      const prev = points[i - 1];
      const cpX = (prev.x + pt.x) / 2;
      return `${acc} C ${cpX} ${prev.y}, ${cpX} ${pt.y}, ${pt.x} ${pt.y}`;
    }, "");
  }

  // Split into actual and projected line segments
  const actualPts = combinedPts.slice(0, actualCount);
  const projectedPts = actualCount > 0
    ? combinedPts.slice(actualCount - 1) // overlap at the junction point
    : combinedPts;

  const actualPath = smoothPath(actualPts);
  const projectedPath = smoothPath(projectedPts);

  // Confidence band for projected portion
  const bandPts = combinedPts.slice(actualCount > 0 ? actualCount - 1 : 0);
  const upperPath = bandPts.map((p, i) => ({
    x: p.x,
    y: p.yUpper,
  }));
  const lowerPath = [...bandPts].reverse().map((p) => ({
    x: p.x,
    y: p.yLower,
  }));

  const bandPathD = upperPath.length > 0
    ? `${smoothPath(upperPath)} L ${lowerPath[0]?.x ?? 0} ${lowerPath[0]?.y ?? 0} ${smoothPath(lowerPath).replace("M", "L")} Z`
    : "";

  // Full line area for gradient fill
  const fullPath = smoothPath(combinedPts);
  const fullAreaPath = combinedPts.length > 0
    ? `${fullPath} L ${combinedPts[combinedPts.length - 1].x} ${padY + innerH} L ${combinedPts[0].x} ${padY + innerH} Z`
    : "";

  const summary = {
    three_month:  Math.round(projections.summary.three_month * mult),
    six_month:    Math.round(projections.summary.six_month * mult),
    twelve_month: Math.round(projections.summary.twelve_month * mult),
  };

  return (
    <div className="card p-4 sm:p-6 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Revenue Forecast</h3>
          <p className="text-xs text-brand-400 mt-0.5">12-month projection based on historical performance</p>
        </div>
        {/* Scenario toggle */}
        <div className="flex gap-1 bg-surface-100 rounded-lg p-1">
          {(["optimistic", "expected", "conservative"] as Scenario[]).map((s) => (
            <button
              key={s}
              onClick={() => setScenario(s)}
              className={`text-[10px] px-2.5 py-1 rounded-md capitalize font-medium transition-colors ${
                scenario === s
                  ? "bg-white text-brand-600 shadow-card"
                  : "text-brand-400 hover:text-brand-600"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "3-Month",  value: summary.three_month },
          { label: "6-Month",  value: summary.six_month },
          { label: "12-Month", value: summary.twelve_month },
        ].map((s) => (
          <div key={s.label} className="bg-surface-100/60 rounded-xl p-3 text-center">
            <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">{s.label}</p>
            <p className="text-stat font-bold tabular-nums text-accent mt-0.5">{fmtCompact(s.value)}</p>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="relative min-h-0">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="projAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--wl-accent)" stopOpacity="0.12" />
              <stop offset="100%" stopColor="var(--wl-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Grid */}
          {[0.25, 0.5, 0.75, 1].map((frac) => (
            <line key={frac}
              x1={padX} y1={padY + innerH - frac * innerH}
              x2={W - padX} y2={padY + innerH - frac * innerH}
              stroke="#E5E7EB" strokeWidth="1" strokeDasharray="4 4"
            />
          ))}

          {/* Y-axis labels */}
          {[0.5, 1].map((frac) => (
            <text key={frac}
              x={padX + 2}
              y={padY + innerH - frac * innerH - 4}
              fill="#94A3B8" fontSize="10"
            >
              {fmtCompact(frac * maxVal)}
            </text>
          ))}

          {/* Full area gradient */}
          <path d={fullAreaPath} fill="url(#projAreaGrad)" />

          {/* Confidence band */}
          {bandPathD && (
            <path d={bandPathD} fill="var(--wl-accent)" fillOpacity="0.08" />
          )}

          {/* Actual line (solid) */}
          {actualPath && (
            <path d={actualPath} fill="none" stroke="var(--wl-accent)" strokeWidth="2.5"
              strokeLinecap="round" className="chart-line" />
          )}

          {/* Projected line (dashed) */}
          {projectedPath && (
            <path d={projectedPath} fill="none" stroke="var(--wl-accent)" strokeWidth="2"
              strokeDasharray="6 3" strokeLinecap="round" strokeOpacity="0.7" />
          )}

          {/* Dots */}
          {combinedPts.map((pt, i) => (
            <circle key={i} cx={pt.x} cy={pt.y}
              r={pt.isActual ? 3.5 : 3}
              fill="#ffffff" stroke="var(--wl-accent)" strokeWidth="2"
              strokeOpacity={pt.confidence}
            />
          ))}
        </svg>
      </div>

      {/* X-axis labels */}
      <div className="flex justify-between px-1 -mt-3">
        {combinedPts.map((d, i) => (
          <span key={i} className="text-[9px] text-brand-400"
            style={{ width: `${100 / combinedPts.length}%`, textAlign: "center" }}>
            {i % 3 === 0 ? monthLabel(d.month) : ""}
          </span>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-brand-400">
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-accent rounded-full inline-block" />
          Actual
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-accent/50 rounded-full inline-block border-t border-dashed border-accent" />
          Projected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 bg-accent/10 rounded inline-block" />
          Confidence band
        </span>
      </div>

      {/* Assumptions footnote */}
      <div className="pt-3 border-t border-surface-200/60">
        <p className="text-[10px] text-brand-400 leading-relaxed">
          Assumes {projections.assumptions.avg_referrals_per_month} referrals/mo &middot;{" "}
          {projections.assumptions.conversion_rate}% conversion rate &middot;{" "}
          {(projections.assumptions.commission_rate * 100).toFixed(0)}% commission.{" "}
          Multiplier: {mult}&times;.
        </p>
      </div>
    </div>
  );
}
