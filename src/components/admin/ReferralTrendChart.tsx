"use client";

import { useMemo, useState } from "react";
import { fmt } from "@/lib/fmt";
import type { ReferralBucket } from "@/lib/admin/referral-trend";

interface Props {
  monthly: ReferralBucket[];
  weekly: ReferralBucket[];
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

function niceTicks(max: number, steps = 4): number[] {
  if (max <= steps) return Array.from({ length: max + 1 }, (_, i) => i);
  const step = Math.ceil(max / steps);
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(max);
  return ticks;
}

export default function ReferralTrendChart({ monthly, weekly }: Props) {
  const [granularity, setGranularity] = useState<"monthly" | "weekly">("monthly");
  const data = granularity === "monthly" ? monthly : weekly;

  const W = 560, H = 200, padL = 36, padR = 52, padY = 16, padBottom = 28;
  const innerW = W - padL - padR;
  const innerH = H - padY - padBottom;

  const usersMax = Math.max(...data.map((b) => b.users), 1);
  const volumeMax = Math.max(...data.map((b) => b.volume), 1);

  const slotW = data.length > 0 ? innerW / data.length : innerW;
  const barW = slotW * 0.55;

  const centerX = (i: number) => padL + i * slotW + slotW / 2;

  const linePoints = useMemo(
    () =>
      data.map((b, i) => ({
        x: padL + i * slotW + slotW / 2,
        y: padY + innerH - (b.volume / volumeMax) * innerH,
      })),
    [data, volumeMax, innerH, padL, padY, slotW],
  );

  const linePath = smoothPath(linePoints);
  const areaPath =
    linePoints.length > 0
      ? `${linePath} L ${linePoints[linePoints.length - 1].x} ${padY + innerH} L ${linePoints[0].x} ${padY + innerH} Z`
      : "";

  const userTicks = niceTicks(usersMax);
  const volTicks = niceTicks(volumeMax);

  return (
    <div className="card p-4 sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Users Referred &amp; Referred Volume</h3>
          <p className="text-xs text-brand-400 mt-0.5">
            New referred users and Transfer-In volume per {granularity === "monthly" ? "month" : "week"}
          </p>
        </div>
        <select
          aria-label="Time period"
          value={granularity}
          onChange={(e) => setGranularity(e.target.value as "monthly" | "weekly")}
          className="border border-gray-200 rounded-xl text-sm text-gray-900 bg-white px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600"
        >
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
        </select>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-2">
        <span className="flex items-center gap-1.5 text-[11px] text-brand-400">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "#0C5147" }} /> Users referred
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-brand-400">
          <span className="inline-block w-4 h-0.5 rounded-full" style={{ background: "#00DE8F" }} /> Referred volume
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="referralVolumeGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00DE8F" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#00DE8F" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Left-axis grid + user-count ticks */}
        {userTicks.map((tick) => {
          const y = padY + innerH - (tick / usersMax) * innerH;
          return (
            <g key={`u-${tick}`}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#E5E7EB" strokeWidth="1" strokeDasharray="4 4" />
              <text x={padL - 4} y={y + 3} fill="#9CA3AF" fontSize="8" textAnchor="end">{tick}</text>
            </g>
          );
        })}

        {/* Right-axis volume ticks */}
        {volTicks.map((tick) => {
          const y = padY + innerH - (tick / volumeMax) * innerH;
          return (
            <text key={`v-${tick}`} x={W - padR + 4} y={y + 3} fill="#9CA3AF" fontSize="8" textAnchor="start">
              {fmt.currencyCompact(tick)}
            </text>
          );
        })}

        {/* User bars */}
        {data.map((b, i) => {
          const barHeight = (b.users / usersMax) * innerH;
          const x = padL + i * slotW + (slotW - barW) / 2;
          const y = padY + innerH - barHeight;
          return <rect key={`bar-${b.key}`} x={x} y={y} width={barW} height={Math.max(barHeight, 0)} fill="#0C5147" rx="3" />;
        })}

        {/* Volume area + line */}
        <path d={areaPath} fill="url(#referralVolumeGrad)" />
        <path d={linePath} fill="none" stroke="#00DE8F" strokeWidth="2" strokeLinecap="round" />
        {linePoints.map((pt, i) => (
          <circle key={`dot-${data[i].key}`} cx={pt.x} cy={pt.y} r="3" fill="#ffffff" stroke="#00DE8F" strokeWidth="1.5" />
        ))}

        {/* X labels */}
        {data.map((b, i) => (
          <text key={`x-${b.key}`} x={centerX(i)} y={H - 4} fill="#64748B" fontSize="9" textAnchor="middle">
            {b.label}
          </text>
        ))}
      </svg>
    </div>
  );
}
