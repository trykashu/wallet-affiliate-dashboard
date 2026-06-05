# Admin Referral Trend Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin overview's "User Conversion Rate" chart with a combined dual-axis chart of users referred (bars) and total referred volume (line), with a Monthly/Weekly dropdown.

**Architecture:** A pure `buildReferralTrend()` aggregates referred users (by `created_at`) and Transfer-In transaction volume (by `transaction_date`) into pre-zeroed monthly (12 mo) and weekly (12 wk, Monday-started) buckets. The admin server page computes both and passes them to a client `ReferralTrendChart` that toggles between the two pre-loaded datasets and renders a dual-axis inline SVG.

**Tech Stack:** Next.js 15 App Router (server + client components), TypeScript, inline SVG (no chart lib), `node:test`/`tsx` for unit tests, Tailwind + Kashu design tokens.

**Spec:** `docs/superpowers/specs/2026-06-05-admin-referral-trend-chart-design.md`

---

### Task 1: Pure `buildReferralTrend` aggregation

**Files:**
- Create: `src/lib/admin/referral-trend.ts`
- Test: `src/lib/admin/referral-trend.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/admin/referral-trend.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReferralTrend } from "./referral-trend";

// Fixed "now" = Mon Jun 15 2026, local noon — deterministic buckets.
const NOW = new Date(2026, 5, 15, 12, 0, 0);

// Local-time (no "Z") ISO strings so tests don't shift across timezones.
const tx = (over: Partial<{ transaction_type: string; self_referral: boolean; transaction_date: string | null; amount: number }>) => ({
  transaction_type: "Transfer In", self_referral: false, transaction_date: "2026-06-10T12:00:00", amount: 100, ...over,
});

test("monthly: users bucket by created_at, volume by transaction_date", () => {
  const { monthly } = buildReferralTrend(
    [{ created_at: "2026-06-10T12:00:00" }, { created_at: "2026-05-02T12:00:00" }],
    [tx({ amount: 500, transaction_date: "2026-06-03T12:00:00" }), tx({ amount: 250, transaction_date: "2026-05-20T12:00:00" })],
    NOW,
  );
  assert.equal(monthly.length, 12);
  const jun = monthly[11], may = monthly[10];
  assert.equal(jun.key, "2026-06");
  assert.equal(jun.users, 1);
  assert.equal(jun.volume, 500);
  assert.equal(may.key, "2026-05");
  assert.equal(may.users, 1);
  assert.equal(may.volume, 250);
});

test("volume filtering: non-Transfer-In, self-referral, null date excluded", () => {
  const { monthly } = buildReferralTrend(
    [],
    [
      tx({ transaction_type: "Transfer Out", amount: 999 }),
      tx({ self_referral: true, amount: 888 }),
      tx({ transaction_date: null, amount: 777 }),
      tx({ amount: 100 }),
    ],
    NOW,
  );
  const total = monthly.reduce((s, b) => s + b.volume, 0);
  assert.equal(total, 100);
});

test("out-of-window rows excluded (13 months ago, all-zero elsewhere)", () => {
  const { monthly } = buildReferralTrend(
    [{ created_at: "2025-05-01T12:00:00" }],            // 13 months before Jun 2026
    [tx({ transaction_date: "2025-05-01T12:00:00", amount: 500 })],
    NOW,
  );
  assert.equal(monthly.reduce((s, b) => s + b.users, 0), 0);
  assert.equal(monthly.reduce((s, b) => s + b.volume, 0), 0);
});

test("weekly: 12 Monday-started buckets; an event today lands in the last bucket", () => {
  const { weekly } = buildReferralTrend(
    [{ created_at: "2026-06-15T12:00:00" }],
    [tx({ transaction_date: "2026-06-15T12:00:00", amount: 300 })],
    NOW,
  );
  assert.equal(weekly.length, 12);
  assert.equal(weekly[11].users, 1);
  assert.equal(weekly[11].volume, 300);
  // total equals the single in-window event (not double counted)
  assert.equal(weekly.reduce((s, b) => s + b.users, 0), 1);
});

test("empty input: all buckets present and zero", () => {
  const { monthly, weekly } = buildReferralTrend([], [], NOW);
  assert.equal(monthly.length, 12);
  assert.equal(weekly.length, 12);
  assert.ok(monthly.every((b) => b.users === 0 && b.volume === 0));
  assert.ok(weekly.every((b) => b.users === 0 && b.volume === 0));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A3 referral-trend`
Expected: FAIL — module `./referral-trend` not found.

- [ ] **Step 3: Implement `buildReferralTrend`**

Create `src/lib/admin/referral-trend.ts`:

```ts
/**
 * Pure aggregation for the admin overview's referral trend chart.
 * Buckets referred users (by created_at) and Transfer-In transaction volume
 * (by transaction_date) into the last 12 calendar months and last 12
 * Monday-started weeks. `now` is passed in for deterministic tests.
 */

export interface ReferralBucket {
  key: string;
  label: string;
  users: number;
  volume: number;
}
export interface ReferralTrend {
  monthly: ReferralBucket[];
  weekly: ReferralBucket[];
}

interface UserRow { created_at: string }
interface TxnRow {
  transaction_type: string;
  self_referral: boolean;
  transaction_date: string | null;
  amount: number;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function shortMonth(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short" });
}
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function weekLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
/** Monday-start of the week containing `d` (local time, time stripped). */
function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay();                  // 0=Sun .. 6=Sat
  const diff = (day === 0 ? -6 : 1) - day; // shift back to Monday
  x.setDate(x.getDate() + diff);
  return x;
}

export function buildReferralTrend(
  users: UserRow[],
  transactions: TxnRow[],
  now: Date,
): ReferralTrend {
  // -- Build empty buckets + key->index maps --
  const monthly: ReferralBucket[] = [];
  const monthIdx = new Map<string, number>();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    monthIdx.set(key, monthly.length);
    monthly.push({ key, label: shortMonth(d), users: 0, volume: 0 });
  }

  const weekly: ReferralBucket[] = [];
  const weekIdx = new Map<string, number>();
  const thisMonday = weekStart(now);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(thisMonday);
    d.setDate(thisMonday.getDate() - i * 7);
    const key = dateKey(d);
    weekIdx.set(key, weekly.length);
    weekly.push({ key, label: weekLabel(d), users: 0, volume: 0 });
  }

  // -- Users by created_at --
  for (const u of users) {
    const d = new Date(u.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const mi = monthIdx.get(monthKey(d));
    if (mi !== undefined) monthly[mi].users++;
    const wi = weekIdx.get(dateKey(weekStart(d)));
    if (wi !== undefined) weekly[wi].users++;
  }

  // -- Volume by transaction_date (Transfer In, non-self-referral only) --
  for (const t of transactions) {
    if (t.transaction_type !== "Transfer In" || t.self_referral) continue;
    if (!t.transaction_date) continue;
    const d = new Date(t.transaction_date);
    if (Number.isNaN(d.getTime())) continue;
    const amt = Number(t.amount) || 0;
    const mi = monthIdx.get(monthKey(d));
    if (mi !== undefined) monthly[mi].volume += amt;
    const wi = weekIdx.get(dateKey(weekStart(d)));
    if (wi !== undefined) weekly[wi].volume += amt;
  }

  return { monthly, weekly };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -6`
Expected: 0 failures (5 new referral-trend tests pass).

- [ ] **Step 5: Typecheck + commit**

```bash
./node_modules/.bin/tsc --noEmit
git add src/lib/admin/referral-trend.ts src/lib/admin/referral-trend.test.ts
git commit -m "feat(admin): buildReferralTrend monthly/weekly aggregation"
```

---

### Task 2: `ReferralTrendChart` client component

**Files:**
- Create: `src/components/admin/ReferralTrendChart.tsx`

No unit test (inline-SVG/client component — repo convention). Verified by `tsc` + `npm run build`.

- [ ] **Step 1: Implement the component**

Create `src/components/admin/ReferralTrendChart.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { fmt } from "@/lib/fmt";
import type { ReferralBucket } from "@/lib/admin/referral-trend";

interface Props {
  monthly: ReferralBucket[];
  weekly: ReferralBucket[];
}

function smoothPath(points: { x: number; y: number }[]) {
  if (points.length <= 1)
    return points.length === 1 ? `M ${points[0].x} ${points[0].y}` : "";
  return points.reduce((acc, pt, i) => {
    if (i === 0) return `M ${pt.x} ${pt.y}`;
    const prev = points[i - 1];
    const cpX = (prev.x + pt.x) / 2;
    return `${acc} C ${cpX} ${prev.y}, ${cpX} ${pt.y}, ${pt.x} ${pt.y}`;
  }, "");
}

function niceTicks(max: number, steps = 4): number[] {
  if (max <= steps) return Array.from({ length: max + 1 }, (_, i) => i);
  const step = Math.ceil(max / steps);
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(max);
  return ticks;
}

export default function ReferralTrendChart({ monthly, weekly }: Props) {
  const [granularity, setGranularity] = useState<"monthly" | "weekly">("monthly");
  const data = granularity === "monthly" ? monthly : weekly;

  const W = 560, H = 200, padL = 36, padR = 52, padY = 16, padBottom = 28;
  const innerW = W - padL - padR;
  const innerH = H - padY - padBottom;

  const usersMax = Math.max(...data.map((b) => b.users), 1);
  const volumeMax = Math.max(...data.map((b) => b.volume), 1);

  const slotW = data.length > 0 ? innerW / data.length : innerW;
  const barW = slotW * 0.55;

  const centerX = (i: number) => padL + i * slotW + slotW / 2;

  const linePoints = useMemo(
    () =>
      data.map((b, i) => ({
        x: centerX(i),
        y: padY + innerH - (b.volume / volumeMax) * innerH,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, volumeMax, innerH, slotW],
  );

  const linePath = smoothPath(linePoints);
  const areaPath =
    linePoints.length > 0
      ? `${linePath} L ${linePoints[linePoints.length - 1].x} ${padY + innerH} L ${linePoints[0].x} ${padY + innerH} Z`
      : "";

  const userTicks = niceTicks(usersMax);
  const volTicks = niceTicks(volumeMax);

  return (
    <div className="card p-4 sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Users Referred &amp; Referred Volume</h3>
          <p className="text-xs text-brand-400 mt-0.5">
            New referred users and Transfer-In volume per {granularity === "monthly" ? "month" : "week"}
          </p>
        </div>
        <select
          value={granularity}
          onChange={(e) => setGranularity(e.target.value as "monthly" | "weekly")}
          className="border border-gray-200 rounded-xl text-sm text-gray-900 bg-white px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600"
        >
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
        </select>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-2">
        <span className="flex items-center gap-1.5 text-[11px] text-brand-400">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "#0C5147" }} /> Users referred
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-brand-400">
          <span className="inline-block w-4 h-0.5 rounded-full" style={{ background: "#00DE8F" }} /> Referred volume
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="referralVolumeGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00DE8F" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#00DE8F" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Left-axis grid + user-count ticks */}
        {userTicks.map((tick) => {
          const y = padY + innerH - (tick / usersMax) * innerH;
          return (
            <g key={`u-${tick}`}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#E5E7EB" strokeWidth="1" strokeDasharray="4 4" />
              <text x={padL - 4} y={y + 3} fill="#9CA3AF" fontSize="8" textAnchor="end">{tick}</text>
            </g>
          );
        })}

        {/* Right-axis volume ticks */}
        {volTicks.map((tick) => {
          const y = padY + innerH - (tick / volumeMax) * innerH;
          return (
            <text key={`v-${tick}`} x={W - padR + 4} y={y + 3} fill="#9CA3AF" fontSize="8" textAnchor="start">
              {fmt.currencyCompact(tick)}
            </text>
          );
        })}

        {/* User bars */}
        {data.map((b, i) => {
          const barHeight = (b.users / usersMax) * innerH;
          const x = padL + i * slotW + (slotW - barW) / 2;
          const y = padY + innerH - barHeight;
          return <rect key={`bar-${b.key}`} x={x} y={y} width={barW} height={Math.max(barHeight, 0)} fill="#0C5147" rx="3" />;
        })}

        {/* Volume area + line */}
        <path d={areaPath} fill="url(#referralVolumeGrad)" />
        <path d={linePath} fill="none" stroke="#00DE8F" strokeWidth="2" strokeLinecap="round" />
        {linePoints.map((pt, i) => (
          <circle key={`dot-${i}`} cx={pt.x} cy={pt.y} r="3" fill="#ffffff" stroke="#00DE8F" strokeWidth="1.5" />
        ))}

        {/* X labels */}
        {data.map((b, i) => (
          <text key={`x-${b.key}`} x={centerX(i)} y={H - 4} fill="#64748B" fontSize="9" textAnchor="middle">
            {b.label}
          </text>
        ))}
      </svg>
    </div>
  );
}
```

- [ ] **Step 2: Verify build + commit**

```bash
./node_modules/.bin/tsc --noEmit && npm run build
git add src/components/admin/ReferralTrendChart.tsx
git commit -m "feat(admin): ReferralTrendChart dual-axis component with Monthly/Weekly toggle"
```

Expected: tsc clean, build `✓ Compiled successfully`.

---

### Task 3: Wire into admin overview; remove conversion chart

**Files:**
- Modify: `src/app/admin/page.tsx`
- Delete: `src/components/admin/UserConversionChart.tsx`

- [ ] **Step 1: Confirm no other references to the old chart**

Run: `grep -rn "UserConversionChart" src/`
Expected: only `src/app/admin/page.tsx` (import + render) and the component file itself.

- [ ] **Step 2: Update imports in `src/app/admin/page.tsx`**

Replace:
```ts
import UserConversionChart     from "@/components/admin/UserConversionChart";
```
with:
```ts
import ReferralTrendChart      from "@/components/admin/ReferralTrendChart";
import { buildReferralTrend }  from "@/lib/admin/referral-trend";
```

Add `Transaction` to the existing type import line:
```ts
import type { Affiliate, ReferredUser, Earning, WebhookEvent, Transaction } from "@/types/database";
```

- [ ] **Step 3: Add the transactions query + trend computation**

In the `Promise.all` (currently 4 queries), add a fifth:
```ts
  const [affiliatesResult, usersResult, earningsResult, webhookResult, txnsResult] = await Promise.all([
    db.from("affiliates").select("*").order("created_at", { ascending: false }),
    db.from("referred_users").select("*").order("created_at", { ascending: false }),
    db.from("earnings").select("*"),
    db.from("webhook_events").select("*").order("created_at", { ascending: false }).limit(10),
    db.from("transactions").select("transaction_type, self_referral, transaction_date, amount"),
  ]);
```

After the existing `const webhooks: WebhookEvent[] = webhookResult.data ?? [];` line, add:
```ts
  const transactions: Pick<Transaction, "transaction_type" | "self_referral" | "transaction_date" | "amount">[] =
    txnsResult.data ?? [];

  const referralTrend = buildReferralTrend(users, transactions, new Date());
```

- [ ] **Step 4: Swap the rendered chart**

Replace:
```tsx
      <UserConversionChart users={users} />
```
with:
```tsx
      <ReferralTrendChart monthly={referralTrend.monthly} weekly={referralTrend.weekly} />
```

- [ ] **Step 5: Delete the old component**

```bash
git rm src/components/admin/UserConversionChart.tsx
```

- [ ] **Step 6: Verify build + tests + commit**

```bash
./node_modules/.bin/tsc --noEmit && npm run build && npm test 2>&1 | tail -4
git add src/app/admin/page.tsx
git commit -m "feat(admin): replace User Conversion Rate with Referral Trend chart"
```

Expected: tsc clean; build success; tests 0 failures; `grep -rn UserConversionChart src/` now returns nothing.

- [ ] **Step 7: Manual verification**

Run `npm run dev`, sign in as admin, open `/admin`. Confirm:
- The "User Conversion Rate" card is gone; "Users Referred & Referred Volume" is in its place (still beside "Affiliates Added").
- Bars (users, left axis) + line (volume, right axis) render; the **Monthly/Weekly** dropdown switches buckets instantly.
- Numbers look sane vs the stat cards (e.g., volume line totals roughly track known referred volume).

---

## Self-Review

**Spec coverage:**
- Remove UserConversionChart → Task 3 (delete + unrender). ✓
- Combined dual-axis chart (users bars/left, volume line/right) → Task 2. ✓
- Volume from Transfer-In, non-self-referral, by transaction_date → Task 1 filter + Task 3 query. ✓
- Users by created_at → Task 1. ✓
- Per-period (not cumulative) → Task 1 buckets are per-period. ✓
- Monthly (12 mo) + Weekly (12 wk, Monday) dropdown, default Monthly → Task 1 buckets + Task 2 state. ✓
- Approach A (server pre-aggregates both, client toggles) → Task 3 computes both, Task 2 toggles. ✓
- Tests for aggregation → Task 1. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code + exact commands. ✓

**Type consistency:** `ReferralBucket`/`ReferralTrend` defined in Task 1 and consumed in Task 2 (`Props`) and Task 3 (`buildReferralTrend` return). `buildReferralTrend(users, transactions, now)` signature identical across Task 1 (def) and Task 3 (call). Transaction field subset in Task 3's query matches `TxnRow` fields used in Task 1. ✓
