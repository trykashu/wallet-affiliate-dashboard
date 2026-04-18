# UI Parity with MRP Dashboard — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring the Wallet Affiliate Dashboard UI to the same visual polish and feature completeness as the MRP Dashboard.

**Architecture:** Read each MRP source file, identify the missing visual elements/features, and port them to the wallet dashboard with affiliate-specific adaptations. No new libraries — everything uses existing Tailwind utilities, inline SVG, and the shared Kashu design system.

**Tech Stack:** Next.js 16, React 18, Tailwind CSS 3.4, TypeScript, inline SVG charts

---

## Discrepancy Summary

| # | Gap | Severity | MRP Has | Wallet Has |
|---|-----|----------|---------|------------|
| 1 | Hero section on overview page | HIGH | Gradient card with animated orbs, grid texture, quick stats, breathing animations | Plain text greeting |
| 2 | AutoRefresh + RealtimeRefresh | MEDIUM | 60s polling + Supabase realtime subscription | Nothing — data is stale until page reload |
| 3 | Earnings graph + projections | MEDIUM | 12-month EarningsGraph + RevenueProjection chart | Just EarningsCard + table |
| 4 | ReferralLinkCard dual variants | LOW | merchant (accent) + mrp (brand) variants | Single accent-only card |
| 5 | Login form branding polish | LOW | Full hero section with gradient background, feature bullets, Kashu logo | Functional but less polished |
| 6 | Missing sidebar icons | LOW | 20+ inline SVG icons | 15 icons (missing 5) |
| 7 | Tax documents on payouts | LOW | TaxDocuments component in payouts flow | Not present |
| 8 | Admin overview richness | MEDIUM | Referral trend chart, processing rate chart, attribution accuracy, sync health | Just stat cards + webhook table |

---

### Task 1: Dashboard Hero Section

**Files:**
- Modify: `src/app/dashboard/page.tsx`

**Reference:** Read MRP's hero at `/Users/milespietsch/Desktop/Claude/Workspace/mrp-dashboard/src/app/dashboard/page.tsx`

**Step 1: Read the MRP hero section code**

The MRP hero has:
- Full-width gradient card (`bg-gradient-to-br from-brand-600 to-brand-700`)
- Grid texture overlay (`radial-gradient` pattern at 24px spacing, opacity 0.04)
- 2 breathing ambient orbs (accent and brand colors with `animate-breathe`)
- Greeting with partner name + "Active Partner" pulsing badge
- 2 glass stat cards (desktop-only) showing merchant count + approved count
- `animate-fade-in` and `animate-reveal-up` stagger animations

**Step 2: Replace the plain greeting in wallet dashboard**

Replace the current greeting `<h1>` block with a full hero card matching MRP's pattern. Adapt content:
- "Active Affiliate" badge instead of "Active Partner"
- Quick stats: Total Users + Transacted (instead of Total Referred + Approved)
- Same gradient, grid texture, orbs, and animations

**Step 3: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 4: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat: add hero section with gradient, orbs, and quick stats"
```

---

### Task 2: AutoRefresh + RealtimeRefresh Components

**Files:**
- Create: `src/components/layout/AutoRefresh.tsx`
- Create: `src/components/layout/RealtimeRefresh.tsx`
- Modify: `src/app/dashboard/layout.tsx`

**Reference:** Read MRP's components:
- `/Users/milespietsch/Desktop/Claude/Workspace/mrp-dashboard/src/components/layout/AutoRefresh.tsx`
- `/Users/milespietsch/Desktop/Claude/Workspace/mrp-dashboard/src/components/layout/RealtimeRefresh.tsx`

**Step 1: Fork AutoRefresh from MRP**

Client component that calls `router.refresh()` on an interval (default 60s). Shows a subtle "refreshing" indicator. Copy from MRP verbatim — no affiliate-specific changes needed.

**Step 2: Fork RealtimeRefresh from MRP**

Client component that subscribes to Supabase realtime changes on key tables (`referred_users`, `earnings`, `notifications`) and triggers `router.refresh()` on change. Change table names from MRP's (`merchants`, `pipeline_events`) to wallet's (`referred_users`, `funnel_events`).

**Step 3: Add both to dashboard layout**

In `src/app/dashboard/layout.tsx`, import and render both components inside the main content area (after the children, before the closing div). Match MRP's placement.

**Step 4: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 5: Commit**

```bash
git add src/components/layout/AutoRefresh.tsx src/components/layout/RealtimeRefresh.tsx src/app/dashboard/layout.tsx
git commit -m "feat: add auto-refresh (60s) and realtime refresh on data changes"
```

---

### Task 3: Earnings Graph (12-Month Chart)

**Files:**
- Create: `src/components/dashboard/EarningsGraph.tsx`
- Modify: `src/app/dashboard/earnings/page.tsx`

**Reference:** Read MRP's chart:
- `/Users/milespietsch/Desktop/Claude/Workspace/mrp-dashboard/src/components/dashboard/EarningsGraph.tsx`

**Step 1: Fork EarningsGraph from MRP**

The MRP EarningsGraph is a pure inline SVG chart showing monthly earnings over 12 months. It uses:
- Cubic bezier path for the line
- Gradient fill under the line (accent color fading to transparent)
- Dot markers at each data point (white fill, accent stroke)
- Y-axis labels (slate-400)
- Grid lines (gray-200, dashed)
- Hover tooltip showing month + amount

Fork this component. Simplify: remove the "upfront vs residual" breakdown (wallet has one-time earnings only). Show total earnings per month as a single line.

**Step 2: Compute monthly earnings data in the page**

In `src/app/dashboard/earnings/page.tsx`, compute monthly totals from the earnings query (group by month, last 12 months). Pass as `data` prop to EarningsGraph.

**Step 3: Add EarningsGraph to the earnings page**

Place it between EarningsCard and EarningsTable in a card wrapper.

**Step 4: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 5: Commit**

```bash
git add src/components/dashboard/EarningsGraph.tsx src/app/dashboard/earnings/page.tsx
git commit -m "feat: add 12-month earnings graph on earnings page"
```

---

### Task 4: Revenue Projection Chart

**Files:**
- Create: `src/components/dashboard/RevenueProjection.tsx`
- Create: `src/lib/projections.ts`
- Modify: `src/app/dashboard/earnings/page.tsx`

**Reference:** Read MRP's files:
- `/Users/milespietsch/Desktop/Claude/Workspace/mrp-dashboard/src/components/dashboard/RevenueProjection.tsx`
- `/Users/milespietsch/Desktop/Claude/Workspace/mrp-dashboard/src/lib/projections.ts`

**Step 1: Fork projections.ts from MRP**

Adapt the projection logic for the wallet model:
- Input: referred users, earnings history, commission rate
- Output: 12-month forecast of expected earnings
- Remove residual earnings logic (MRP-specific)
- Base projection on: avg new users/month × conversion rate × avg transaction fee × commission rate
- Add confidence decay over time (same pattern as MRP)

**Step 2: Fork RevenueProjection component**

Same inline SVG chart pattern as MRP — projected line with dashed style, confidence band (shaded area), actual line (solid). Adapt labels from "merchant volume" to "user conversion earnings".

**Step 3: Add to earnings page**

Place after EarningsGraph. Pass projection data computed server-side.

**Step 4: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 5: Commit**

```bash
git add src/components/dashboard/RevenueProjection.tsx src/lib/projections.ts src/app/dashboard/earnings/page.tsx
git commit -m "feat: add 12-month revenue projection chart"
```

---

### Task 5: Login Page Polish

**Files:**
- Modify: `src/components/auth/LoginForm.tsx`

**Reference:** Read MRP's login form:
- `/Users/milespietsch/Desktop/Claude/Workspace/mrp-dashboard/src/components/auth/LoginForm.tsx`

**Step 1: Read MRP's LoginForm for visual elements**

The MRP login has:
- Split layout: left hero panel (dark gradient bg with brand messaging) + right form panel
- Hero section with Kashu logo, tagline, 3 feature bullets with check icons
- Gradient background on left panel (`bg-gradient-to-br from-brand-600 to-brand-700`)
- Ambient orb effects
- The form side has clean white background with proper spacing

**Step 2: Match the visual structure**

Update the wallet LoginForm to match MRP's split-panel layout. Change copy:
- "Earn on every wallet user you refer" (already correct)
- Feature bullets: "Real-time referral funnel tracking", "Earnings & commission insights", "Leaderboard & performance tiers" (already correct)
- Ensure the left hero panel has the same gradient, logo placement, and ambient effects as MRP

**Step 3: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 4: Commit**

```bash
git add src/components/auth/LoginForm.tsx
git commit -m "fix: polish login page to match MRP visual quality"
```

---

### Task 6: Admin Overview — Trend Charts

**Files:**
- Create: `src/components/admin/AffiliateGrowthChart.tsx`
- Create: `src/components/admin/UserConversionChart.tsx`
- Modify: `src/app/admin/page.tsx`

**Reference:** Read MRP's admin components:
- `/Users/milespietsch/Desktop/Claude/Workspace/mrp-dashboard/src/components/admin/PartnerGrowthCharts.tsx`
- `/Users/milespietsch/Desktop/Claude/Workspace/mrp-dashboard/src/app/admin/page.tsx`

**Step 1: Fork PartnerGrowthCharts → AffiliateGrowthChart**

Inline SVG line chart showing affiliate sign-ups over time (monthly). Same visual pattern as MRP — accent line, gradient fill, dot markers. Data source: count affiliates grouped by `created_at` month.

**Step 2: Create UserConversionChart**

New chart showing referred user conversion rate over time. Line chart: monthly (users reaching transaction_run / total new users). Same SVG pattern.

**Step 3: Update admin overview page**

Add charts in a 2-column grid above the existing stat cards. Query monthly affiliate counts and user conversion data server-side.

**Step 4: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 5: Commit**

```bash
git add src/components/admin/AffiliateGrowthChart.tsx src/components/admin/UserConversionChart.tsx src/app/admin/page.tsx
git commit -m "feat: add admin trend charts (affiliate growth, user conversion)"
```

---

### Task 7: Demo Page — Match Updated Components

**Files:**
- Modify: `src/app/demo/page.tsx`
- Modify: `src/lib/demo-data.ts`

**Step 1: Update demo page to include hero section**

After Task 1 adds the hero to the real dashboard, the demo page needs the same hero with demo data. Copy the hero JSX from the updated `dashboard/page.tsx` and use `DEMO_AFFILIATE` data.

**Step 2: Add monthly earnings demo data**

Add `DEMO_MONTHLY_EARNINGS` to demo-data.ts — 12 months of fake earnings data for the EarningsGraph (if it's shown on overview or linked from demo).

**Step 3: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 4: Commit**

```bash
git add src/app/demo/page.tsx src/lib/demo-data.ts
git commit -m "feat: update demo page with hero section and enriched data"
```

---

### Task 8: Final Polish Pass

**Files:**
- Modify: various components as needed

**Step 1: Verify all pages render correctly**

```bash
npm run build
```

Visit each route mentally (or via WebFetch if deployed):
- `/demo` — hero, stats, funnel, activity, earnings
- `/login` — split panel layout
- `/dashboard` — hero with quick stats (when logged in)
- `/dashboard/earnings` — earnings card + graph + projection + table
- `/dashboard/analytics` — funnel + drop-off + leaderboard
- `/admin` — stat cards + trend charts + webhook table

**Step 2: Fix any TypeScript or build errors**

**Step 3: Final commit**

```bash
git add -A
git commit -m "fix: final UI polish pass for MRP parity"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Dashboard hero section | `dashboard/page.tsx` |
| 2 | AutoRefresh + RealtimeRefresh | 2 new components + layout |
| 3 | 12-month earnings graph | new component + earnings page |
| 4 | Revenue projection chart | new component + lib + earnings page |
| 5 | Login page polish | LoginForm.tsx |
| 6 | Admin trend charts | 2 new components + admin page |
| 7 | Demo page updates | demo page + demo data |
| 8 | Final polish pass | various |

**Total: 8 tasks.** Each builds on the last. Tasks 1-4 are the highest impact.
