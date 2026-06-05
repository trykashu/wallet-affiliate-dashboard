# Admin Overview — Referral Trend Chart — Design

**Date:** 2026-06-05
**Status:** Approved (design)
**Area:** Admin → Overview (`src/app/admin/page.tsx`)

---

## Problem / Goal

The admin overview's top trend row shows a "User Conversion Rate" chart
([UserConversionChart.tsx](../../../src/components/admin/UserConversionChart.tsx)) that the
team no longer wants. Replace it with a single combined chart of **users referred** and
**total referred volume** over time, with a dropdown to switch between **Monthly** and
**Weekly** buckets.

## Decisions (from brainstorming)

- **Remove** `UserConversionChart` (the "User Conversion Rate" card) entirely.
- **Add** one combined **dual-axis** chart:
  - Users referred → **bars**, left axis (counts), brand-600 `#0C5147`.
  - Total referred volume → **line + soft area**, right axis (currency), accent `#00DE8F`.
- **Volume source:** the `transactions` table — sum of rows where
  `transaction_type === "Transfer In"` and `self_referral === false`, bucketed by
  `transaction_date`. (Matches how `referred_volume_total` is computed.)
- **Users source:** `referred_users`, bucketed by `created_at`.
- **Per-period values** (not cumulative): each bar/point is the value *in* that month/week.
- **Granularity dropdown:** Monthly (last 12 calendar months) or Weekly (last 12 weeks,
  Monday-started). Default Monthly.
- **Data flow (Approach A):** the server component pre-aggregates BOTH monthly and weekly
  bucket arrays and passes them to the client chart. The dropdown toggles between two
  already-loaded datasets — instant, no refetch, tiny payload (no raw transaction rows
  shipped to the client).

## Components & files

**New**
- `src/lib/admin/referral-trend.ts` — pure aggregation, no I/O:
  ```ts
  export interface ReferralBucket { key: string; label: string; users: number; volume: number; }
  export interface ReferralTrend { monthly: ReferralBucket[]; weekly: ReferralBucket[]; }
  export function buildReferralTrend(
    users: Array<{ created_at: string }>,
    transactions: Array<{ transaction_type: string; self_referral: boolean; transaction_date: string | null; amount: number }>,
    now: Date,                // passed in for testability (no implicit Date.now)
  ): ReferralTrend;
  ```
- `src/components/admin/ReferralTrendChart.tsx` — `"use client"` component.
  Props: `{ monthly: ReferralBucket[]; weekly: ReferralBucket[] }`. Owns a
  `granularity` state (`"monthly" | "weekly"`, default `"monthly"`) and renders the
  dual-axis SVG. Reuses the existing `smoothPath` + grid/brand conventions.

**Changed**
- `src/app/admin/page.tsx`:
  - Remove the `UserConversionChart` import and its `<UserConversionChart users={users} />` render.
  - Add a `transactions` query to the existing `Promise.all` (service client): select
    `transaction_type, self_referral, transaction_date, amount` (filter to `Transfer In` /
    non-self-referral can be done in SQL or in the pure function — the pure function already
    filters, so a plain select is fine).
  - Compute `const trend = buildReferralTrend(users, transactions, new Date())`.
  - Render `<ReferralTrendChart monthly={trend.monthly} weekly={trend.weekly} />` in the slot
    the conversion chart occupied (still beside `AffiliateGrowthChart`).

**Deleted**
- `src/components/admin/UserConversionChart.tsx` — after confirming no other references
  (`grep -rn UserConversionChart src/`).

## Aggregation rules (`buildReferralTrend`)

- **Monthly buckets:** the last 12 calendar months ending in `now`'s month. Key `YYYY-MM`,
  label = short month (`Jan`, `Feb`, …). Mirrors `AffiliateGrowthChart`.
- **Weekly buckets:** the last 12 weeks, each starting Monday. Key = week-start date
  `YYYY-MM-DD`, label = `MMM D` (e.g. `Mar 3`).
- **Users:** for each user, bucket by `created_at`; increment `users` if the bucket is in
  the window.
- **Volume:** for each transaction where `transaction_type === "Transfer In"` and
  `self_referral === false` and `transaction_date` is non-null, bucket by `transaction_date`;
  add `amount` to `volume`. Null/blank dates skipped; out-of-window dates ignored.
- Buckets are pre-seeded to `{ users: 0, volume: 0 }` so quiet periods render as zero.
- `now` is a parameter (not `new Date()` inside) so the function is deterministic in tests.

## Chart UI

Single card, header **"Users Referred & Referred Volume"** with a `<select>` (Monthly /
Weekly) top-right styled to match existing inputs (`border-gray-200 rounded-xl text-sm`).
Dual-axis inline SVG:
- **Left axis** = user counts (integer ticks); bars in `#0C5147`.
- **Right axis** = volume via `fmt.currencyCompact`; line + soft area gradient in `#00DE8F`
  (reusing the existing area-gradient + `smoothPath` pattern).
- Independent scales: `usersMax = max(users, 1)`, `volumeMax = max(volume, 1)`.
- X labels = bucket labels. Small legend: `[#] Users` / `(—) Volume`.
- Muted text = `text-brand-400`; no banned classes; `tabular-nums` on numeric text.
- Default granularity Monthly; switching swaps the pre-loaded dataset client-side (instant).

## Edge cases

- Empty/sparse data: axis maxes floor at 1; zero periods render flat (no bar, line at 0).
- A period with users but no volume (or vice-versa) renders correctly on its own axis.
- Null/blank `transaction_date` skipped; weekly window crossing a year boundary handled
  because keys carry the year.
- Non-"Transfer In" or self-referral transactions never contribute to volume.

## Testing

Pure unit tests for `buildReferralTrend` (`node:test` + `assert/strict`, colocated
`referral-trend.test.ts`), passing a fixed `now`:
- Monthly bucketing: users by `created_at`, volume by `transaction_date`, into the right months.
- Weekly bucketing: 12 Monday-started weeks, correct week assignment incl. a year boundary.
- Filtering: non-"Transfer In" and `self_referral === true` excluded from volume.
- Null `transaction_date` skipped; out-of-window rows excluded.
- Per-period correctness (not cumulative) and empty-input (all buckets zero).

The SVG client component follows the repo convention of no unit test for inline-SVG/client
components; verified via `tsc --noEmit` + `npm run build` + a manual look at the admin overview.

## Out of scope (YAGNI)

- Cumulative mode, custom date ranges, CSV export, per-affiliate filtering.
- Any change to how transactions/referred_users are ingested.
- Touching `AffiliateGrowthChart` or other overview cards.
