"use client";

import { useMemo, useState } from "react";
import { fmt } from "@/lib/fmt";

type Point = { label: string; value: number };

interface Props {
  series: Point[];
  /** e.g. "Affiliates added" / "Users added" */
  caption: string;
}

function smoothPath(points: { x: number; y: number }[]) {
  if (points.length <= 1) return points.length === 1 ? `M ${points[0].x} ${points[0].y}` : "";
  return points.reduce((acc, pt, i) => {
    if (i === 0) return `M ${pt.x} ${pt.y}`;
    const prev = points[i - 1];
    const cpX = (prev.x + pt.x) / 2;
    return `${acc} C ${cpX} ${prev.y}, ${cpX} ${pt.y}, ${pt.x} ${pt.y}`;
  }, "");
}

const W = 420, H = 150, padX = 30, padY = 16, padBottom = 24;
const innerW = W - padX * 2;
const innerH = H - padY - padBottom;

/** Compact count area chart for the stat drill drawer (additions per month). */
export default function DrillTrendChart({ series, caption }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const total = series.reduce((s, p) => s + p.value, 0);
  const maxVal = Math.max(...series.map((p) => p.value), 1);
  const yMax = niceCeil(maxVal);

  const points = useMemo(
    () =>
      series.map((p, i) => ({
        x: padX + (series.length > 1 ? (i / (series.length - 1)) * innerW : innerW / 2),
        y: padY + innerH - (p.value / yMax) * innerH,
      })),
    [series, yMax]
  );

  const linePath = smoothPath(points);
  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x} ${padY + innerH} L ${points[0].x} ${padY + innerH} Z`
      : "";

  const hp = hover !== null ? points[hover] : null;

  return (
    <div className="ad-inset p-3 mb-4">
      <div className="flex items-baseline justify-between mb-1">
        <p className="ad-label">{caption} · last {series.length} mo.</p>
        <p className="text-xs font-semibold ad-text-1 tabular-nums">{fmt.count(total)}</p>
      </div>
      {total === 0 ? (
        <div className="h-[90px] flex items-center justify-center">
          <p className="text-xs ad-text-3">No additions in this window.</p>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="adDrillArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--ad-accent)" stopOpacity="0.22" />
                <stop offset="100%" stopColor="var(--ad-accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1={padX} y1={padY + innerH} x2={W - padX} y2={padY + innerH} stroke="var(--ad-border)" strokeWidth="1" />
            <path d={areaPath} fill="url(#adDrillArea)" />
            <path d={linePath} fill="none" stroke="var(--ad-accent)" strokeWidth="1.75" strokeLinecap="round" />
            {hp && (
              <>
                <line x1={hp.x} y1={padY} x2={hp.x} y2={padY + innerH} stroke="var(--ad-accent)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
                <circle cx={hp.x} cy={hp.y} r="3.5" fill="var(--ad-accent)" stroke="var(--ad-surface)" strokeWidth="2" />
              </>
            )}
            {series.map((p, i) => (
              <text key={i} x={points[i].x} y={H - 6} fill="var(--ad-text-3)" fontSize="9" textAnchor="middle">
                {p.label}
              </text>
            ))}
            {series.map((_, i) => {
              const colW = innerW / Math.max(series.length - 1, 1);
              return (
                <rect
                  key={i}
                  x={points[i].x - colW / 2}
                  y={padY}
                  width={colW}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}
          </svg>
          {hover !== null && hp && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[120%] whitespace-nowrap rounded-lg px-2 py-1"
              style={{ left: `${(hp.x / W) * 100}%`, top: `${(hp.y / H) * 100}%`, backgroundColor: "var(--ad-surface)", border: "1px solid var(--ad-border-strong)" }}
            >
              <p className="text-[10px] ad-text-3 leading-none">{series[hover].label}</p>
              <p className="text-xs font-semibold ad-text-1 mt-1 leading-none tabular-nums">{fmt.count(series[hover].value)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function niceCeil(n: number): number {
  if (n <= 0) return 1;
  const exp = Math.floor(Math.log10(n));
  const base = Math.pow(10, exp);
  const frac = n / base;
  const step = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return step * base;
}
