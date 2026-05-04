"use client";

import { useMemo } from "react";

interface Props {
  affiliates: Array<{ id: string; created_at: string }>;
}

function smoothPath(points: { x: number; y: number }[]) {
  if (points.length <= 1)
    return points.length === 1 ? `M ${points[0].x} ${points[0].y}` : "";
  return points.reduce((acc, pt, i) => {
    if (i === 0) return `M ${pt.x} ${pt.y}`;
    const prev = points[i - 1];
    const cpX = (prev.x + pt.x) / 2;
    return `${acc} C ${cpX} ${prev.y}, ${cpX} ${pt.y}, ${pt.x} ${pt.y}`;
  }, "");
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function shortMonth(yyyyMM: string) {
  const [year, month] = yyyyMM.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString("en-US", { month: "short" });
}

export default function AffiliateGrowthChart({ affiliates }: Props) {
  const { months, monthlyCounts, cumulativeCounts } = useMemo(() => {
    const now = new Date();
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(monthKey(d));
    }

    const countMap: Record<string, number> = {};
    for (const m of months) countMap[m] = 0;
    for (const a of affiliates) {
      const k = monthKey(new Date(a.created_at));
      if (k in countMap) countMap[k]++;
    }

    const monthlyCounts = months.map((m) => countMap[m]);

    const cumulativeCounts = months.map((m) => {
      const [y, mo] = m.split("-").map(Number);
      const endOfMonth = new Date(y, mo, 0, 23, 59, 59, 999);
      return affiliates.filter((a) => new Date(a.created_at) <= endOfMonth).length;
    });

    return { months, monthlyCounts, cumulativeCounts };
  }, [affiliates]);

  const W = 560, H = 180, padX = 32, padY = 16, padBottom = 24;
  const innerW = W - padX * 2;
  const innerH = H - padY - padBottom;

  // Bar chart
  const barMaxVal = Math.max(...monthlyCounts, 1);
  const barSlotW = innerW / months.length;
  const barW = barSlotW * 0.7;

  const barTicks = useMemo(() => {
    if (barMaxVal <= 4) return Array.from({ length: barMaxVal + 1 }, (_, i) => i);
    const step = Math.ceil(barMaxVal / 4);
    const ticks: number[] = [];
    for (let v = 0; v <= barMaxVal; v += step) ticks.push(v);
    if (ticks[ticks.length - 1] < barMaxVal) ticks.push(barMaxVal);
    return ticks;
  }, [barMaxVal]);

  // Line chart
  const lineMaxVal = Math.max(...cumulativeCounts, 1);
  const linePoints = useMemo(() => {
    return cumulativeCounts.map((val, i) => ({
      x: padX + (months.length > 1 ? (i / (months.length - 1)) * innerW : innerW / 2),
      y: padY + innerH - (val / lineMaxVal) * innerH,
    }));
  }, [cumulativeCounts, lineMaxVal, innerW, innerH, months.length]);

  const lineTicks = useMemo(() => {
    if (lineMaxVal <= 4) return Array.from({ length: lineMaxVal + 1 }, (_, i) => i);
    const step = Math.ceil(lineMaxVal / 4);
    const ticks: number[] = [];
    for (let v = 0; v <= lineMaxVal; v += step) ticks.push(v);
    if (ticks[ticks.length - 1] < lineMaxVal) ticks.push(lineMaxVal);
    return ticks;
  }, [lineMaxVal]);

  const linePath = smoothPath(linePoints);
  const areaPath =
    linePoints.length > 0
      ? `${linePath} L ${linePoints[linePoints.length - 1].x} ${padY + innerH} L ${linePoints[0].x} ${padY + innerH} Z`
      : "";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Bar Chart: Affiliates Added MoM */}
      <div className="card p-4 sm:p-6">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Affiliates Added</h3>
          <p className="text-xs text-brand-400 mt-0.5">Monthly sign-ups with completed agreements</p>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
          {barTicks.map((tick) => {
            const y = padY + innerH - (tick / barMaxVal) * innerH;
            return (
              <g key={tick}>
                <line
                  x1={padX} y1={y} x2={W - padX} y2={y}
                  stroke="#E5E7EB" strokeWidth="1" strokeDasharray="4 4"
                />
                <text x={padX - 4} y={y + 3} fill="#9CA3AF" fontSize="8" textAnchor="end">
                  {tick}
                </text>
              </g>
            );
          })}

          {monthlyCounts.map((count, i) => {
            const barHeight = (count / barMaxVal) * innerH;
            const x = padX + i * barSlotW + (barSlotW - barW) / 2;
            const y = padY + innerH - barHeight;
            return (
              <rect
                key={i}
                x={x} y={y}
                width={barW} height={Math.max(barHeight, 0)}
                fill="#0C5147" rx="3"
              />
            );
          })}

          {/* Count labels above each bar */}
          {monthlyCounts.map((count, i) => {
            if (count === 0) return null;
            const barHeight = (count / barMaxVal) * innerH;
            const x = padX + i * barSlotW + barSlotW / 2;
            const y = padY + innerH - barHeight - 4;
            return (
              <text
                key={`label-${i}`}
                x={x} y={y}
                fill="#0C5147" fontSize="10" fontWeight="600" textAnchor="middle"
              >
                {count}
              </text>
            );
          })}

          {months.map((m, i) => (
            <text
              key={m}
              x={padX + i * barSlotW + barSlotW / 2}
              y={H - 4}
              fill="#64748B" fontSize="9" textAnchor="middle"
            >
              {shortMonth(m)}
            </text>
          ))}
        </svg>
      </div>

      {/* Line Chart: Total Affiliates Over Time */}
      <div className="card p-4 sm:p-6">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Total Affiliates Over Time</h3>
          <p className="text-xs text-brand-400 mt-0.5">Cumulative growth (signed agreements only)</p>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="affiliateAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00DE8F" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#00DE8F" stopOpacity="0" />
            </linearGradient>
          </defs>

          {lineTicks.map((tick) => {
            const y = padY + innerH - (tick / lineMaxVal) * innerH;
            return (
              <g key={tick}>
                <line
                  x1={padX} y1={y} x2={W - padX} y2={y}
                  stroke="#E5E7EB" strokeWidth="1" strokeDasharray="4 4"
                />
                <text x={padX - 4} y={y + 3} fill="#9CA3AF" fontSize="8" textAnchor="end">
                  {tick}
                </text>
              </g>
            );
          })}

          <path d={areaPath} fill="url(#affiliateAreaGrad)" />

          <path
            d={linePath} fill="none"
            stroke="#00DE8F" strokeWidth="2" strokeLinecap="round"
          />

          {linePoints.map((pt, i) => (
            <circle
              key={i} cx={pt.x} cy={pt.y} r="3"
              fill="#ffffff" stroke="#00DE8F" strokeWidth="1.5"
            />
          ))}

          {months.map((m, i) => (
            <text
              key={m}
              x={padX + (months.length > 1 ? (i / (months.length - 1)) * innerW : innerW / 2)}
              y={H - 4}
              fill="#64748B" fontSize="9" textAnchor="middle"
            >
              {shortMonth(m)}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}
