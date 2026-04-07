"use client";

import { useMemo, useState } from "react";

interface MonthlyEarning {
  month: string; // 'YYYY-MM'
  total: number;
}

interface Props {
  data: MonthlyEarning[];
}

function fmtCompact(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function shortMonth(yyyyMM: string) {
  const [year, month] = yyyyMM.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString("en-US", { month: "short" });
}

export default function EarningsGraph({ data }: Props) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const { pts, maxVal, W, H, padX, padY, innerW, innerH } = useMemo(() => {
    const W = 560, H = 200, padX = 8, padY = 20;
    const innerW = W - padX * 2;
    const innerH = H - padY * 2;
    const maxVal = Math.max(...data.map((d) => d.total), 1);

    const pts = data.map((d, i) => ({
      x: padX + (data.length > 1 ? (i / (data.length - 1)) : 0.5) * innerW,
      y: padY + innerH - (d.total / maxVal) * innerH,
      ...d,
    }));

    return { pts, maxVal, W, H, padX, padY, innerW, innerH };
  }, [data]);

  function smoothPath(points: { x: number; y: number }[]) {
    if (points.length === 0) return "";
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    return points.reduce((acc, pt, i) => {
      if (i === 0) return `M ${pt.x} ${pt.y}`;
      const prev = points[i - 1];
      const cpX = (prev.x + pt.x) / 2;
      return `${acc} C ${cpX} ${prev.y}, ${cpX} ${pt.y}, ${pt.x} ${pt.y}`;
    }, "");
  }

  const totalPath = smoothPath(pts);
  const areaPath = pts.length > 0
    ? `${totalPath} L ${pts[pts.length - 1].x} ${padY + innerH} L ${pts[0].x} ${padY + innerH} Z`
    : "";

  const thisMonthTotal = data[data.length - 1]?.total ?? 0;
  const lastMonthTotal = data[data.length - 2]?.total ?? 0;
  const delta = lastMonthTotal > 0 ? ((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100 : 0;

  return (
    <div className="card p-6 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Earnings Over Time</h3>
          <p className="text-xs text-brand-400 mt-0.5">Monthly commission history</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-brand-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-accent inline-block" />
            Commissions
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 relative min-h-0">
        {data.length === 0 ? (
          <div className="h-[180px] flex items-center justify-center">
            <p className="text-sm text-brand-400">No earnings data yet</p>
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-full"
            preserveAspectRatio="none"
            onMouseLeave={() => setHoveredIdx(null)}
          >
            <defs>
              <linearGradient id="earningsAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00DE8F" stopOpacity="0.20" />
                <stop offset="100%" stopColor="#00DE8F" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Grid lines */}
            {[0.25, 0.5, 0.75, 1].map((frac) => (
              <line
                key={frac}
                x1={padX} y1={padY + innerH - frac * innerH}
                x2={W - padX} y2={padY + innerH - frac * innerH}
                stroke="#E5E7EB" strokeWidth="1" strokeDasharray="4 4"
              />
            ))}

            {/* Y-axis labels */}
            {[0.5, 1].map((frac) => (
              <text
                key={frac}
                x={padX + 2}
                y={padY + innerH - frac * innerH - 4}
                fill="#94A3B8"
                fontSize="10"
              >
                {fmtCompact(frac * maxVal)}
              </text>
            ))}

            {/* Area fill */}
            <path d={areaPath} fill="url(#earningsAreaGrad)" />

            {/* Line */}
            <path
              d={totalPath} fill="none"
              stroke="#00DE8F" strokeWidth="2.5"
              strokeLinecap="round" className="chart-line"
            />

            {/* Hover hit zones (invisible wider bars for better hover detection) */}
            {pts.map((pt, i) => (
              <rect
                key={`hit-${i}`}
                x={pt.x - (innerW / data.length) / 2}
                y={padY}
                width={innerW / data.length}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHoveredIdx(i)}
              />
            ))}

            {/* Dots */}
            {pts.map((pt, i) => (
              <circle
                key={i}
                cx={pt.x} cy={pt.y}
                r={hoveredIdx === i ? 5 : 3.5}
                fill="#ffffff" stroke="#00DE8F" strokeWidth="2"
                style={{ transition: "r 150ms ease-out" }}
              />
            ))}

            {/* Tooltip */}
            {hoveredIdx !== null && pts[hoveredIdx] && (
              <g>
                {/* Vertical guide line */}
                <line
                  x1={pts[hoveredIdx].x} y1={padY}
                  x2={pts[hoveredIdx].x} y2={padY + innerH}
                  stroke="#00DE8F" strokeWidth="1" strokeOpacity="0.3"
                  strokeDasharray="3 3"
                />
                {/* Tooltip box */}
                <rect
                  x={Math.min(pts[hoveredIdx].x - 40, W - 88)}
                  y={Math.max(pts[hoveredIdx].y - 38, 2)}
                  width="80" height="28" rx="6"
                  fill="#0C5147" fillOpacity="0.92"
                />
                <text
                  x={Math.min(pts[hoveredIdx].x, W - 48)}
                  y={Math.max(pts[hoveredIdx].y - 20, 20)}
                  fill="#ffffff" fontSize="10" fontWeight="600" textAnchor="middle"
                >
                  {shortMonth(data[hoveredIdx].month)}: {fmtCompact(data[hoveredIdx].total)}
                </text>
              </g>
            )}
          </svg>
        )}
      </div>

      {/* X-axis labels */}
      {data.length > 0 && (
        <div className="flex justify-between mt-3 px-1">
          {data.map((d, i) => (
            <span
              key={i}
              className="text-[10px] text-brand-400"
              style={{ width: `${100 / data.length}%`, textAlign: "center" }}
            >
              {i % 2 === 0 ? shortMonth(d.month) : ""}
            </span>
          ))}
        </div>
      )}

      {/* Footer stat */}
      <div className="mt-4 pt-4 border-t border-surface-200/60 flex items-center justify-between">
        <p className="text-xs text-brand-400">
          This month: <span className="text-gray-900 font-semibold">{fmtCompact(thisMonthTotal)}</span>
        </p>
        {lastMonthTotal > 0 && (
          <p className={`text-xs font-semibold ${delta >= 0 ? "text-accent" : "text-red-400"}`}>
            {delta >= 0 ? "+" : ""}{delta.toFixed(1)}% vs last month
          </p>
        )}
      </div>
    </div>
  );
}
