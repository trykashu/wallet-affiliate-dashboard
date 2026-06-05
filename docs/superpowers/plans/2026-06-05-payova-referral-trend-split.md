# Split Payova Out of Referral Trend Chart — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show non-Payova referral activity in the main trend chart and Payova activity in its own purple dual-axis card on the admin overview.

**Architecture:** A pure `buildSegmentedReferralTrend` partitions users + transactions by `affiliate_id` into Payova vs non-Payova (Payova = affiliates with non-null `whitelabel_brand_id`) and calls the existing, unchanged `buildReferralTrend` on each. The `ReferralTrendChart` component gains color/title/gradientId props (teal defaults) so one component renders both the teal main card and the purple Payova card.

**Tech Stack:** Next.js 15 (server + client components), TypeScript, inline SVG, `node:test`/`tsx`, Tailwind + Kashu tokens.

**Spec:** `docs/superpowers/specs/2026-06-05-payova-referral-trend-split-design.md`

---

### Task 1: Pure `buildSegmentedReferralTrend`

**Files:**
- Modify: `src/lib/admin/referral-trend.ts`
- Test: `src/lib/admin/referral-trend.test.ts` (add tests; do not change existing ones)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/admin/referral-trend.test.ts` (the file already imports `buildReferralTrend` and defines `NOW`; add `buildSegmentedReferralTrend` to the import):

```ts
import { buildReferralTrend, buildSegmentedReferralTrend } from "./referral-trend";

test("segmented: payova rows only in payova, others only in main", () => {
  const users = [
    { created_at: "2026-06-10T12:00:00", affiliate_id: "affP" },
    { created_at: "2026-06-11T12:00:00", affiliate_id: "affX" },
  ];
  const txns = [
    { affiliate_id: "affP", transaction_type: "Transfer In", self_referral: false, transaction_date: "2026-06-10T12:00:00", amount: 500 },
    { affiliate_id: "affX", transaction_type: "Transfer In", self_referral: false, transaction_date: "2026-06-10T12:00:00", amount: 300 },
  ];
  const { main, payova } = buildSegmentedReferralTrend(users, txns, new Set(["affP"]), NOW);
  assert.equal(payova.monthly[11].users, 1);
  assert.equal(payova.monthly[11].volume, 500);
  assert.equal(main.monthly[11].users, 1);
  assert.equal(main.monthly[11].volume, 300);
});

test("segmented: null/unknown affiliate_id transaction counts in main", () => {
  const txns = [
    { affiliate_id: null, transaction_type: "Transfer In", self_referral: false, transaction_date: "2026-06-10T12:00:00", amount: 100 },
    { affiliate_id: "unknown", transaction_type: "Transfer In", self_referral: false, transaction_date: "2026-06-10T12:00:00", amount: 50 },
  ];
  const { main, payova } = buildSegmentedReferralTrend([], txns, new Set(["affP"]), NOW);
  assert.equal(main.monthly[11].volume, 150);
  assert.equal(payova.monthly[11].volume, 0);
});

test("segmented: main + payova reconcile to an unsegmented trend", () => {
  const users = [
    { created_at: "2026-06-10T12:00:00", affiliate_id: "affP" },
    { created_at: "2026-05-10T12:00:00", affiliate_id: "affX" },
  ];
  const txns = [
    { affiliate_id: "affP", transaction_type: "Transfer In", self_referral: false, transaction_date: "2026-06-10T12:00:00", amount: 500 },
    { affiliate_id: "affX", transaction_type: "Transfer In", self_referral: false, transaction_date: "2026-05-10T12:00:00", amount: 250 },
  ];
  const { main, payova } = buildSegmentedReferralTrend(users, txns, new Set(["affP"]), NOW);
  const whole = buildReferralTrend(users, txns, NOW);
  for (let i = 0; i < whole.monthly.length; i++) {
    assert.equal(main.monthly[i].users + payova.monthly[i].users, whole.monthly[i].users);
    assert.equal(main.monthly[i].volume + payova.monthly[i].volume, whole.monthly[i].volume);
  }
});

test("segmented: empty payova set puts everything in main", () => {
  const users = [{ created_at: "2026-06-10T12:00:00", affiliate_id: "affX" }];
  const { main, payova } = buildSegmentedReferralTrend(users, [], new Set<string>(), NOW);
  assert.equal(main.monthly[11].users, 1);
  assert.ok(payova.monthly.every((b) => b.users === 0 && b.volume === 0));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -A3 segmented`
Expected: FAIL — `buildSegmentedReferralTrend` is not exported.

- [ ] **Step 3: Implement `buildSegmentedReferralTrend`**

Append to `src/lib/admin/referral-trend.ts` (after `buildReferralTrend`):

```ts
export interface SegmentedReferralTrend {
  main: ReferralTrend;
  payova: ReferralTrend;
}

/**
 * Partition users + transactions by affiliate_id into Payova vs non-Payova,
 * then aggregate each segment with buildReferralTrend. A row whose affiliate_id
 * is null/undefined or not in payovaAffiliateIds counts as non-Payova ("main").
 */
export function buildSegmentedReferralTrend(
  users: Array<{ created_at: string; affiliate_id: string | null }>,
  transactions: Array<{
    affiliate_id: string | null;
    transaction_type: string;
    self_referral: boolean;
    transaction_date: string | null;
    amount: number;
  }>,
  payovaAffiliateIds: Set<string>,
  now: Date,
): SegmentedReferralTrend {
  const isPayova = (id: string | null): boolean => id != null && payovaAffiliateIds.has(id);
  return {
    main: buildReferralTrend(
      users.filter((u) => !isPayova(u.affiliate_id)),
      transactions.filter((t) => !isPayova(t.affiliate_id)),
      now,
    ),
    payova: buildReferralTrend(
      users.filter((u) => isPayova(u.affiliate_id)),
      transactions.filter((t) => isPayova(t.affiliate_id)),
      now,
    ),
  };
}
```

Note: `buildReferralTrend`'s parameter types (`{ created_at }` / the 4-field txn shape) are structural subsets of the richer inputs here — passing the filtered arrays is type-safe (extra `affiliate_id` is ignored; not a fresh object literal so no excess-property error).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -6`
Expected: 0 failures (4 new segmented tests + all prior tests pass).

- [ ] **Step 5: Typecheck + commit**

```bash
./node_modules/.bin/tsc --noEmit
git add src/lib/admin/referral-trend.ts src/lib/admin/referral-trend.test.ts
git commit -m "feat(admin): buildSegmentedReferralTrend (Payova vs main partition)"
```

---

### Task 2: Parameterize `ReferralTrendChart` (color/title/gradient props)

**Files:**
- Modify: `src/components/admin/ReferralTrendChart.tsx`

No unit test (inline-SVG/client component). Verified by `tsc` + `npm run build`. Defaults preserve current behavior so the existing usage is unchanged.

- [ ] **Step 1: Replace the `Props` interface**

Find the current:
```tsx
interface Props {
  monthly: ReferralBucket[];
  weekly: ReferralBucket[];
}
```
Replace with:
```tsx
interface Props {
  monthly: ReferralBucket[];
  weekly: ReferralBucket[];
  title?: string;
  barColor?: string;
  lineColor?: string;
  gradientId?: string;
}
```

- [ ] **Step 2: Destructure the new props with teal defaults**

Find the component signature line:
```tsx
export default function ReferralTrendChart({ monthly, weekly }: Props) {
```
Replace with:
```tsx
export default function ReferralTrendChart({
  monthly,
  weekly,
  title = "Users Referred & Referred Volume",
  barColor = "#0C5147",
  lineColor = "#00DE8F",
  gradientId = "referralVolumeGrad",
}: Props) {
```

- [ ] **Step 3: Apply the prop values in the markup**

Make these exact substitutions in the JSX (each appears once unless noted):

1. The header `<h3>` text — replace the literal `Users Referred &amp; Referred Volume` with `{title}`.
2. The `<linearGradient id="referralVolumeGrad" ...>` → `id={gradientId}`.
3. Both gradient `<stop ... stopColor="#00DE8F" ... />` lines → `stopColor={lineColor}` (keep their existing `stopOpacity` values).
4. The area `<path d={areaPath} fill="url(#referralVolumeGrad)" />` → `fill={`url(#${gradientId})`}`.
5. The volume line `<path ... stroke="#00DE8F" ... />` → `stroke={lineColor}`.
6. The volume dots `<circle ... stroke="#00DE8F" ... />` → `stroke={lineColor}` (keep `fill="#ffffff"`).
7. The bars `<rect ... fill="#0C5147" ... />` → `fill={barColor}`.
8. The legend "Users referred" swatch `style={{ background: "#0C5147" }}` → `style={{ background: barColor }}`.
9. The legend "Referred volume" swatch `style={{ background: "#00DE8F" }}` → `style={{ background: lineColor }}`.

Leave grid-line color `#E5E7EB`, axis tick text colors, and the white dot `fill` unchanged.

- [ ] **Step 4: Verify build + commit**

```bash
./node_modules/.bin/tsc --noEmit && npm run build
git add src/components/admin/ReferralTrendChart.tsx
git commit -m "refactor(admin): ReferralTrendChart accepts title/color/gradientId props"
```

Expected: tsc clean, build `✓ Compiled successfully`. (Existing admin page still compiles because all new props are optional with teal defaults.)

---

### Task 3: Wire segmented data + render the purple Payova card

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: Swap the import**

Find:
```ts
import { buildReferralTrend }  from "@/lib/admin/referral-trend";
```
Replace with:
```ts
import { buildSegmentedReferralTrend } from "@/lib/admin/referral-trend";
```

- [ ] **Step 2: Add `affiliate_id` to the transactions query**

Find the transactions query in the `Promise.all` and add `affiliate_id` to the select (keep the `.gte` date bound):
```ts
    db.from("transactions")
      .select("affiliate_id, transaction_type, self_referral, transaction_date, amount")
      .gte("transaction_date", (() => {
        const d = new Date();
        d.setMonth(d.getMonth() - 13);
        return d.toISOString().slice(0, 10);
      })()),
```

- [ ] **Step 3: Add `affiliate_id` to the transactions type narrowing**

Find:
```ts
  const transactions: Pick<Transaction, "transaction_type" | "self_referral" | "transaction_date" | "amount">[] =
    txnsResult.data ?? [];
```
Replace with:
```ts
  const transactions: Pick<Transaction, "affiliate_id" | "transaction_type" | "self_referral" | "transaction_date" | "amount">[] =
    txnsResult.data ?? [];
```

- [ ] **Step 4: Compute the Payova ID set + segmented trend**

Find:
```ts
  const referralTrend = buildReferralTrend(users, transactions, new Date());
```
Replace with:
```ts
  const payovaIds = new Set(
    affiliates.filter((a) => a.whitelabel_brand_id != null).map((a) => a.id),
  );
  const referralTrend = buildSegmentedReferralTrend(users, transactions, payovaIds, new Date());
```

- [ ] **Step 5: Render both cards**

Find:
```tsx
      <ReferralTrendChart monthly={referralTrend.monthly} weekly={referralTrend.weekly} />
```
Replace with:
```tsx
      <ReferralTrendChart monthly={referralTrend.main.monthly} weekly={referralTrend.main.weekly} />
      <ReferralTrendChart
        monthly={referralTrend.payova.monthly}
        weekly={referralTrend.payova.weekly}
        title="Payova — Users Referred & Referred Volume"
        barColor="#7C3AED"
        lineColor="#8B5CF6"
        gradientId="payovaVolumeGrad"
      />
```

- [ ] **Step 6: Verify build + tests + commit**

```bash
./node_modules/.bin/tsc --noEmit && npm run build && npm test 2>&1 | tail -4
git add src/app/admin/page.tsx
git commit -m "feat(admin): split Payova into its own purple referral trend card"
```

Expected: tsc clean; build success; tests 0 failures.

- [ ] **Step 7: Manual verification**

`npm run dev`, sign in as admin, open `/admin`. Confirm:
- The main "Users Referred & Referred Volume" card no longer includes Payova volume/users.
- A second **purple** "Payova — Users Referred & Referred Volume" card renders below it, with its own Monthly/Weekly dropdown working independently.
- The two purple/teal gradient fills both render (distinct gradient ids — no fill bleed between the two charts).

---

## Self-Review

**Spec coverage:**
- Payova = non-null `whitelabel_brand_id` → Task 3 Step 4 ID set. ✓
- Main chart excludes Payova → `buildSegmentedReferralTrend` main segment (Task 1) + Task 3 render. ✓
- Payova own card, purple, users+volume, dropdown → Task 2 props + Task 3 render (`#7C3AED`/`#8B5CF6`). ✓
- Reuse unchanged `buildReferralTrend` → Task 1 calls it; not modified. ✓
- null/unknown affiliate_id → main → Task 1 `isPayova` + test. ✓
- Aggregated buckets only to client → Task 3 passes `referralTrend.{main,payova}.{monthly,weekly}`. ✓
- Always render Payova card → Task 3 Step 5 (unconditional). ✓
- Tests (partition, null→main, reconcile, empty set) → Task 1. ✓
- Distinct gradient ids → Task 2 `gradientId` prop + Task 3 `payovaVolumeGrad`. ✓

**Placeholder scan:** No TBD/TODO; every step has concrete code/commands. The Task 2 substitutions reference exact literals to find/replace. ✓

**Type consistency:** `SegmentedReferralTrend { main, payova }` defined in Task 1, consumed in Task 3 (`referralTrend.main.monthly` etc.). `buildSegmentedReferralTrend(users, transactions, payovaAffiliateIds, now)` signature matches the Task 3 call. New `ReferralTrendChart` props (`title`/`barColor`/`lineColor`/`gradientId`) defined in Task 2 and passed in Task 3. Transactions `Pick` adds `affiliate_id`, matching the `buildSegmentedReferralTrend` txn type. ✓
