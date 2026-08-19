# Master Partner (Sub-Affiliate) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task.
> **Design doc:** `docs/plans/2026-08-19-master-partner-sub-affiliates-design.md` (approved 2026-08-19).

**Goal:** Add a "Master Tier - T3" partner type whose referral traffic is subdivided by sub-affiliate IDs stamped on GHL opportunities, with a master-only dashboard view grouping users/volume/earnings per sub.

**Architecture:** The master is a completely normal affiliate — subs are opaque IDs on `referred_users`, never affiliate rows. New tier value `'master'` (20% of Kashu's fee, sticky like `custom`), new `referred_users.sub_affiliate_id` synced from a new Airtable Launch List column, a `sub_affiliate_labels` table with owner-scoped RLS, and a `/dashboard/sub-affiliates` page. **No changes to `get_my_affiliate_id()` or any existing RLS policy.**

**Tech Stack:** Next.js 15 App Router, Supabase (service client for sync, anon+RLS for pages), node:test via `npm test` (`npx tsx --test 'src/**/*.test.ts'`), Airtable REST sync.

**Verification protocol (EVERY task that touches code):** `npx tsc --noEmit` AND `npm run build` must both pass with zero errors before commit (CLAUDE.md §4C). `npm test` for tasks with tests.

---

## Task 1: Airtable changes — ORCHESTRATOR ONLY

**Do NOT delegate to a subagent** — requires the claude.ai Airtable connector in the main session.

**Step 1:** Add option `Master Tier - T3` to `Affiliate Tier` single-select (`fldxhamZ3c7Ml3P3Q`, table `tbl9OoVL64Z1GiNzU` "Kashu Affiliates", base `appKiH3vOExub0wP5`). Preserve the three existing choices AND their IDs (`selKJOPC6ksKhJk1K` Gold, `selBmpor9SJirjswo` Platinum, `selExziFm6izAqIBO` Custom) — pass them through unchanged; only append the new choice. Suggested color: `purpleBright`.

**Step 2:** Create field `Sub Aff ID` (type `singleLineText`, description: "Sub-affiliate ID from the GHL opportunity custom field. Groups this referred user under a master partner's sub-affiliate.") on Launch List `tblV03MwocMeq3wYl` in Wallet HQ `appLArFbRFtS24TlZ`.

**Step 3:** Update `Commission Owed` formula (`fldz8l8OXLIANKgMb`, table `tbluxSVVoAuhEWLd7` "Partner Transaction Log", base `appKiH3vOExub0wP5`) to add the Master branch:

```
ROUND(
  SWITCH(
    {fld7OSppq5czhFTW5},
    "Gold Tier - T2", {fldo1LB1QlsmZFiAh} * 0.05,
    "Platinum Tier - T1", {fldo1LB1QlsmZFiAh} * 0.10,
    "Master Tier - T3", {fldo1LB1QlsmZFiAh} * 0.20,
    "Custom - T0", BLANK(),
    0
  ),
  2
)
```

**Step 4:** Verify by re-reading the schema: tier select has 4 options with original IDs intact; Launch List has `Sub Aff ID`; formula `isValid: true`.

---

## Task 2: Migration 026

**Files:**
- Create: `supabase/migrations/026_master_tier_sub_affiliates.sql`

**Step 1: Write the migration** (mirror mig 013's constraint pattern and mig 025's RLS style):

```sql
-- 026_master_tier_sub_affiliates.sql
-- Master Tier - T3: a partner whose referral traffic is subdivided by
-- sub-affiliate IDs stamped on GHL opportunities. Subs are NOT affiliate
-- rows — just opaque IDs on referred_users — so the master is a completely
-- normal affiliate and no RLS changes are needed (all sub data is already
-- the master's own rows). get_my_affiliate_id() is untouched (mig 025 rule).
-- Masters earn 20% of Kashu's fee on everything; subs are paid outside
-- this system.

-- 1. Widen tier CHECKs to include 'master'
ALTER TABLE affiliates
  DROP CONSTRAINT IF EXISTS affiliates_tier_check;
ALTER TABLE affiliates
  ADD CONSTRAINT affiliates_tier_check
  CHECK (tier IN ('gold', 'platinum', 'custom', 'master'));

ALTER TABLE earnings
  DROP CONSTRAINT IF EXISTS earnings_tier_at_earning_check;
ALTER TABLE earnings
  ADD CONSTRAINT earnings_tier_at_earning_check
  CHECK (tier_at_earning IN ('gold', 'platinum', 'custom', 'master'));

-- 2. Sub-affiliate attribution on referred users (synced from Launch List
--    "Sub Aff ID"; NULL = direct referral)
ALTER TABLE referred_users
  ADD COLUMN IF NOT EXISTS sub_affiliate_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_referred_users_sub_affiliate
  ON referred_users (affiliate_id, sub_affiliate_id)
  WHERE sub_affiliate_id IS NOT NULL;

-- 3. Friendly labels a master assigns to their sub IDs
CREATE TABLE IF NOT EXISTS sub_affiliate_labels (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id     UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  sub_affiliate_id TEXT NOT NULL,
  label            TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (affiliate_id, sub_affiliate_id)
);

ALTER TABLE sub_affiliate_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sub_affiliate_labels_select_own" ON sub_affiliate_labels
  FOR SELECT USING (affiliate_id = public.get_my_affiliate_id());
CREATE POLICY "sub_affiliate_labels_insert_own" ON sub_affiliate_labels
  FOR INSERT WITH CHECK (affiliate_id = public.get_my_affiliate_id());
CREATE POLICY "sub_affiliate_labels_update_own" ON sub_affiliate_labels
  FOR UPDATE USING (affiliate_id = public.get_my_affiliate_id());
CREATE POLICY "sub_affiliate_labels_delete_own" ON sub_affiliate_labels
  FOR DELETE USING (affiliate_id = public.get_my_affiliate_id());
```

**Step 2: Apply via Supabase Management API** (CLAUDE.md §6 2026-07-13 pt2: CLI token in macOS keychain; MUST use curl, not python-urllib — Cloudflare 403s other UAs):

```bash
TOKEN=$(security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d)
curl -s -X POST "https://api.supabase.com/v1/projects/xcnbchugndkrwgyqpuhk/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data-binary @<(python3 -c "import json;print(json.dumps({'query': open('supabase/migrations/026_master_tier_sub_affiliates.sql').read()}))")
```
Expected: JSON result, no `"error"`.

**Step 3: Verify:**
```bash
# same curl with query:
# SELECT column_name FROM information_schema.columns WHERE table_name='referred_users' AND column_name='sub_affiliate_id';
# SELECT count(*) FROM pg_policies WHERE tablename='sub_affiliate_labels';
```
Expected: column exists; 4 policies.

**Step 4: Commit** — `git add supabase/migrations/026_master_tier_sub_affiliates.sql && git commit -m "feat(db): master tier + sub_affiliate_id + sub_affiliate_labels (mig 026)"`

---

## Task 3: Types

**Files:**
- Modify: `src/types/database.ts`

**Step 1:** Line 19: `export type AffiliateTier = 'gold' | 'platinum' | 'custom' | 'master';`

**Step 2:** In `interface ReferredUser` (line ~95), append after `wallet_user_id`:
```ts
  /** Sub-affiliate ID from the GHL opportunity (via Launch List "Sub Aff ID").
   *  NULL = direct referral. Only meaningful for master-tier affiliates. */
  sub_affiliate_id: string | null;
```

**Step 3:** After `DelegatePermissions` (line ~93), add:
```ts
export interface SubAffiliateLabel {
  id:               string;
  affiliate_id:     string;
  sub_affiliate_id: string;
  label:            string;
  created_at:       string;
  updated_at:       string;
}
```

**Step 4:** Run `npx tsc --noEmit`. Expected: **errors** in TierBadge/AdminTierBadge/TierProgressCard/tier.ts (`Record<AffiliateTier, …>` missing `master`) — this is the compiler enumerating Tasks 4 & 8 for us. Do NOT commit yet; Tasks 3–5 and 8 commit together once green (or commit per-task only after the union widening compiles — simplest: complete Tasks 3, 4, 5, 8 then run tsc/build once and make one commit per task retroactively is NOT allowed; instead do Tasks 3+4+8 as one commit: "feat(tier): add master tier (20% of Kashu's fee)"). **Executor note: Tasks 3, 4, 5, and 8 form one compile unit — implement all, verify, then commit as a single commit.**

---

## Task 4: tier.ts — master rate (part of the Task 3 compile unit)

**Files:**
- Modify: `src/lib/tier.ts`

**Step 1:** Header comment (lines 1-15): add `Master:   20% of Kashu's fee (runs a sub-affiliate network; subs are paid by the master outside this system)` after the Custom line.

**Step 2:** `COMMISSION_RATES` (line 30):
```ts
export const COMMISSION_RATES: Record<AffiliateTier, number> = {
  gold: 0.05,     // 5% of Kashu's fee
  platinum: 0.10, // 10% of Kashu's fee
  custom: 0,      // bespoke compensation handled outside this system
  master: 0.20,   // 20% of Kashu's fee — master partner w/ sub-affiliate network
};
```

No other change: `getTierForVolume` still only derives gold/platinum (master is manually assigned, like custom); `calculateEarning` is table-driven and now computes master earnings correctly. The reconciliation pass in `sync/transactions/route.ts:455-498` re-derives via `calculateEarning`, so master earnings reconcile with no special-casing.

---

## Task 5: Sticky master in leaderboard tier recompute (part of the compile unit)

**Files:**
- Modify: `src/lib/refresh-leaderboard.ts:17-26`

**Why:** `computeTier('master', …)` currently falls through to the gold branch and would **demote a master to platinum**. (The other two upgrade paths — `sync/transactions/route.ts:544` and `webhooks/wallet/route.ts:240` — check `tier === "gold"` and need NO change.)

**Step 1:**
```ts
function computeTier(currentTier: AffiliateTier, volume: number, tierOverride: boolean): AffiliateTier {
  // Custom and master tiers are manually assigned and never overwritten by volume math.
  if (currentTier === "custom") return "custom";
  if (currentTier === "master") return "master";
  // Sticky promotions: once an affiliate reaches platinum (via volume,
  // override, or manual set), they stay platinum even if volume drops.
  if (currentTier === "platinum") return "platinum";
  // Otherwise (currently gold): upgrade to platinum on threshold or override.
  if (tierOverride || volume >= TIER_THRESHOLDS.platinum) return "platinum";
  return "gold";
}
```

(`TIER_ORDER` at line 154 needs no change — master never appears in an upgrade transition since computeTier returns it unchanged; the `?? 1` fallbacks are safe.)

---

## Task 6: Affiliates sync — TIER_MAP

**Files:**
- Modify: `src/app/api/sync/affiliates/route.ts:26-37` (+ header comment line 14)

**Step 1:**
```ts
const TIER_MAP: Record<string, string> = {
  "Gold Tier - T2": "gold",
  "Platinum Tier - T1": "platinum",
  "Custom - T0": "custom",
  "Master Tier - T3": "master",
};

function mapTier(raw: unknown): "gold" | "platinum" | "custom" | "master" {
  if (typeof raw === "string" && TIER_MAP[raw]) {
    return TIER_MAP[raw] as "gold" | "platinum" | "custom" | "master";
  }
  return "gold";
}
```
Update the header comment line 14 to `Affiliate Tier → tier (mapped to gold/platinum/custom/master)`.

**Step 2:** `npx tsc --noEmit` → PASS (with Tasks 3-5+8 done). **Step 3: Commit** the compile unit: `git commit -m "feat(tier): master tier — 20% of Kashu's fee, sticky, synced from Airtable"` (includes database.ts, tier.ts, refresh-leaderboard.ts, this file, and Task 8's badge files).

---

## Task 7: Users sync — Sub Aff ID mapping

**Files:**
- Modify: `src/app/api/sync/users/route.ts`

**Step 1:** Add to `interface UserRow` (line 40): `sub_affiliate_id: string | null;`

**Step 2:** In `buildUserRow` (inside the `row` literal at line 80, after `phone`):
```ts
    // Sub-affiliate attribution (master partners): trim; blank/missing → null.
    sub_affiliate_id: ((f["Sub Aff ID"] as string) || "").trim() || null,
```
(Field absent in Airtable → `undefined` → `null`. No crash, no format assumption.)

**Step 3:** `npx tsc --noEmit` + `npm run build` → PASS.

**Step 4: Commit** — `git commit -m "feat(sync): map Launch List 'Sub Aff ID' → referred_users.sub_affiliate_id"`

---

## Task 8: Tier display components (part of the Task 3 compile unit)

**Files:**
- Modify: `src/components/ui/TierBadge.tsx:8-24`
- Modify: `src/components/admin/AdminTierBadge.tsx:13-17`
- Modify: `src/components/dashboard/TierProgressCard.tsx:12-16` + new branch
- Modify: `src/components/dashboard/EarningsCard.tsx` (TIER_BADGE record + rate copy)
- Modify: `src/lib/statement/builders.ts:18-24`, `src/lib/statement/generate.ts:145-146`, `src/lib/statement/StatementDocument.tsx:271-292`

**Step 1 — TierBadge.tsx**, add to `TIER_CONFIG`:
```ts
  master: {
    label:   "Master",
    classes: "bg-brand-600/10 text-brand-600 border-brand-600/25",
    dot:     "bg-brand-600",
  },
```

**Step 2 — AdminTierBadge.tsx**, add to `TIER_CONFIG`:
```ts
  master:   { label: "Master",   color: "#7DD3FC", bg: "rgba(125,211,252,0.10)", border: "rgba(125,211,252,0.26)", dot: "#7DD3FC" },
```

**Step 3 — TierProgressCard.tsx**: add to `TIER_BADGE`:
```ts
  master:   { label: "Master",   class: "bg-brand-600/10 text-brand-600 border-brand-600/25" },
```
and insert a master branch after the `custom` branch (before the final Platinum return), achieved-style, no progress bar:
```tsx
  // Master → manually designated; no volume progression
  if (tier === "master") {
    return (
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Master Partner</h3>
            <p className="text-[10px] text-brand-400 mt-0.5 uppercase tracking-wider font-medium">
              20% commission on Kashu&apos;s fee
            </p>
          </div>
          <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold border rounded-full px-2.5 py-1 ${tierInfo.class}`}>
            {tierInfo.label} Tier
          </span>
        </div>
        <div className="flex items-end justify-between mb-2">
          <div>
            <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium mb-1">Lifetime Volume</p>
            <p className="text-stat font-bold text-gray-900 tabular-nums">{fmt.currencyCompact(referredVolume)}</p>
          </div>
          <span className="text-[10px] font-semibold text-accent">Sub-Affiliate Network</span>
        </div>
        <div className="h-2 rounded-full bg-accent/10 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent/60" style={{ width: "100%" }} />
        </div>
      </div>
    );
  }
```

**Step 4 — EarningsCard.tsx**: add `master` to its `TIER_BADGE` record (same class string as TierProgressCard's) and extend the header copy ternary (lines ~51-56):
```tsx
            {tier === "gold"
              ? "5% commission on Kashu's fee"
              : tier === "platinum"
                ? "10% commission on Kashu's fee"
                : tier === "master"
                  ? "20% commission on Kashu's fee"
                  : customCommissionRate && customCommissionBasis
                    ? `${(customCommissionRate * 100).toFixed(2).replace(/\.?0+$/, "")}% commission on ${customCommissionBasis === "tpv" ? "TPV" : "Kashu's fee"}`
                    : "Custom commission terms"}
```
Also extend the footer volume tracker: change `{tier === "custom" && (` at line ~163 to `{(tier === "custom" || tier === "master") && (` so masters see lifetime volume (they have no Platinum progress bar).

**Step 5 — statements** (a master's monthly PDF must not say "Gold 5%"):
- `builders.ts` `commissionRatePct`: replace the ternary with the table:
```ts
import { COMMISSION_RATES } from "@/lib/tier";
// …
  if (customRate != null) return Math.round(customRate * 1000) / 10; // 0.075 → 7.5
  return Math.round(COMMISSION_RATES[tier] * 1000) / 10; // gold 5, platinum 10, master 20
```
- `generate.ts:145-146`:
```ts
  const displayTier: "gold" | "platinum" | "master" =
    affiliate.tier === "platinum" ? "platinum"
    : affiliate.tier === "master" ? "master"
    : "gold";
```
- `StatementDocument.tsx` `tierStyle`: widen param to `"gold" | "platinum" | "master"` and add before the gold fallback:
```ts
  if (tier === "master") {
    return { bg: COLORS.slateBg, text: COLORS.slateText, dot: COLORS.slateDot, label: "Master" };
  }
```
(Also update the `StatementData` tier field type if it's declared as `"gold" | "platinum"` — check `src/lib/statement/builders.ts` types and widen to include `"master"`.)

**Step 6:** `npx tsc --noEmit` → PASS. (Committed with Task 6 as the compile-unit commit. `src/components/admin/BatchBuilderSection.tsx:76-78` uses if-chains with a default, and `demo-data.ts` uses literal tiers — no changes needed; verify tsc agrees.)

---

## Task 9: Rollup lib (TDD)

**Files:**
- Create: `src/lib/sub-affiliates/rollup.ts`
- Test: `src/lib/sub-affiliates/rollup.test.ts`

**Step 1: Write the failing test** (style: node:test + assert/strict, like `delegate-nav.test.ts`):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSubAffiliateRollup, DIRECT_KEY } from "./rollup";

const users = [
  { id: "u1", sub_affiliate_id: "SUB-A", status_slug: "funds_in_bank",  first_transaction_amount: 100,  created_at: "2026-08-01T00:00:00Z" },
  { id: "u2", sub_affiliate_id: "SUB-A", status_slug: "signed_up",      first_transaction_amount: null, created_at: "2026-08-05T00:00:00Z" },
  { id: "u3", sub_affiliate_id: "SUB-B", status_slug: "transaction_run", first_transaction_amount: 50,  created_at: "2026-08-03T00:00:00Z" },
  { id: "u4", sub_affiliate_id: null,    status_slug: "signed_up",      first_transaction_amount: null, created_at: "2026-08-02T00:00:00Z" },
];
const transactions = [
  { referred_user_id: "u1", amount: 100 },
  { referred_user_id: "u1", amount: 400 },
  { referred_user_id: "u3", amount: 50 },
];
const earnings = [
  { referred_user_id: "u1", amount: 8.5,  status: "approved" },
  { referred_user_id: "u3", amount: 0.85, status: "pending" },
];
const labels = [{ sub_affiliate_id: "SUB-A", label: "Jake M." }];

test("groups users by sub id with direct bucket", () => {
  const rows = buildSubAffiliateRollup({ users, transactions, earnings, labels });
  const keys = rows.map((r) => r.subId);
  assert.deepEqual(keys, ["SUB-A", "SUB-B", DIRECT_KEY]); // volume DESC, direct last
  const a = rows[0];
  assert.equal(a.label, "Jake M.");
  assert.equal(a.userCount, 2);
  assert.equal(a.transactedCount, 1);
  assert.equal(a.conversionPct, 50);
  assert.equal(a.volume, 500);
  assert.equal(a.earningsTotal, 8.5);
});

test("direct bucket collects null sub ids and is unlabeled", () => {
  const rows = buildSubAffiliateRollup({ users, transactions, earnings, labels });
  const direct = rows[rows.length - 1];
  assert.equal(direct.subId, DIRECT_KEY);
  assert.equal(direct.label, null);
  assert.equal(direct.userCount, 1);
  assert.equal(direct.volume, 0);
});

test("aggregate splits direct vs sub-tagged", () => {
  const rows = buildSubAffiliateRollup({ users, transactions, earnings, labels });
  const subTagged = rows.filter((r) => r.subId !== DIRECT_KEY);
  assert.equal(subTagged.reduce((s, r) => s + r.userCount, 0), 3);
});

test("empty inputs return empty array", () => {
  assert.deepEqual(buildSubAffiliateRollup({ users: [], transactions: [], earnings: [], labels: [] }), []);
});
```

**Step 2:** Run `npm test` → FAIL (module not found).

**Step 3: Implement** `src/lib/sub-affiliates/rollup.ts`:

```ts
/**
 * Sub-affiliate rollup for master-tier partners.
 * Groups the master's own referred_users/transactions/earnings by
 * sub_affiliate_id. Pure function — testable without Supabase.
 * "Transacted" matches the canonical definition (StatsRow.tsx / refresh-leaderboard).
 */

export const DIRECT_KEY = "__direct__";

const TRANSACTED_SLUGS = new Set(["transaction_run", "funds_in_wallet", "ach_initiated", "funds_in_bank"]);

export interface RollupUser {
  id: string;
  sub_affiliate_id: string | null;
  status_slug: string;
  first_transaction_amount: number | null;
  created_at: string;
}
export interface RollupTxn     { referred_user_id: string | null; amount: number; }
export interface RollupEarning { referred_user_id: string | null; amount: number; status: string; }
export interface RollupLabel   { sub_affiliate_id: string; label: string; }

export interface SubRollupRow {
  subId: string;          // DIRECT_KEY for untagged users
  label: string | null;
  userCount: number;
  transactedCount: number;
  conversionPct: number;  // 0-100, 1dp
  volume: number;
  earningsTotal: number;  // excludes reversed
  lastActivity: string | null; // latest user created_at ISO
}

function isTransacted(u: RollupUser): boolean {
  return (u.first_transaction_amount ?? 0) > 0 || TRANSACTED_SLUGS.has(u.status_slug);
}

export function buildSubAffiliateRollup(input: {
  users: RollupUser[];
  transactions: RollupTxn[];
  earnings: RollupEarning[];
  labels: RollupLabel[];
}): SubRollupRow[] {
  const { users, transactions, earnings, labels } = input;
  if (users.length === 0) return [];

  const labelMap = new Map(labels.map((l) => [l.sub_affiliate_id, l.label]));
  const subByUser = new Map(users.map((u) => [u.id, u.sub_affiliate_id ?? DIRECT_KEY]));

  const groups = new Map<string, SubRollupRow>();
  const get = (key: string): SubRollupRow => {
    let g = groups.get(key);
    if (!g) {
      g = {
        subId: key,
        label: key === DIRECT_KEY ? null : (labelMap.get(key) ?? null),
        userCount: 0, transactedCount: 0, conversionPct: 0,
        volume: 0, earningsTotal: 0, lastActivity: null,
      };
      groups.set(key, g);
    }
    return g;
  };

  for (const u of users) {
    const g = get(u.sub_affiliate_id ?? DIRECT_KEY);
    g.userCount++;
    if (isTransacted(u)) g.transactedCount++;
    if (!g.lastActivity || u.created_at > g.lastActivity) g.lastActivity = u.created_at;
  }
  for (const t of transactions) {
    const key = t.referred_user_id ? subByUser.get(t.referred_user_id) : undefined;
    if (key) get(key).volume += Number(t.amount) || 0;
  }
  for (const e of earnings) {
    if (e.status === "reversed") continue;
    const key = e.referred_user_id ? subByUser.get(e.referred_user_id) : undefined;
    if (key) get(key).earningsTotal += Number(e.amount) || 0;
  }

  const rows = [...groups.values()];
  for (const r of rows) {
    r.conversionPct = r.userCount > 0 ? Math.round((r.transactedCount / r.userCount) * 1000) / 10 : 0;
    r.volume = Math.round(r.volume * 100) / 100;
    r.earningsTotal = Math.round(r.earningsTotal * 100) / 100;
  }
  // Volume DESC then userCount DESC; Direct always last.
  rows.sort((a, b) => {
    if (a.subId === DIRECT_KEY) return 1;
    if (b.subId === DIRECT_KEY) return -1;
    if (b.volume !== a.volume) return b.volume - a.volume;
    return b.userCount - a.userCount;
  });
  return rows;
}
```

**Step 4:** `npm test` → PASS (all rollup tests + existing suites).

**Step 5: Commit** — `git commit -m "feat(sub-affiliates): rollup grouping lib with tests"`

---

## Task 10: Label upsert API route

**Files:**
- Create: `src/app/api/sub-affiliates/label/route.ts`

**Step 1:** (Owner-only: delegates get 403 — mirrors the payouts write-guard pattern. RLS is the backstop for the normal path; view-as/service paths pin `affiliate_id` explicitly.)

```ts
/**
 * POST /api/sub-affiliates/label
 * Upsert a friendly label for one of the caller's sub-affiliate IDs.
 * Owner-only (delegates 403). Master-tier only.
 * Body: { sub_affiliate_id: string, label: string }  — empty label deletes.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAffiliateContext } from "@/lib/affiliate-context";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  sub_affiliate_id: z.string().trim().min(1).max(200),
  label: z.string().trim().max(120),
});

export async function POST(req: NextRequest) {
  const ctx = await getAffiliateContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.isDelegate) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  if (ctx.affiliate.tier !== "master") {
    return NextResponse.json({ error: "Master tier only" }, { status: 403 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { sub_affiliate_id, label } = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = ctx.db as any;
  if (label === "") {
    const { error } = await db
      .from("sub_affiliate_labels")
      .delete()
      .eq("affiliate_id", ctx.affiliateId)
      .eq("sub_affiliate_id", sub_affiliate_id);
    if (error) return NextResponse.json({ error: "Delete failed" }, { status: 500 });
    return NextResponse.json({ success: true, deleted: true });
  }

  const { error } = await db
    .from("sub_affiliate_labels")
    .upsert(
      { affiliate_id: ctx.affiliateId, sub_affiliate_id, label, updated_at: new Date().toISOString() },
      { onConflict: "affiliate_id,sub_affiliate_id" },
    );
  if (error) return NextResponse.json({ error: "Save failed" }, { status: 500 });
  return NextResponse.json({ success: true });
}
```

**Step 2:** `npx tsc --noEmit` → PASS. **Step 3: Commit** — `git commit -m "feat(sub-affiliates): label upsert route (owner+master only)"`

---

## Task 11: Sub-Affiliates page + roster component

**Files:**
- Create: `src/app/dashboard/sub-affiliates/page.tsx`
- Create: `src/components/dashboard/SubAffiliateRoster.tsx`

**Step 1 — page** (server component; guard pattern copied from `earnings/page.tsx`'s delegate gate; page style from `users/page.tsx`):

```tsx
import { redirect } from "next/navigation";
import { getAffiliateContext } from "@/lib/affiliate-context";
import { buildSubAffiliateRollup, DIRECT_KEY } from "@/lib/sub-affiliates/rollup";
import SubAffiliateRoster from "@/components/dashboard/SubAffiliateRoster";
import { fmt } from "@/lib/fmt";

export const dynamic = "force-dynamic";

export default async function SubAffiliatesPage() {
  const ctx = await getAffiliateContext();
  if (!ctx) return null;
  const { db, affiliateId, affiliate, isDelegate, delegatePermissions } = ctx;

  // Master-tier only — direct-URL protection, not just nav hiding.
  if (affiliate.tier !== "master") redirect("/dashboard");
  const showEarnings = !isDelegate || delegatePermissions.canViewEarnings;

  const [{ data: users }, { data: txns }, { data: earnings }, { data: labels }] = await Promise.all([
    db.from("referred_users")
      .select("id, sub_affiliate_id, status_slug, first_transaction_amount, created_at")
      .eq("affiliate_id", affiliateId),
    db.from("transactions")
      .select("referred_user_id, amount")
      .eq("affiliate_id", affiliateId)
      .eq("transaction_type", "Transfer In")
      .eq("self_referral", false),
    db.from("earnings")
      .select("referred_user_id, amount, status")
      .eq("affiliate_id", affiliateId),
    db.from("sub_affiliate_labels")
      .select("sub_affiliate_id, label")
      .eq("affiliate_id", affiliateId),
  ]);

  const rows = buildSubAffiliateRollup({
    users: users ?? [], transactions: txns ?? [],
    earnings: earnings ?? [], labels: labels ?? [],
  });

  const subRows   = rows.filter((r) => r.subId !== DIRECT_KEY);
  const directRow = rows.find((r) => r.subId === DIRECT_KEY) ?? null;
  const agg = (list: typeof rows, k: "userCount" | "transactedCount" | "volume" | "earningsTotal") =>
    list.reduce((s, r) => s + r[k], 0);

  return (
    <>
      <div className="animate-reveal-up">
        <h1 className="text-2xl font-bold text-gray-900">Sub-Affiliates</h1>
        <p className="text-sm text-brand-400 mt-1">
          Performance of your network, grouped by sub-affiliate ID.
        </p>
      </div>

      {/* Aggregate rollup: sub-tagged vs direct */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat-card">
          <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Sub-Affiliates</p>
          <p className="text-stat font-bold text-gray-900 tabular-nums mt-1">{fmt.count(subRows.length)}</p>
        </div>
        <div className="stat-card">
          <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Network Users</p>
          <p className="text-stat font-bold text-gray-900 tabular-nums mt-1">{fmt.count(agg(subRows, "userCount"))}</p>
          <p className="text-[10px] text-brand-400 mt-1 tabular-nums">+{fmt.count(directRow?.userCount ?? 0)} direct</p>
        </div>
        <div className="stat-card">
          <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Network Volume</p>
          <p className="text-stat font-bold text-gray-900 tabular-nums mt-1">{fmt.currencyCompact(agg(subRows, "volume"))}</p>
          <p className="text-[10px] text-brand-400 mt-1 tabular-nums">+{fmt.currencyCompact(directRow?.volume ?? 0)} direct</p>
        </div>
        {showEarnings ? (
          <div className="stat-card-accent">
            <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Network Earnings</p>
            <p className="text-stat font-bold text-gray-900 tabular-nums mt-1">{fmt.currency(agg(subRows, "earningsTotal"))}</p>
            <p className="text-[10px] text-brand-400 mt-1 tabular-nums">+{fmt.currency(directRow?.earningsTotal ?? 0)} direct</p>
          </div>
        ) : (
          <div className="stat-card">
            <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Transacted</p>
            <p className="text-stat font-bold text-gray-900 tabular-nums mt-1">{fmt.count(agg(subRows, "transactedCount"))}</p>
          </div>
        )}
      </div>

      <SubAffiliateRoster rows={rows} showEarnings={showEarnings} canEditLabels={!isDelegate} />
    </>
  );
}
```

> **Executor check:** confirm the exact field name for delegate permissions on `AffiliateContext` (`delegatePermissions` per `affiliate-context.ts:33-49`) and adjust destructuring if it differs.

**Step 2 — roster component** (`"use client"`; table styling copied from `UserTable.tsx` — read it first for `.th`/row classes; inline label editing):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/fmt";
import { DIRECT_KEY, type SubRollupRow } from "@/lib/sub-affiliates/rollup";

interface Props {
  rows: SubRollupRow[];
  showEarnings: boolean;
  canEditLabels: boolean;
}

export default function SubAffiliateRoster({ rows, showEarnings, canEditLabels }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft]     = useState("");
  const [saving, setSaving]   = useState(false);

  async function saveLabel(subId: string) {
    setSaving(true);
    try {
      const res = await fetch("/api/sub-affiliates/label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sub_affiliate_id: subId, label: draft.trim() }),
      });
      if (res.ok) {
        setEditing(null);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-brand-400">
          No referred users yet. Sub-affiliates appear here once tagged sign-ups arrive.
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-surface-200/60">
              <th className="th text-left px-5 py-3">Sub-Affiliate</th>
              <th className="th text-right px-4 py-3">Users</th>
              <th className="th text-right px-4 py-3">Transacted</th>
              <th className="th text-right px-4 py-3">Conversion</th>
              <th className="th text-right px-4 py-3">Volume</th>
              {showEarnings && <th className="th text-right px-4 py-3">Earnings</th>}
              <th className="th text-right px-5 py-3">Last Activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isDirect = r.subId === DIRECT_KEY;
              return (
                <tr key={r.subId} className="border-b border-surface-200/40 last:border-0 hover:bg-surface-50/60 transition-colors">
                  <td className="px-5 py-3.5">
                    {isDirect ? (
                      <span className="text-sm font-medium text-brand-400">Direct (untagged)</span>
                    ) : editing === r.subId ? (
                      <form
                        onSubmit={(e) => { e.preventDefault(); saveLabel(r.subId); }}
                        className="flex items-center gap-2"
                      >
                        <input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          maxLength={120}
                          placeholder="Name this sub-affiliate"
                          className="input-base rounded-xl text-sm px-2.5 py-1 w-44"
                        />
                        <button type="submit" disabled={saving} className="btn-primary text-xs px-2.5 py-1 rounded-lg">
                          {saving ? "…" : "Save"}
                        </button>
                        <button type="button" onClick={() => setEditing(null)} className="text-xs text-brand-400 hover:text-gray-900">
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {r.label ?? r.subId}
                          </p>
                          {r.label && (
                            <p className="text-[10px] text-brand-400 tabular-nums truncate">{r.subId}</p>
                          )}
                        </div>
                        {canEditLabels && (
                          <button
                            onClick={() => { setEditing(r.subId); setDraft(r.label ?? ""); }}
                            className="text-[10px] text-brand-400 hover:text-brand-600 font-medium flex-shrink-0"
                            aria-label={`Edit label for ${r.subId}`}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right text-sm text-gray-600 tabular-nums">{fmt.count(r.userCount)}</td>
                  <td className="px-4 py-3.5 text-right text-sm text-gray-600 tabular-nums">{fmt.count(r.transactedCount)}</td>
                  <td className="px-4 py-3.5 text-right text-sm text-gray-600 tabular-nums">{r.conversionPct.toFixed(1)}%</td>
                  <td className="px-4 py-3.5 text-right text-sm font-semibold text-gray-900 tabular-nums">{fmt.currency(r.volume)}</td>
                  {showEarnings && (
                    <td className="px-4 py-3.5 text-right text-sm font-semibold text-accent tabular-nums">{fmt.currency(r.earningsTotal)}</td>
                  )}
                  <td className="px-5 py-3.5 text-right text-xs text-brand-400 tabular-nums">
                    {r.lastActivity ? fmt.date(r.lastActivity) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

> **Executor check:** read `src/components/dashboard/UserTable.tsx` first and match its actual table/`.th` class conventions; the markup above follows CLAUDE.md's design tokens but the existing table is the source of truth for idiom.

**Step 3:** `npx tsc --noEmit` + `npm run build` → PASS.

**Step 4: Commit** — `git commit -m "feat(sub-affiliates): master roster page with rollup + editable labels"`

---

## Task 12: Nav item

**Files:**
- Modify: `src/app/dashboard/layout.tsx:32-39, 175-179`

**Step 1:** `AFFILIATE_NAV` is a `const` array — build the effective nav at render time. After the `navItems` assignment (line 175), change to:

```ts
  const baseNav = [...AFFILIATE_NAV] as Array<{ label: string; href: string; icon: "grid" | "users" | "wallet" | "dollar" | "link" | "support"; exact?: boolean }>;
  if (affiliate.tier === "master") {
    // Insert Sub-Affiliates right after Users.
    const usersIdx = baseNav.findIndex((n) => n.href === "/dashboard/users");
    baseNav.splice(usersIdx + 1, 0, { label: "Sub-Affiliates", href: "/dashboard/sub-affiliates", icon: "users" });
  }
  const navItems = filterNavForDelegate(baseNav, {
    isDelegate,
    canViewEarnings: delegatePerms.canViewEarnings,
    canViewPayouts:  delegatePerms.canViewPayouts,
  });
```

> **Executor check:** the icon union comes from `AppSidebar`'s nav item props — read `src/components/layout/AppSidebar.tsx` to confirm allowed icon names and the exact `navItems` prop type; reuse `"users"` or add a distinct icon only if the sidebar already supports one.

**Step 2:** `npx tsc --noEmit` + `npm run build` → PASS.

**Step 3: Commit** — `git commit -m "feat(sub-affiliates): conditional nav item for master tier"`

---

## Task 13: Final verification, push, self-annealing log

**Step 1:** Full gate: `npx tsc --noEmit && npm run build && npm test` — all green.

**Step 2:** Append a `### [2026-08-19] — Master Tier (T3) + sub-affiliate structure` entry to CLAUDE.md §6 (Self-Annealing Log): tier is 4-valued now; subs are IDs not rows; computeTier master-stickiness bug class; statement displayTier widening; where the rollup lib lives. Also update CLAUDE.md §2/§8 references (tier list, `referred_users` columns, `sub_affiliate_labels` table).

**Step 3:** `git push origin main`, wait ~60s, verify live URL (no 500s; a non-master affiliate sees no nav change).

**Step 4 (manual, with Miles or via admin):** set a test affiliate to `Master Tier - T3` in Airtable → trigger sync → badge + nav appear; seed `Sub Aff ID` on Launch List rows → user sync → roster groups; run transactions sync → master earning = fee × 20%, `tier_at_earning='master'`.

---

## Explicitly OUT OF SCOPE (v1)
- Demo-route (`/demo`) parity for the master view.
- "Sub" column on `/dashboard/users` UserTable.
- Per-sub drill-down (view-as-a-sub).
- Admin-side sub-affiliate surfaces beyond the tier badge.
- GHL-side wiring (link param → opportunity custom field → Airtable `Sub Aff ID`) — happens in HighLevel/n8n, not this repo.
