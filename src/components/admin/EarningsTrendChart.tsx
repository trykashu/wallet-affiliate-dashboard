"use client";

import { useMemo, useState } from "react";
import { fmt } from "@/lib/fmt";
import Money from "./Money";

type Point = { label: string; value: number };
type Metric = "tpv" | "cash";

interface Props {
  /** Referred volume (TPV) per month — oldest → newest. */
  tpv: Point[];
  /** Cash collected (Kashu fee) per month — oldest → newest. */
  cash: Point[];
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

const W = 560, H = 220, padX = 48, padY = 22, padBottom = 28;
const innerW = W - padX * 2;
const innerH = H - padY - padBottom;

export default function EarningsTrendChart({ tpv, cash }: Props) {
  const [metric, setMetric] = useState<Metric>("tpv");
  const [hover, setHover] = useState<number | null>(null);

  const series = metric === "tpv" ? tpv : cash;
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

  const yTicks = useMemo(() => {
    const steps = 4;
    return Array.from({ length: steps + 1 }, (_, i) => (yMax / steps) * i);
  }, [yMax]);

  const linePath = smoothPath(points);
  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x} ${padY + innerH} L ${points[0].x} ${padY + innerH} Z`
      : "";

  const hp = hover !== null ? points[hover] : null;

  return (
    <div className="ad-card p-4 sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold ad-text-1">System Volume Trend</h3>
          <p className="text-[11px] ad-text-3 mt-0.5">
            {metric === "tpv" ? "Referred volume (TPV)" : "Cash collected (Kashu fee)"} per month · last {series.length} months
          </p>
        </div>
        {/* TPV / Cash toggle — segmented control */}
        <div className="flex items-center gap-1 p-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: "var(--ad-inset)", border: "1px solid var(--ad-border)" }}>
          {([["tpv", "TPV"], ["cash", "Cash"]] as [Metric, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setMetric(k)}
              className="text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors"
              style={
                metric === k
                  ? { backgroundColor: "var(--ad-accent-soft)", color: "var(--ad-accent-strong)" }
                  : { color: "var(--ad-text-3)" }
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3">
        <p className="ad-label">Trailing total</p>
        <p className="text-lg font-semibold ad-text-1 mt-0.5"><Money value={total} /></p>
      </div>

      {total === 0 ? (
        <div className="ad-inset h-[140px] flex items-center justify-center">
          <p className="text-sm ad-text-3">No {metric === "tpv" ? "volume" : "cash collected"} in this window yet.</p>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="adVolumeArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--ad-accent)" stopOpacity="0.22" />
                <stop offset="100%" stopColor="var(--ad-accent)" stopOpacity="0" />
              </linearGradient>
            </defs>

            {yTicks.map((tick) => {
              const y = padY + innerH - (tick / yMax) * innerH;
              return (
                <g key={tick}>
                  <line x1={padX} y1={y} x2={W - padX} y2={y} stroke="var(--ad-border)" strokeWidth="1" />
                  <text x={padX - 8} y={y + 3} fill="var(--ad-text-3)" fontSize="9" textAnchor="end">
                    {fmt.currencyCompact(tick)}
                  </text>
                </g>
              );
            })}

            <path d={areaPath} fill="url(#adVolumeArea)" />
            <path d={linePath} fill="none" stroke="var(--ad-accent)" strokeWidth="1.75" strokeLinecap="round" />

            {hp && (
              <>
                <line x1={hp.x} y1={padY} x2={hp.x} y2={padY + innerH} stroke="var(--ad-accent)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
                <circle cx={hp.x} cy={hp.y} r="4" fill="var(--ad-accent)" stroke="var(--ad-surface)" strokeWidth="2" />
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
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[120%] whitespace-nowrap rounded-lg px-2.5 py-1.5"
              style={{
                left: `${(hp.x / W) * 100}%`,
                top: `${(hp.y / H) * 100}%`,
                backgroundColor: "var(--ad-inset)",
                border: "1px solid var(--ad-border-strong)",
              }}
            >
              <p className="text-[10px] ad-text-3 leading-none">{series[hover].label}</p>
              <p className="text-xs font-semibold ad-text-1 mt-1 leading-none">
                <Money value={series[hover].value} />
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Round a max value up to a clean axis ceiling (1/2/5 × 10^n). */
function niceCeil(n: number): number {
  if (n <= 0) return 1;
  const exp = Math.floor(Math.log10(n));
  const base = Math.pow(10, exp);
  const frac = n / base;
  const step = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return step * base;
}
