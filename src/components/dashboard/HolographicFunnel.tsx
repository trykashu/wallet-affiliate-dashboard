"use client";

import { useMemo, useRef, useEffect, useCallback, useState } from "react";
import type {
  ReferredUser,
  FunnelStatus,
  FunnelEvent,
  StageDuration,
} from "@/types/database";
import { funnelColor, funnelLabel } from "@/lib/funnel-colors";
import { fmt } from "@/lib/fmt";

/* ── Types ─────────────────────────────────────────────── */
interface Props {
  users: ReferredUser[];
  statuses: FunnelStatus[];
  stageDurations: StageDuration[];
  events?: FunnelEvent[];
}

/* ── Constants ─────────────────────────────────────────── */
const FUNNEL_STAGES = [
  "waitlist",
  "booked_call",
  "sent_onboarding",
  "signed_up",
  "transaction_run",
  "funds_in_wallet",
  "ach_initiated",
  "funds_in_bank",
] as const;

const STAGE_INDEX: Record<string, number> = {};
FUNNEL_STAGES.forEach((s, i) => {
  STAGE_INDEX[s] = i;
});

const EXIT_STAGES: readonly string[] = [];

/** Vertical position of each stage label (fraction of funnel height) */
const STAGE_PCTS = [0.06, 0.19, 0.32, 0.44, 0.56, 0.69, 0.81, 0.94];

/** Ring boundary positions — 9 lines create 8 equal bands */
const RING_PCTS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0];

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function conversionVariant(
  rate: number
): "success" | "warning" | "danger" {
  if (rate >= 0.8) return "success";
  if (rate >= 0.6) return "warning";
  return "danger";
}

const VARIANT_COLORS = {
  success: "#00DE8F",
  warning: "#FBBF24",
  danger: "#EF4444",
} as const;

function createFunnelParticles(count: number) {
  const particles = [];
  for (let i = 0; i < count; i++) {
    const seed = (i * 7919 + 1) % 997;
    particles.push({
      angle: (seed / 997) * Math.PI * 2,
      pct: ((seed * 3) % 997) / 997,
      speed: 0.003 + (((seed * 13) % 997) / 997) * 0.005,
      size: 1 + (((seed * 17) % 997) / 997) * 2,
      alpha: 0.4 + (((seed * 23) % 997) / 997) * 0.6,
      orbitR: (((seed * 29) % 997) / 997) * 0.6,
    });
  }
  return particles;
}

/* ── Component ─────────────────────────────────────────── */
export default function HolographicFunnel({
  users,
  statuses,
  stageDurations,
  events,
}: Props) {
  /* ── Data computation ────────────────────────────────── */
  const { funnelData, total, funnelTop } = useMemo(() => {
    const statusBySlug = Object.fromEntries(
      statuses.map((s) => [s.slug, s])
    );
    const durationBySlug = Object.fromEntries(
      stageDurations.map((d) => [d.status_slug, d])
    );

    const userHighest: Record<string, number> = {};
    for (const u of users) {
      const currentIdx = STAGE_INDEX[u.status_slug] ?? -1;
      userHighest[u.id] = Math.max(
        userHighest[u.id] ?? -1,
        currentIdx
      );
    }

    if (events && events.length > 0) {
      for (const e of events) {
        if (!userHighest.hasOwnProperty(e.referred_user_id)) continue;
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
    const funnelTop = reachedCounts[0] || 1;

    const funnelData = FUNNEL_STAGES.map((slug, i) => ({
      slug,
      label: funnelLabel(slug),
      color: funnelColor(slug),
      reachedCount: reachedCounts[i],
      duration: durationBySlug[slug] ?? null,
    }));

    return { funnelData, total, funnelTop };
  }, [users, statuses, stageDurations, events]);

  /* ── Derived metrics ─────────────────────────────────── */
  const lastStageName = "funds_in_bank";
  const lastStageReached =
    funnelData.find((s) => s.slug === lastStageName)?.reachedCount ?? 0;
  const overallConversion =
    funnelTop > 0 ? (lastStageReached / funnelTop) * 100 : 0;
  const totalDropOff = funnelTop - lastStageReached;

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
  const healthLabel =
    healthRate >= 0.15
      ? "Excellent"
      : healthRate >= 0.08
        ? "Good"
        : "Needs Attention";
  const healthColor =
    healthRate >= 0.15
      ? "#00DE8F"
      : healthRate >= 0.08
        ? "#FBBF24"
        : "#EF4444";

  /* ── Canvas refs ─────────────────────────────────────── */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const tRef = useRef(0);
  const particlesRef = useRef(createFunnelParticles(50));
  const cssSizeRef = useRef({ w: 0, h: 0 });
  const stageColorsRef = useRef<string[]>([]);
  const [stageYPositions, setStageYPositions] = useState<number[]>([]);

  // Keep stage colors in sync
  useEffect(() => {
    stageColorsRef.current = funnelData.map((s) => s.color);
  }, [funnelData]);

  /* ── Canvas drawing ──────────────────────────────────── */
  const drawFrame = useCallback(
    (ctx: CanvasRenderingContext2D, W: number, H: number, t: number) => {
      const cx = W / 2; // Funnel centered in canvas
      const cy = H / 2 - 10;
      const topR = Math.min(W, H) * 0.36;
      const botR = Math.min(W, H) * 0.10;
      const fh = Math.min(W, H) * 0.62;
      const tilt = 0.32;
      const spokeCount = 20;
      const segs = 80;
      const colors = stageColorsRef.current;

      // ── Horizontal rings ────────────────────────────
      for (let ri = 0; ri < RING_PCTS.length; ri++) {
        const pct = RING_PCTS[ri];
        const rad = topR + (botR - topR) * pct;
        const ypos = cy - fh / 2 + pct * fh;
        const ep = 0.5 + 0.5 * Math.sin(t * 2 - pct * 5);
        const alpha = 0.5 + 0.35 * ep;
        const stageIdx = Math.min(Math.floor(ri), colors.length - 1);
        const color = colors[stageIdx] || "#00DE8F";

        // Parse hex color for rgba
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);

        ctx.beginPath();
        for (let i = 0; i <= segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          const x = cx + Math.cos(a) * rad;
          const y = ypos + Math.sin(a) * rad * tilt;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Glow pass
        ctx.lineWidth = 5;
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.06 * ep})`;
        ctx.beginPath();
        for (let i = 0; i <= segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          const x = cx + Math.cos(a) * rad;
          const y = ypos + Math.sin(a) * rad * tilt;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // ── Vertical spokes (rotating) ──────────────────
      const rotOffset = t * 0.28;
      for (let s = 0; s < spokeCount; s++) {
        const a = (s / spokeCount) * Math.PI * 2 + rotOffset;
        const cosA = Math.cos(a);
        const brightness = (cosA + 1) / 2;
        const alpha = 0.08 + 0.5 * brightness;
        const col =
          s % 3 === 0
            ? `rgba(0,190,120,${alpha})`
            : `rgba(12,81,71,${alpha})`;
        ctx.beginPath();
        for (let ri = 0; ri < RING_PCTS.length; ri++) {
          const pct = RING_PCTS[ri];
          const rad = topR + (botR - topR) * pct;
          const ypos = cy - fh / 2 + pct * fh;
          const x = cx + Math.cos(a) * rad;
          const y = ypos + Math.sin(a) * rad * tilt;
          ri === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = col;
        ctx.lineWidth = 0.3 + 1.2 * brightness;
        ctx.stroke();
      }

      // ── Particles flowing down ──────────────────────
      const particles = particlesRef.current;
      for (const p of particles) {
        p.pct += p.speed;
        if (p.pct > 1.05) {
          p.pct = 0;
          p.angle = ((p.angle * 997 + 7) % (Math.PI * 20)) / 10;
          p.orbitR = (((p.orbitR * 997 + 13) % 997) / 997) * 0.8;
        }
        const rad = (topR + (botR - topR) * p.pct) * p.orbitR;
        const ypos = cy - fh / 2 + p.pct * fh;
        const x = cx + Math.cos(p.angle + p.pct * 2) * rad;
        const y = ypos + Math.sin(p.angle + p.pct * 2) * rad * tilt;
        const fade = p.pct < 0.1 ? p.pct * 10 : p.pct > 0.9 ? (1 - p.pct) * 10 : 1;
        const size = p.size * (1 - p.pct * 0.5);

        const g = ctx.createRadialGradient(x, y, 0, x, y, size * 3);
        g.addColorStop(0, `rgba(0,190,120,${p.alpha * fade * 0.7})`);
        g.addColorStop(1, "rgba(0,222,143,0)");
        ctx.beginPath();
        ctx.arc(x, y, size * 3, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, size * 0.6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,160,100,${p.alpha * fade})`;
        ctx.fill();
      }

      // ── Circle data points on front face + connector lines ──
      const yPositions: number[] = [];
      for (let i = 0; i < STAGE_PCTS.length; i++) {
        const pct = STAGE_PCTS[i];
        const rad = topR + (botR - topR) * pct;
        const ypos = cy - fh / 2 + pct * fh;
        yPositions.push(ypos);
        const pulse = 0.6 + 0.4 * Math.sin(t * 1.8 + pct * 5);
        const color = colors[i] || "#00DE8F";
        const cr = parseInt(color.slice(1, 3), 16);
        const cg = parseInt(color.slice(3, 5), 16);
        const cb = parseInt(color.slice(5, 7), 16);

        // Circle on the front face — rightmost point of the ellipse ring
        const circleX = cx + rad;
        const circleY = ypos; // center of ellipse at tilt=0 on right edge
        const circleR = 5 + pulse * 2;

        // Connector line from circle to right edge of canvas
        ctx.beginPath();
        ctx.moveTo(circleX + circleR + 4, circleY);
        ctx.lineTo(W, circleY);
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${0.12 + 0.08 * pulse})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Outer glow of circle
        const glow = ctx.createRadialGradient(circleX, circleY, 0, circleX, circleY, circleR * 3);
        glow.addColorStop(0, `rgba(${cr},${cg},${cb},${0.25 * pulse})`);
        glow.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        ctx.beginPath();
        ctx.arc(circleX, circleY, circleR * 3, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();

        // Circle ring
        ctx.beginPath();
        ctx.arc(circleX, circleY, circleR, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fill();
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${0.8 + 0.2 * pulse})`;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Inner dot
        ctx.beginPath();
        ctx.arc(circleX, circleY, circleR * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${0.9})`;
        ctx.fill();
      }
      // ── Tip glow ────────────────────────────────────
      const tipY = cy + fh / 2;
      const tp = 0.6 + 0.4 * Math.sin(t * 3);
      const tipG = ctx.createRadialGradient(cx, tipY, 0, cx, tipY, botR * 3);
      tipG.addColorStop(0, `rgba(0,222,143,${0.4 * tp})`);
      tipG.addColorStop(0.4, `rgba(12,81,71,${0.1 * tp})`);
      tipG.addColorStop(1, "rgba(255,255,255,0)");
      ctx.beginPath();
      ctx.arc(cx, tipY, botR * 3, 0, Math.PI * 2);
      ctx.fillStyle = tipG;
      ctx.fill();

      return yPositions;
    },
    []
  );

  const yPosEmittedRef = useRef(false);

  const animate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = cssSizeRef.current.w;
    const H = cssSizeRef.current.h;
    if (W === 0 || H === 0) {
      animRef.current = requestAnimationFrame(animate);
      return;
    }

    // Fade trail — matches card white bg
    ctx.fillStyle = "rgba(255,255,255,0.30)";
    ctx.fillRect(0, 0, W, H);

    const yPositions = drawFrame(ctx, W, H, tRef.current);
    tRef.current += 0.012;

    // Emit Y positions once for right panel alignment
    if (!yPosEmittedRef.current && yPositions && yPositions.length > 0) {
      yPosEmittedRef.current = true;
      setStageYPositions(yPositions);
    }

    animRef.current = requestAnimationFrame(animate);
  }, [drawFrame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (!rect) return;
      const dpr = window.devicePixelRatio || 1;
      cssSizeRef.current = { w: rect.width, h: rect.height };
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, rect.width, rect.height);
      }
      yPosEmittedRef.current = false; // Re-emit on resize
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas.parentElement!);
    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      observer.disconnect();
    };
  }, [animate]);

  /* ── Empty state ─────────────────────────────────────── */
  if (total === 0) {
    return (
      <div className="card p-8 text-center">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">
          Conversion Funnel
        </h3>
        <p className="text-xs text-brand-400">
          No funnel data available yet.
        </p>
      </div>
    );
  }

  /* ── Render ──────────────────────────────────────────── */
  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-surface-200/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">
              Conversion Funnel
            </h3>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-accent/10 text-accent border border-accent/20">
              <span className="w-1 h-1 rounded-full bg-accent animate-pulse" />
              Live
            </span>
          </div>
          <p className="text-xs text-brand-400 mt-0.5">
            Track user progression &middot;{" "}
            <span className="font-semibold text-gray-700 tabular-nums">
              {fmt.count(funnelTop)}
            </span>{" "}
            total users
          </p>
        </div>
      </div>

      {/* ── Main: Canvas (left) + Metrics (right) ────── */}
      <div className="flex flex-col lg:flex-row">
        {/* ── LEFT: Canvas holographic funnel ──────────── */}
        <div className="relative lg:w-[440px] xl:w-[500px] flex-shrink-0 min-h-[420px] sm:min-h-[480px]">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
          />
        </div>

        {/* ── RIGHT: Stage Metrics (aligned to connector lines) ── */}
        <div className="flex-1 relative min-h-[420px] sm:min-h-[480px]">
          {funnelData.map((stage, i) => {
            const yPos = stageYPositions[i];
            const prevReached =
              i === 0 ? funnelTop : funnelData[i - 1].reachedCount;
            const stageConversion =
              prevReached > 0
                ? stage.reachedCount / prevReached
                : 0;
            const ofTotal =
              funnelTop > 0
                ? (stage.reachedCount / funnelTop) * 100
                : 0;
            const variant =
              i === 0 ? "success" : conversionVariant(stageConversion);

            return (
              <div
                key={stage.slug}
                className="flex items-center gap-3 px-5 sm:px-8"
                style={
                  yPos != null
                    ? { position: "absolute", top: `${yPos}px`, left: 0, right: 0, transform: "translateY(-50%)" }
                    : {}
                }
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 border-2"
                  style={{
                    borderColor: stage.color,
                    color: stage.color,
                    boxShadow: `0 0 10px ${stage.color}30`,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-gray-800 uppercase tracking-wide truncate">
                      {stage.label}
                    </span>
                    <span className="text-sm font-bold text-gray-900 tabular-nums flex-shrink-0">
                      {stage.reachedCount.toLocaleString()}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-1.5 bg-surface-200/80 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${Math.max(ofTotal, 3)}%`,
                          backgroundColor: stage.color,
                          boxShadow: `0 0 8px ${stage.color}50`,
                        }}
                      />
                    </div>
                    <span className="text-[10px] font-bold tabular-nums text-brand-400 w-10 text-right">
                      {ofTotal.toFixed(0)}%
                    </span>
                  </div>

                  <div className="flex items-center gap-3 mt-0.5">
                    {i > 0 && (
                      <span
                        className="text-[10px] font-semibold tabular-nums"
                        style={{ color: VARIANT_COLORS[variant] }}
                      >
                        {(stageConversion * 100).toFixed(0)}% conv
                      </span>
                    )}
                    {stage.duration && (
                      <span className="text-[10px] text-brand-400 tabular-nums">
                        avg {formatHours(stage.duration.avg_hours)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Summary Footer ───────────────────────────────── */}
      <div className="px-4 sm:px-6 py-4 border-t border-surface-200/60 bg-surface-50/60">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.1em] text-brand-400 font-medium mb-1">
              Overall Conversion
            </p>
            <p className="text-lg sm:text-xl font-bold text-gray-900 tabular-nums">
              {overallConversion.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.1em] text-brand-400 font-medium mb-1">
              Total Drop-Off
            </p>
            <p className="text-lg sm:text-xl font-bold text-red-500 tabular-nums">
              {totalDropOff.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.1em] text-brand-400 font-medium mb-1">
              Avg Stage Conversion
            </p>
            <p className="text-lg sm:text-xl font-bold text-gray-900 tabular-nums">
              {avgStageConversion.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.1em] text-brand-400 font-medium mb-1">
              Funnel Health
            </p>
            <p
              className="text-lg sm:text-xl font-bold"
              style={{ color: healthColor }}
            >
              {healthLabel}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
