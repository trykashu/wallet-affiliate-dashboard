# Admin Overview — Split Payova Out of the Referral Trend Chart — Design

**Date:** 2026-06-05
**Status:** Approved (design)
**Area:** Admin → Overview (`src/app/admin/page.tsx`), builds on the referral trend chart shipped earlier today.

---

## Problem / Goal

The new "Users Referred & Referred Volume" chart blends Payova (whitelabel) activity with
organic Kashu referrals. Separate Payova out: the main chart should show **non-Payova** users
and volume, and **Payova gets its own dual-axis card** (same shape — users referred as bars,
referred volume as a line, Monthly/Weekly dropdown), themed **purple**.

## Decisions (from brainstorming)

- **Payova identity:** affiliates with a non-null `whitelabel_brand_id` — the same definition
  the admin earnings/payouts pages already use (`.is("whitelabel_brand_id", null)`). Payova is
  the only whitelabel brand today; using the general flag keeps it consistent and future-proof.
- **Main card** "Users Referred & Referred Volume" → now **excludes** Payova. Colors unchanged
  (bars `#0C5147`, line/area `#00DE8F`).
- **Payova card** "Payova — Users Referred & Referred Volume" → Payova only, **purple**: bars
  `#7C3AED` (violet-600), line + area `#8B5CF6` (violet-500). Same Monthly/Weekly dropdown.
- Both cards are per-period (not cumulative) and reuse the existing 12-month / 12-week windows.
- The Payova card is **always rendered** (renders zeros if a period has no Payova activity).

## Approach

Reuse the already-tested pure `buildReferralTrend` unchanged. Add a thin
`buildSegmentedReferralTrend` that partitions the input rows by `affiliate_id` into Payova vs
non-Payova, then calls `buildReferralTrend` on each segment. Parameterize the existing
`ReferralTrendChart` with color/title props so one component renders both cards.

## Components & files

**Modify** `src/lib/admin/referral-trend.ts`
- Add:
  ```ts
  export interface SegmentedReferralTrend { main: ReferralTrend; payova: ReferralTrend; }
  export function buildSegmentedReferralTrend(
    users: Array<{ created_at: string; affiliate_id: string }>,
    transactions: Array<{ affiliate_id: string | null; transaction_type: string; self_referral: boolean; transaction_date: string | null; amount: number }>,
    payovaAffiliateIds: Set<string>,
    now: Date,
  ): SegmentedReferralTrend;
  ```
- Logic: partition `users` and `transactions` by `payovaAffiliateIds.has(affiliate_id)`; a row
  whose `affiliate_id` is null or not in the set goes to **main**. Then
  `main = buildReferralTrend(mainUsers, mainTxns, now)` and
  `payova = buildReferralTrend(payovaUsers, payovaTxns, now)`. `buildReferralTrend` is unchanged.

**Modify** `src/components/admin/ReferralTrendChart.tsx`
- Add props with teal defaults so existing usage is unaffected:
  ```ts
  interface Props {
    monthly: ReferralBucket[];
    weekly: ReferralBucket[];
    title?: string;          // default "Users Referred & Referred Volume"
    barColor?: string;       // default "#0C5147"
    lineColor?: string;      // default "#00DE8F"
    gradientId?: string;     // default "referralVolumeGrad" — MUST be unique per instance
  }
  ```
- Replace the hardcoded `#0C5147` / `#00DE8F` / `id="referralVolumeGrad"` / `<h3>` text with
  the props (legend swatches use the same color props). The gradient `<defs>` id and its
  `fill="url(#...)"` reference both use `gradientId` so two instances on one page don't collide.

**Modify** `src/app/admin/page.tsx`
- Add `affiliate_id` to the transactions select (still date-bounded to 13 months).
- Build `const payovaIds = new Set(affiliates.filter(a => a.whitelabel_brand_id != null).map(a => a.id));`
- `const trend = buildSegmentedReferralTrend(users, transactions, payovaIds, new Date());`
- Render the main card `<ReferralTrendChart monthly={trend.main.monthly} weekly={trend.main.weekly} />`
  (defaults = teal, title unchanged) and below it the Payova card:
  ```tsx
  <ReferralTrendChart
    monthly={trend.payova.monthly}
    weekly={trend.payova.weekly}
    title="Payova — Users Referred & Referred Volume"
    barColor="#7C3AED"
    lineColor="#8B5CF6"
    gradientId="payovaVolumeGrad"
  />
  ```

## Data flow

`affiliates` (already loaded, includes `whitelabel_brand_id`) → Payova ID set.
`users` (already loaded, includes `affiliate_id`) + `transactions` (now selecting `affiliate_id`)
→ `buildSegmentedReferralTrend` on the server → two `ReferralTrend` objects → two client chart
instances. Only aggregated buckets cross to the client (no raw rows).

## Edge cases

- A transaction with null/unknown `affiliate_id` → counted in **main** (never silently dropped).
- No Payova activity in a period → purple card renders zeros (axis max floors at 1; existing behavior).
- Gradient id collision avoided via the `gradientId` prop (`referralVolumeGrad` vs `payovaVolumeGrad`).
- Self-referral / non-"Transfer In" filtering and the 13-month bound are unchanged (handled by
  `buildReferralTrend` + the query).

## Testing

Pure unit tests for `buildSegmentedReferralTrend` (`node:test`, fixed `now`):
- A Payova affiliate's users + transactions appear ONLY in `payova`; a non-Payova affiliate's
  appear ONLY in `main`.
- A transaction with `affiliate_id: null` (or an id not in the set) lands in `main`.
- Totals reconcile: `main + payova` per bucket equals an unsegmented `buildReferralTrend` over
  the same input.
- Empty Payova set → everything in `main`, `payova` all zero.

`ReferralTrendChart` remains an inline-SVG client component (no unit test per repo convention);
verified via `tsc` + `npm run build` + a manual look (both cards render, purple Payova card,
dropdown works on each independently).

## Out of scope (YAGNI)

- A combined/grand-total toggle, per-brand breakdown beyond Payova, or configurable colors in UI.
- Any change to `buildReferralTrend` itself or to how transactions/users are ingested.
