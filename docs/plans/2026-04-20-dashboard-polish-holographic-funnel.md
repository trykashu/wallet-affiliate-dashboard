# Dashboard Polish — Enterprise Holographic Funnel

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the HolographicFunnel into an enterprise-grade, visually stunning widget with perfect alignment and refined aesthetics. Clean up the overall `/dashboard` page composition.

**Architecture:** Rewrite the HolographicFunnel component with improved canvas geometry for 8 stages, better metric panel alignment, refined typography, and premium visual effects. Update the dashboard page layout for better visual flow.

**Tech Stack:** React 18, Canvas 2D API, Tailwind CSS, requestAnimationFrame

---

## Design Direction

**Tone:** Luxury fintech — clean, precise, confident. Think Bloomberg Terminal meets Apple Fitness dashboard. Dark canvas with luminous accents on a white card.

**Key principles:**
- Canvas funnel on dark/near-black background for maximum visual impact (not white)
- Right-side metrics with precise Y-alignment to canvas data points via connector lines
- 8 stages need more vertical breathing room — increase canvas min-height
- Stage metrics: tighten to essential info (label, count, percentage bar) — no cramping
- Summary footer: 4 crisp KPI cards with subtle glassmorphism
- The funnel should feel alive: smooth particle flow, gentle ring pulse, subtle spoke rotation

---

### Task 1: Rewrite HolographicFunnel — Canvas & Layout

**Files:**
- Modify: `src/components/dashboard/HolographicFunnel.tsx`

**Step 1: Read the current 618-line component**

Read `/Users/milespietsch/Desktop/Claude/Workspace/wallet-affiliate-dashboard/src/components/dashboard/HolographicFunnel.tsx`

**Step 2: Rewrite with these fixes**

**Canvas background — dark instead of white:**
- Change the fade trail from `rgba(255,255,255,0.30)` to `rgba(8,12,10,0.25)` (near-black with subtle green tint)
- Change initial fill from `#FFFFFF` to `#080C0A`
- This makes the glowing rings and particles pop dramatically against the dark surface
- The canvas div needs `bg-[#080C0A]` and `rounded-l-2xl` (or full rounding if stacked)

**Increase canvas height for 8 stages:**
- Change `min-h-[420px] sm:min-h-[480px]` to `min-h-[520px] sm:min-h-[600px]`
- This gives each of the 8 stages more vertical room

**Adjust funnel geometry for taller canvas:**
- `topR` (top radius): increase slightly for more dramatic taper
- `fh` (funnel height): use more of the canvas (`0.72` instead of `0.62`)
- `tilt`: keep at `0.32` — looks good

**Fix STAGE_PCTS for even distribution with padding:**
```typescript
// 8 stages, evenly distributed with top/bottom padding
const STAGE_PCTS = [0.05, 0.18, 0.31, 0.44, 0.56, 0.69, 0.82, 0.95];
```

**Fix RING_PCTS — align ring boundaries with stage positions:**
```typescript
// 9 boundaries — one above each stage and one at the very bottom
const RING_PCTS = [0.0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0];
```

**Connector lines — style upgrade:**
- Thinner, more subtle: `lineWidth = 0.5`
- Use a gradient fade from the circle out to the edge
- Change from dashed to solid with low opacity

**Circle data points — premium feel:**
- Slightly larger: `circleR = 6 + pulse * 2`
- Thicker ring stroke: `lineWidth = 2`
- Add inner gradient glow instead of flat white fill

**Particle count:** Increase from 50 to 70 for denser atmosphere on dark background

**Spoke styling on dark bg:**
- Brighter spoke colors to stand out: `rgba(0,222,143,${alpha})` for accent spokes
- Thicker on dark: `lineWidth = 0.5 + 1.5 * brightness`

**Step 3: Rewrite the right-side metrics panel**

The current panel has too much info per stage (label + count + progress bar + conv rate + duration). For 8 stages this is too dense.

Simplify each stage row to:
```
[color dot] STAGE NAME .................... COUNT
            ████████░░░░ 67%        conv 85%
```

- Stage number badge: keep the numbered circle, but smaller (w-6 h-6)
- Label: `text-[11px] font-semibold uppercase tracking-wider`
- Count: `text-sm font-bold tabular-nums`
- Progress bar: thin (h-1), using stage color
- Conversion rate: only show if > 0 and not first stage
- Duration: move to hover tooltip (not inline) to reduce clutter
- Gap between stages: `gap-1` (tight but readable)

**Absolute positioning alignment:**
Keep the `position: absolute; top: ${yPos}px; transform: translateY(-50%)` pattern but ensure the Y positions update on resize (already handled by `yPosEmittedRef`). Fix: set `yPosEmittedRef.current = false` in the resize handler so positions recalculate.

Actually, improve this: instead of emitting positions once, emit every frame during the first 500ms (while the canvas settles), then lock. This prevents first-paint misalignment.

**Step 4: Rewrite the summary footer**

4 KPI cards in a row with subtle glassmorphism:
```
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Overall Conv.   │ │ Total Drop-Off  │ │ Avg Stage Conv. │ │ Funnel Health   │
│   10.0%         │ │       27        │ │   83.2%         │ │  ● Good         │
└─────────────────┘ └─────────────────┘ └─────────────────┘ └─────────────────┘
```

Style: `bg-surface-50/60 border border-surface-200/40 rounded-xl px-4 py-3`

**Step 5: Header — subtle refinement**

Keep "Conversion Funnel" + "Live" badge. Add total count + overall conversion inline:
```
Conversion Funnel  ● Live        30 users · 10.0% end-to-end
```

**Step 6: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 7: Commit**

```bash
git add src/components/dashboard/HolographicFunnel.tsx
git commit -m "feat: redesign HolographicFunnel with dark canvas and enterprise polish"
```

---

### Task 2: Dashboard Page Layout Refinement

**Files:**
- Modify: `src/app/dashboard/page.tsx`

**Step 1: Read the current layout**

The current order is: Hero → ReferralLink → StatsRow → HolographicFunnel → RecentActivity

**Step 2: Optimize visual flow**

Reorder for better storytelling:
1. **Hero** (greeting + quick stats) — stays at top
2. **StatsRow** (3 cards) — immediately below hero for at-a-glance metrics
3. **HolographicFunnel** (full width) — the main visual centerpiece
4. **2-column grid:** ReferralLinkCard (left) + RecentActivity (right) — supporting info at bottom

This puts the funnel front and center after the stats, and groups the secondary content at the bottom.

**Step 3: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 4: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat: refine dashboard layout — funnel as centerpiece"
```

---

### Task 3: Update Demo Page to Match

**Files:**
- Modify: `src/app/demo/page.tsx`

**Step 1: Mirror the layout changes from Task 2**

Same component order as the real dashboard.

**Step 2: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 3: Commit**

```bash
git add src/app/demo/page.tsx
git commit -m "feat: update demo page layout to match dashboard"
```

---

### Task 4: Deploy and Verify

**Step 1: Push and deploy**

```bash
git push origin main
vercel --prod --yes
```

**Step 2: Visual verification**

Check `/demo` — the holographic funnel should have:
- Dark canvas background with glowing green/teal rings
- Flowing particles visible against the dark surface
- Right-side metrics perfectly aligned to connector lines from data points
- Clean typography, no cramping
- Summary footer with 4 KPI cards
- Overall layout: Hero → Stats → Funnel → (ReferralLink | RecentActivity)

---

## Summary

| Task | What | Key Change |
|------|------|-----------|
| 1 | **Rewrite HolographicFunnel** | Dark canvas bg, better geometry for 8 stages, refined metrics panel, premium effects |
| 2 | Dashboard layout | Reorder: Hero → Stats → Funnel → (Link + Activity) |
| 3 | Demo page | Mirror layout |
| 4 | Deploy | Ship it |

**Total: 4 tasks.** Task 1 is the heavy lift — the component rewrite.
