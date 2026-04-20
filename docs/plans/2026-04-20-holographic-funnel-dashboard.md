# Holographic Funnel on Dashboard — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port the MRP dashboard's HolographicFunnel component to the wallet affiliate dashboard, replacing the FunnelChart widget on `/dashboard`, and remove the EarningsCard from the overview page (it stays on `/dashboard/earnings`).

**Architecture:** Copy the 671-line HolographicFunnel.tsx from MRP, adapt its type imports and stage definitions from MRP's 5-stage merchant pipeline to the wallet's 8-stage user funnel, update the dashboard page to use it, and remove the FunnelChart + EarningsCard from the overview layout.

**Tech Stack:** React 18 (Canvas 2D API, useRef, useEffect, useCallback, requestAnimationFrame), TypeScript, existing funnel-colors lib

---

## Key Adaptation Notes

The MRP HolographicFunnel uses:
- `Merchant` type → needs `ReferredUser`
- `PipelineStatus` type → needs `FunnelStatus`
- `PipelineEvent` type → needs `FunnelEvent`
- `StageDuration` type → needs to be added to wallet types (or inline)
- `pipelineColor()` / `pipelineLabel()` → needs `funnelColor()` / `funnelLabel()`
- 5 funnel stages (`new_lead`, `app_submitted`, `underwriting`, `approved`, `processing`) → 8 stages (`waitlist`, `booked_call`, `sent_onboarding`, `signed_up`, `transaction_run`, `funds_in_wallet`, `ach_initiated`, `funds_in_bank`)
- 3 exit stages (`closed`, `no_show`, `lost`) → none (wallet has no exit stages currently)
- `STAGE_PCTS` array (5 entries) → needs 8 entries
- `RING_PCTS` array (6 boundaries for 5 bands) → needs 9 boundaries for 8 bands

---

### Task 1: Add StageDuration Type

**Files:**
- Modify: `src/types/database.ts`

**Step 1: Add the StageDuration interface**

The MRP HolographicFunnel expects a `StageDuration` type. Add it to the wallet types:

```typescript
export interface StageDuration {
  status_slug: string;
  avg_hours: number;
}
```

**Step 2: Build and verify**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "feat: add StageDuration type for holographic funnel"
```

---

### Task 2: Port HolographicFunnel Component

**Files:**
- Create: `src/components/dashboard/HolographicFunnel.tsx`

**Reference:** Read the full MRP source at `/Users/milespietsch/Desktop/Claude/Workspace/mrp-dashboard/src/components/dashboard/HolographicFunnel.tsx` (671 lines).

**Step 1: Copy the MRP component and adapt**

Changes needed:

1. **Imports:** Replace MRP type imports with wallet types:
   ```typescript
   // MRP
   import type { Merchant, PipelineStatus, PipelineEvent, StageDuration } from "@/types/database";
   import { pipelineColor, pipelineLabel } from "@/lib/pipeline-colors";
   
   // Wallet
   import type { ReferredUser, FunnelStatus, FunnelEvent, StageDuration } from "@/types/database";
   import { funnelColor, funnelLabel } from "@/lib/funnel-colors";
   ```

2. **Props interface:** Change types:
   ```typescript
   interface Props {
     users: ReferredUser[];
     statuses: FunnelStatus[];
     stageDurations: StageDuration[];
     events?: FunnelEvent[];
   }
   ```

3. **FUNNEL_STAGES:** Change from MRP's 5 to wallet's 8:
   ```typescript
   const FUNNEL_STAGES = [
     "waitlist", "booked_call", "sent_onboarding", "signed_up",
     "transaction_run", "funds_in_wallet", "ach_initiated", "funds_in_bank",
   ] as const;
   ```

4. **EXIT_STAGES:** Remove or leave empty (wallet has no exit stages):
   ```typescript
   const EXIT_STAGES: string[] = [];
   ```

5. **STAGE_PCTS:** 8 evenly distributed positions:
   ```typescript
   const STAGE_PCTS = [0.06, 0.19, 0.32, 0.44, 0.56, 0.69, 0.81, 0.94];
   ```

6. **RING_PCTS:** 9 boundaries for 8 bands:
   ```typescript
   const RING_PCTS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0];
   ```

7. **All `merchant` references → `user`:**
   - `merchants` prop → `users`
   - `merchant.status_slug` → `user.status_slug`
   - Any "merchant" text labels → "user"

8. **Color/label functions:**
   - `pipelineColor(slug)` → `funnelColor(slug)`
   - `pipelineLabel(slug)` → `funnelLabel(slug)`

9. **Remove `programBenchmarks` prop** — not applicable to wallet dashboard.

10. **Remove exit stage summary row** — skip the exit stages section in the footer since wallet has none.

**Step 2: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 3: Commit**

```bash
git add src/components/dashboard/HolographicFunnel.tsx
git commit -m "feat: port HolographicFunnel from MRP with wallet funnel stages"
```

---

### Task 3: Update Dashboard Overview Page

**Files:**
- Modify: `src/app/dashboard/page.tsx`

**Step 1: Read the current dashboard page**

Read `/Users/milespietsch/Desktop/Claude/Workspace/wallet-affiliate-dashboard/src/app/dashboard/page.tsx` to understand the current layout and data fetching.

**Step 2: Replace FunnelChart with HolographicFunnel**

Changes:
1. Remove import of `FunnelChart`
2. Remove import of `EarningsCard`
3. Add import of `HolographicFunnel`
4. Add a query for stage durations (compute from `funnel_events` timestamps, same pattern as `src/app/dashboard/analytics/page.tsx`)
5. Fetch `funnel_statuses` for the component
6. Fetch `funnel_events` for the component (recent events, for accurate stage tracking)
7. Replace the `<FunnelChart>` render with `<HolographicFunnel users={users} statuses={funnelStatuses} stageDurations={stageDurations} events={events} />`
8. Remove the `<EarningsCard>` render entirely
9. Remove the earnings summary computation (the `Promise.all` queries for lifetime/thisMonth/pending/paid)
10. Adjust the grid layout — the bottom section had FunnelChart + RecentActivity + EarningsCard in 3 columns. Now it should be HolographicFunnel (full width or 2 cols) + RecentActivity (1 col)

**Step 3: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 4: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat: replace FunnelChart + EarningsCard with HolographicFunnel on dashboard"
```

---

### Task 4: Update Demo Page

**Files:**
- Modify: `src/app/demo/page.tsx`
- Modify: `src/lib/demo-data.ts`

**Step 1: Add demo stage durations to demo-data.ts**

```typescript
export const DEMO_STAGE_DURATIONS: StageDuration[] = [
  { status_slug: "waitlist", avg_hours: 48 },
  { status_slug: "booked_call", avg_hours: 24 },
  { status_slug: "sent_onboarding", avg_hours: 12 },
  { status_slug: "signed_up", avg_hours: 6 },
  { status_slug: "transaction_run", avg_hours: 72 },
  { status_slug: "funds_in_wallet", avg_hours: 2 },
  { status_slug: "ach_initiated", avg_hours: 36 },
  { status_slug: "funds_in_bank", avg_hours: 4 },
];
```

**Step 2: Update demo page**

Mirror the changes from Task 3:
- Remove FunnelChart and EarningsCard
- Add HolographicFunnel with demo data
- Adjust layout

**Step 3: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 4: Commit**

```bash
git add src/app/demo/page.tsx src/lib/demo-data.ts
git commit -m "feat: update demo page with HolographicFunnel"
```

---

### Task 5: Clean Up Unused Files

**Files:**
- Delete or keep: `src/components/dashboard/FunnelChart.tsx`

**Step 1: Check if FunnelChart is used anywhere else**

```bash
grep -rn "FunnelChart" src/
```

If only used in the old dashboard page and demo page (now replaced), delete it.

**Step 2: Verify EarningsCard is still used**

```bash
grep -rn "EarningsCard" src/
```

EarningsCard should still be imported by `src/app/dashboard/earnings/page.tsx` — do NOT delete it.

**Step 3: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove unused FunnelChart component"
```

---

### Task 6: Deploy and Verify

**Step 1: Push and deploy**

```bash
git push origin main
vercel --prod --yes
```

**Step 2: Verify the live dashboard**

Check `/demo` page — should show the holographic funnel with animated canvas rings, particles, and stage metrics. No FunnelChart widget. No EarningsCard on overview.

Check `/dashboard/earnings` — should still have EarningsCard at the top.

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Add StageDuration type | `database.ts` |
| 2 | Port HolographicFunnel from MRP | New component (671→~650 lines) |
| 3 | Update dashboard page | `dashboard/page.tsx` |
| 4 | Update demo page | `demo/page.tsx` + `demo-data.ts` |
| 5 | Clean up unused FunnelChart | Delete if unused |
| 6 | Deploy and verify | Push + deploy |

**Total: 6 tasks.** Task 2 (porting the component) is the bulk of the work.
