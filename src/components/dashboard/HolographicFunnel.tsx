"use client";

import { useMemo, useRef, useEffect, useCallback } from "react";
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
  "booked_call",
  "sent_onboarding",
  "signed_up",
  "transaction_run",
] as const;

const STAGE_INDEX: Record<string, number> = {};
FUNNEL_STAGES.forEach((s, i) => {
  STAGE_INDEX[s] = i;
});

/** Ring boundary positions — 5 lines create 4 equal bands */
const RING_PCTS = [0, 0.25, 0.5, 0.75, 1.0];

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function conversionVariant(rate: number): "success" | "warning" | "danger" {
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
  const { funnelData, funnelTop } = useMemo(() => {
    const durationBySlug = Object.fromEntries(
      stageDurations.map((d) => [d.status_slug, d])
    );

    const userHighest: Record<string, number> = {};
    for (const u of users) {
      const currentIdx = STAGE_INDEX[u.status_slug] ?? -1;
      userHighest[u.id] = Math.max(userHighest[u.id] ?? -1, currentIdx);
    }

    if (events && events.length > 0) {
      for (const e of events) {
        if (!Object.prototype.hasOwnProperty.call(userHighest, e.referred_user_id)) continue;
        for (const s of [e.to_status, e.from_status]) {
          if (s) {
            const idx = STAGE_INDEX[s] ?? -1;
            if (idx > (userHighest[e.referred_user_id] ?? -1)) {
              userHighest[e.referred_user_id] = idx;
            }
          }
        }
      }
    }

    const reachedCounts = FUNNEL_STAGES.map((_, stageIdx) => {
      let count = 0;
      for (const u of users) {
        const highest = userHighest[u.id] ?? -1;
        if (highest < 0 && stageIdx === 0) count++;
        else if (highest >= stageIdx) count++;
      }
      return count;
    });

    const funnelTop = reachedCounts[0] || 1;
    const funnelData = FUNNEL_STAGES.map((slug, i) => ({
      slug,
      label: funnelLabel(slug),
      color: funnelColor(slug),
      reachedCount: reachedCounts[i],
      duration: durationBySlug[slug] ?? null,
    }));

    return { funnelData, funnelTop };
  }, [users, statuses, stageDurations, events]);

  /* ── Derived metrics ─────────────────────────────────── */
  const lastStageReached = funnelData[funnelData.length - 1]?.reachedCount ?? 0;
  const overallConversion = funnelTop > 0 ? (lastStageReached / funnelTop) * 100 : 0;
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
  const healthLabel = healthRate >= 0.15 ? "Excellent" : healthRate >= 0.08 ? "Good" : "Needs Attention";
  const healthColor = healthRate >= 0.15 ? "#00DE8F" : healthRate >= 0.08 ? "#FBBF24" : "#EF4444";

  /* ── Canvas refs ─────────────────────────────────────── */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const tRef = useRef(0);
  const particlesRef = useRef(createFunnelParticles(60));
  const cssSizeRef = useRef({ w: 0, h: 0 });
  const stageColorsRef = useRef<string[]>([]);

  useEffect(() => {
    stageColorsRef.current = funnelData.map((s) => s.color);
  }, [funnelData]);

  /* ── Canvas drawing — funnel only, no connector lines ── */
  const drawFrame = useCallback(
    (ctx: CanvasRenderingContext2D, W: number, H: number, t: number) => {
      const cx = W / 2;
      const cy = H / 2;
      const topR = Math.min(W * 0.42, H * 0.55);
      const botR = topR * 0.22;
      const fh = H * 0.80;
      const tilt = 0.30;
      const spokeCount = 20;
      const segs = 80;
      const colors = stageColorsRef.current;

      // ── Horizontal rings
      for (let ri = 0; ri < RING_PCTS.length; ri++) {
        const pct = RING_PCTS[ri];
        const rad = topR + (botR - topR) * pct;
        const ypos = cy - fh / 2 + pct * fh;
        const ep = 0.5 + 0.5 * Math.sin(t * 2 - pct * 5);
        const alpha = 0.5 + 0.35 * ep;
        const stageIdx = Math.min(Math.floor(ri), colors.length - 1);
        const color = colors[stageIdx] || "#00DE8F";
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);

        ctx.beginPath();
        for (let i = 0; i <= segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          ctx.lineTo(cx + Math.cos(a) * rad, ypos + Math.sin(a) * rad * tilt);
        }
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Glow
        ctx.lineWidth = 5;
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.08 * ep})`;
        ctx.beginPath();
        for (let i = 0; i <= segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          ctx.lineTo(cx + Math.cos(a) * rad, ypos + Math.sin(a) * rad * tilt);
        }
        ctx.stroke();
      }

      // ── Vertical spokes
      const rotOffset = t * 0.28;
      for (let s = 0; s < spokeCount; s++) {
        const a = (s / spokeCount) * Math.PI * 2 + rotOffset;
        const brightness = (Math.cos(a) + 1) / 2;
        const alpha = 0.08 + 0.5 * brightness;
        ctx.beginPath();
        for (let ri = 0; ri < RING_PCTS.length; ri++) {
          const pct = RING_PCTS[ri];
          const rad = topR + (botR - topR) * pct;
          const ypos = cy - fh / 2 + pct * fh;
          ctx.lineTo(cx + Math.cos(a) * rad, ypos + Math.sin(a) * rad * tilt);
        }
        ctx.strokeStyle = s % 3 === 0
          ? `rgba(0,190,120,${alpha})`
          : `rgba(12,81,71,${alpha})`;
        ctx.lineWidth = 0.3 + 1.2 * brightness;
        ctx.stroke();
      }

      // ── Particles
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

        const gr = ctx.createRadialGradient(x, y, 0, x, y, size * 3);
        gr.addColorStop(0, `rgba(0,190,120,${p.alpha * fade * 0.7})`);
        gr.addColorStop(1, "rgba(0,222,143,0)");
        ctx.beginPath();
        ctx.arc(x, y, size * 3, 0, Math.PI * 2);
        ctx.fillStyle = gr;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, size * 0.6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,160,100,${p.alpha * fade})`;
        ctx.fill();
      }

      // ── Tip glow
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
    },
    []
  );

  const animate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = cssSizeRef.current.w;
    const H = cssSizeRef.current.h;
    if (W === 0 || H === 0) { animRef.current = requestAnimationFrame(animate); return; }

    ctx.fillStyle = "rgba(255,255,255,0.30)";
    ctx.fillRect(0, 0, W, H);
    drawFrame(ctx, W, H, tRef.current);
    tRef.current += 0.012;
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
      if (ctx) { ctx.scale(dpr, dpr); ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, rect.width, rect.height); }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas.parentElement!);
    animRef.current = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(animRef.current); observer.disconnect(); };
  }, [animate]);

  /* ── Empty state ─────────────────────────────────────── */
  if (users.length === 0) {
    return (
      <div className="card p-8 text-center">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Conversion Funnel</h3>
        <p className="text-xs text-brand-400">No funnel data available yet.</p>
      </div>
    );
  }

  /* ── Render ──────────────────────────────────────────── */
  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-surface-200/60">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">Conversion Funnel</h3>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-accent/10 text-accent border border-accent/20">
            <span className="w-1 h-1 rounded-full bg-accent animate-pulse" />
            Live
          </span>
        </div>
        <p className="text-xs text-brand-400 mt-0.5">
          {fmt.count(funnelTop)} users &middot; {overallConversion.toFixed(1)}% end-to-end conversion
        </p>
      </div>

      {/* ── Canvas (centered) + Stage Cards below ─────── */}
      <div className="px-5 py-5">
        {/* Canvas — centered, landscape aspect ratio */}
        <div className="relative w-full max-w-[480px] mx-auto aspect-[4/3]">
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        </div>

        {/* Stage metric cards — horizontal row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
          {funnelData.map((stage, i) => {
            const prevReached = i === 0 ? funnelTop : funnelData[i - 1].reachedCount;
            const stageConversion = prevReached > 0 ? stage.reachedCount / prevReached : 0;
            const ofTotal = funnelTop > 0 ? (stage.reachedCount / funnelTop) * 100 : 0;
            const variant = i === 0 ? "success" : conversionVariant(stageConversion);

            return (
              <div
                key={stage.slug}
                className="relative rounded-xl border border-surface-200/60 px-4 py-3 bg-white hover:shadow-card transition-shadow duration-200 overflow-hidden"
              >
                {/* Top accent bar */}
                <div
                  className="absolute top-0 left-0 right-0 h-[2px]"
                  style={{ backgroundColor: stage.color }}
                />

                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold border-2 flex-shrink-0"
                    style={{ borderColor: stage.color, color: stage.color }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <span className="text-[10px] font-bold text-gray-700 uppercase tracking-wider truncate">
                    {stage.label}
                  </span>
                </div>

                <p className="text-xl font-bold text-gray-900 tabular-nums">
                  {stage.reachedCount.toLocaleString()}
                </p>

                {/* Progress bar */}
                <div className="flex items-center gap-2 mt-2">
                  <div className="flex-1 h-1 bg-surface-200/80 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${Math.max(ofTotal, 5)}%`,
                        backgroundColor: stage.color,
                      }}
                    />
                  </div>
                  <span className="text-[10px] font-bold tabular-nums text-brand-400">
                    {ofTotal.toFixed(0)}%
                  </span>
                </div>

                {/* Conversion + duration */}
                <div className="flex items-center gap-2 mt-1.5">
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
            );
          })}
        </div>
      </div>

      {/* ── Summary Footer ───────────────────────────────── */}
      <div className="px-5 py-4 border-t border-surface-200/60 bg-surface-50/60">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl px-3 py-2.5 border border-surface-200/40">
            <p className="text-[10px] uppercase tracking-[0.1em] text-brand-400 font-medium">Overall Conversion</p>
            <p className="text-lg font-bold text-gray-900 tabular-nums mt-0.5">{overallConversion.toFixed(1)}%</p>
          </div>
          <div className="rounded-xl px-3 py-2.5 border border-surface-200/40">
            <p className="text-[10px] uppercase tracking-[0.1em] text-brand-400 font-medium">Total Drop-Off</p>
            <p className="text-lg font-bold text-red-500 tabular-nums mt-0.5">{totalDropOff.toLocaleString()}</p>
          </div>
          <div className="rounded-xl px-3 py-2.5 border border-surface-200/40">
            <p className="text-[10px] uppercase tracking-[0.1em] text-brand-400 font-medium">Avg Stage Conv.</p>
            <p className="text-lg font-bold text-gray-900 tabular-nums mt-0.5">{avgStageConversion.toFixed(1)}%</p>
          </div>
          <div className="rounded-xl px-3 py-2.5 border border-surface-200/40">
            <p className="text-[10px] uppercase tracking-[0.1em] text-brand-400 font-medium">Funnel Health</p>
            <p className="text-lg font-bold mt-0.5" style={{ color: healthColor }}>{healthLabel}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
