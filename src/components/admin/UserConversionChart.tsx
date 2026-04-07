"use client";

import { useMemo } from "react";
import { fmt } from "@/lib/fmt";

interface Props {
  users: Array<{ status_slug: string; created_at: string }>;
}

const TRANSACTED_SLUGS = [
  "transaction_run",
  "funds_in_wallet",
  "ach_initiated",
  "funds_in_bank",
];

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

export default function UserConversionChart({ users }: Props) {
  const { months, rates } = useMemo(() => {
    const now = new Date();
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(monthKey(d));
    }

    // Bucket users by their created_at month
    const totalByMonth: Record<string, number> = {};
    const transactedByMonth: Record<string, number> = {};
    for (const m of months) {
      totalByMonth[m] = 0;
      transactedByMonth[m] = 0;
    }
    for (const u of users) {
      const k = monthKey(new Date(u.created_at));
      if (k in totalByMonth) {
        totalByMonth[k]++;
        if (TRANSACTED_SLUGS.includes(u.status_slug)) {
          transactedByMonth[k]++;
        }
      }
    }

    const rates = months.map((m) =>
      totalByMonth[m] > 0 ? transactedByMonth[m] / totalByMonth[m] : 0
    );

    return { months, rates };
  }, [users]);

  const W = 560, H = 180, padX = 40, padY = 16, padBottom = 24;
  const innerW = W - padX * 2;
  const innerH = H - padY - padBottom;

  const maxRate = Math.max(...rates, 0.1);
  // Round up to nearest nice percentage for y-axis
  const yMax = Math.ceil(maxRate * 10) / 10;

  const points = useMemo(() => {
    return rates.map((val, i) => ({
      x: padX + (months.length > 1 ? (i / (months.length - 1)) * innerW : innerW / 2),
      y: padY + innerH - (val / yMax) * innerH,
    }));
  }, [rates, yMax, innerW, innerH, months.length]);

  const yTicks = useMemo(() => {
    const steps = 4;
    const ticks: number[] = [];
    for (let i = 0; i <= steps; i++) {
      ticks.push((yMax / steps) * i);
    }
    return ticks;
  }, [yMax]);

  const linePath = smoothPath(points);
  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x} ${padY + innerH} L ${points[0].x} ${padY + innerH} Z`
      : "";

  return (
    <div className="card p-4 sm:p-6">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-900">User Conversion Rate</h3>
        <p className="text-xs text-brand-400 mt-0.5">
          Monthly % of referred users reaching transaction stage
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="conversionAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00DE8F" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#00DE8F" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {yTicks.map((tick) => {
          const y = padY + innerH - (tick / yMax) * innerH;
          return (
            <g key={tick}>
              <line
                x1={padX} y1={y} x2={W - padX} y2={y}
                stroke="#E5E7EB" strokeWidth="1" strokeDasharray="4 4"
              />
              <text x={padX - 4} y={y + 3} fill="#9CA3AF" fontSize="8" textAnchor="end">
                {fmt.percent(tick)}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={areaPath} fill="url(#conversionAreaGrad)" />

        {/* Line */}
        <path
          d={linePath} fill="none"
          stroke="#00DE8F" strokeWidth="2" strokeLinecap="round"
        />

        {/* Dots */}
        {points.map((pt, i) => (
          <circle
            key={i} cx={pt.x} cy={pt.y} r="3"
            fill="#ffffff" stroke="#00DE8F" strokeWidth="1.5"
          />
        ))}

        {/* X-axis labels */}
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
  );
}
