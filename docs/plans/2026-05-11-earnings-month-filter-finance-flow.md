# Earnings Month Filter + AM→Finance Payout Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a month filter to `/admin/earnings`, introduce a `pending_review` payout state with an Account Manager → Finance review flow gated by `FINANCE_EMAILS`, and close the loop by flipping earnings to `paid` when their linked payout completes.

**Architecture:** Extend the existing `payouts` table (no new tables) with `batch_id`, `submitted_*`, `reviewed_*`, `review_notes`. Add `earnings.payout_id` FK for the mark-paid loop. New role helper `isFinanceEmail` parallel to `isAdminEmail`. Two new server routes (approve-batch, reject-batch); three existing routes modified (create-batch, execute-batch, update-status). UI changes on `/admin/earnings` (month filter + submit drawer) and `/admin/payouts` (Finance review sections + sidebar badge).

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres), TypeScript, Tailwind. No test framework in this repo — verification is `npx tsc --noEmit` + `npm run build` + manual smoke (per CLAUDE.md §4C). Pure logic gets ad-hoc `node --input-type=module -e` checks.

**Reference design:** [docs/plans/2026-05-11-earnings-month-filter-finance-flow-design.md](./2026-05-11-earnings-month-filter-finance-flow-design.md)

---

## Phase 0 — Database & types

### Task 1: Migration `020_payment_batches.sql`

**Files:**
- Create: `supabase/migrations/020_payment_batches.sql`

**Step 1: Write the migration**

```sql
-- 020_payment_batches.sql
-- Adds batch metadata to payouts + payout_id FK on earnings for the
-- AM→Finance review flow. Status CHECK is extended to allow the new
-- pending_review and rejected values.

alter table public.payouts
  add column if not exists batch_id      uuid,
  add column if not exists submitted_by  text,
  add column if not exists submitted_at  timestamptz,
  add column if not exists reviewed_by   text,
  add column if not exists reviewed_at   timestamptz,
  add column if not exists review_notes  text;

create index if not exists payouts_batch_id_idx on public.payouts (batch_id);

alter table public.payouts drop constraint if exists payouts_status_check;
alter table public.payouts add constraint payouts_status_check check (
  status in ('pending_review','requested','processing','completed','failed','rejected')
);

alter table public.earnings
  add column if not exists payout_id uuid references public.payouts(id) on delete set null;

create index if not exists earnings_payout_id_idx on public.earnings (payout_id);
```

**Step 2: Apply via Supabase SQL editor**

Paste the contents and run. The "destructive operations" warning will fire on `drop constraint` — confirm and proceed.

**Step 3: Verify**

In SQL editor:
```sql
select column_name, data_type
from information_schema.columns
where table_schema='public'
  and table_name='payouts'
  and column_name in ('batch_id','submitted_by','submitted_at','reviewed_by','reviewed_at','review_notes');
-- expect: 6 rows

select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='earnings' and column_name='payout_id';
-- expect: 1 row, uuid

-- CHECK constraint test
insert into payouts (affiliate_id, amount, currency, status)
  values ((select id from affiliates limit 1), 1, 'usd', 'pending_review')
  returning id;
-- expect: success. Then rollback or delete.
```

**Step 4: Commit**

```bash
git add supabase/migrations/020_payment_batches.sql
git commit -m "feat(db): payouts batch metadata + earnings.payout_id FK"
```

---

### Task 2: TypeScript type updates

**Files:**
- Modify: `src/types/database.ts`

**Step 1: Find and extend `PayoutStatus`**

Search for `PayoutStatus` (or `PaymentStatus` — verify the exact name). Add the two new values:

```ts
export type PayoutStatus =
  | "pending_review"   // NEW
  | "requested"
  | "processing"
  | "completed"
  | "failed"
  | "rejected";        // NEW
```

If the type was defined inline rather than as a named union, hoist it to a named union now.

**Step 2: Extend the `Payout` interface**

Add the 6 new fields. Place them after the existing fields, before any closing brace:

```ts
export interface Payout {
  // ... existing fields stay as-is ...
  batch_id: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
}
```

**Step 3: Extend the `Earning` interface**

Add `payout_id`:

```ts
export interface Earning {
  // ... existing fields ...
  payout_id: string | null;
}
```

**Step 4: Verify**

```bash
npx tsc --noEmit
```
Expected: clean. There may be a handful of places that destructure `Payout` and need updating — if so, fix them by adding the new fields where required (most call sites only read existing fields).

**Step 5: Commit**

```bash
git add src/types/database.ts
git commit -m "feat(types): add batch + payout_id fields to Payout and Earning"
```

---

## Phase 1 — Role helper + env

### Task 3: `isFinanceEmail` helper + env docs

**Files:**
- Modify: `src/lib/admin.ts`
- Modify: `.env.local` (your local), `.env.local.example`
- Modify: `CLAUDE.md` (section 9)

**Step 1: Add `isFinanceEmail` to `src/lib/admin.ts`**

Append to the file (after `isStaffEmail`):

```ts
/**
 * Finance access check — server-side only.
 * Finance emails are defined in the FINANCE_EMAILS environment variable.
 * Convention: every email in FINANCE_EMAILS must also be in ADMIN_EMAILS.
 * Comma-separated list: "grey@kashupay.com,miles@kashupay.com"
 */
export function isFinanceEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const finance = (process.env.FINANCE_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return finance.includes(email.toLowerCase());
}
```

**Step 2: Update `.env.local.example`**

Add (alongside `ADMIN_EMAILS`):
```
FINANCE_EMAILS=grey@kashupay.com,miles@kashupay.com
```

**Step 3: Update your local `.env.local`** with the same value.

**Step 4: Document in CLAUDE.md §9**

Find the env-vars list and add:
```
FINANCE_EMAILS           (comma-separated finance allowlist — subset of ADMIN_EMAILS; required for batch approve/execute)
```

**Step 5: Ad-hoc verify the helper**

```bash
FINANCE_EMAILS="grey@kashupay.com,miles@kashupay.com" node --input-type=module -e "
const isFinanceEmail = (email) => {
  if (!email) return false;
  const f = (process.env.FINANCE_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return f.includes(String(email).toLowerCase());
};
console.log(isFinanceEmail('grey@kashupay.com'));     // true
console.log(isFinanceEmail('MILES@kashupay.com'));    // true (case-insensitive)
console.log(isFinanceEmail('admin@kashupay.com'));    // false
console.log(isFinanceEmail(null));                    // false
console.log(isFinanceEmail(undefined));               // false
"
```
Expected: `true / true / false / false / false`.

**Step 6: Set `FINANCE_EMAILS` in Vercel (preview + prod)**

Use the Vercel dashboard or CLI:
```bash
# from repo root, if vercel CLI is linked
vercel env add FINANCE_EMAILS preview
# (paste: grey@kashupay.com,miles@kashupay.com)
vercel env add FINANCE_EMAILS production
# (paste: grey@kashupay.com,miles@kashupay.com)
```

If CLI is unavailable, set via the dashboard. **Must be set before merging the feature PR.**

**Step 7: Commit (code only; env values are not committed)**

```bash
git add src/lib/admin.ts .env.local.example CLAUDE.md
git commit -m "feat(auth): isFinanceEmail helper + FINANCE_EMAILS env var"
```

---

## Phase 2 — Server routes

### Task 4: Modify `create-batch` for explicit earning selection + pending_review

**Files:**
- Modify: `src/app/api/admin/payouts/create-batch/route.ts`

**Step 1: Read the existing route**

```bash
cat src/app/api/admin/payouts/create-batch/route.ts
```

Currently it auto-selects all approved earnings and creates payouts with `status='requested'`. We're changing it to: accept explicit `earning_ids`, validate, link via `payout_id`, and start payouts at `status='pending_review'`.

**Step 2: Replace the file content**

Use this complete replacement (it preserves the existing safety checks):

```ts
/**
 * POST /api/admin/payouts/create-batch
 *
 * Account Manager-only: submit a payment batch for Finance review.
 * Takes explicit earning_ids (selected on /admin/earnings), validates them,
 * groups by affiliate, and creates one payout row per affiliate at
 * status='pending_review' with a shared batch_id.
 */

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";
import type { Earning, PayoutSettings } from "@/types/database";

const BodySchema = z.object({
  earning_ids: z.array(z.string().uuid()).min(1).max(500),
  period: z.string().min(1).max(32),       // e.g. "2026-04" or "monthly_2026_04"
  notes: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let rawBody: unknown;
  try { rawBody = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { earning_ids, period, notes } = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // 1. Fetch the requested earnings + their affiliates (contract status + payout account)
  const { data: earnings, error: earningsErr } = await svc
    .from("earnings")
    .select("id, affiliate_id, amount, status, payout_id, affiliates!inner(agreement_status)")
    .in("id", earning_ids);

  if (earningsErr) {
    console.error("[admin/payouts/create-batch] earnings fetch failed:", earningsErr);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  type Row = Earning & { affiliates: { agreement_status: string | null } | null };
  const rows = (earnings ?? []) as Row[];

  // 2. Validate each earning. Build skipped[] for reporting.
  const skipped: { earning_id: string; reason: string }[] = [];
  const eligible: Row[] = [];
  for (const r of rows) {
    if (r.status !== "approved") { skipped.push({ earning_id: r.id, reason: `status=${r.status}` }); continue; }
    if (r.payout_id != null)     { skipped.push({ earning_id: r.id, reason: "already in another batch" }); continue; }
    const cs = r.affiliates?.agreement_status;
    if (cs !== "Completed" && cs !== "signed") {
      skipped.push({ earning_id: r.id, reason: "affiliate contract not signed" });
      continue;
    }
    eligible.push(r);
  }

  // Detect missing IDs from the request that weren't returned
  const returnedIds = new Set(rows.map((r) => r.id));
  for (const id of earning_ids) {
    if (!returnedIds.has(id)) skipped.push({ earning_id: id, reason: "not found" });
  }

  if (eligible.length === 0) {
    return NextResponse.json({ approved: 0, skipped, message: "No eligible earnings to batch." }, { status: 409 });
  }

  // 3. Look up payout settings for min_payout
  const { data: settings } = await svc.from("payout_settings").select("*").maybeSingle();
  const minPayout = (settings as PayoutSettings | null)?.min_payout_amount ?? 25;

  // 4. Group eligible earnings by affiliate, sum amounts
  const byAffiliate = new Map<string, Row[]>();
  for (const r of eligible) {
    const list = byAffiliate.get(r.affiliate_id) ?? [];
    list.push(r);
    byAffiliate.set(r.affiliate_id, list);
  }

  // 5. For each affiliate group, look up default verified payout account
  const affiliateIds = [...byAffiliate.keys()];
  const { data: accountsRaw } = await svc
    .from("payout_accounts")
    .select("id, affiliate_id, is_default, is_verified")
    .in("affiliate_id", affiliateIds);
  type Acct = { id: string; affiliate_id: string; is_default: boolean; is_verified: boolean };
  const accounts = (accountsRaw ?? []) as Acct[];
  const accountByAffiliate = new Map<string, string>();
  for (const a of accounts) {
    if (a.is_verified && a.is_default) accountByAffiliate.set(a.affiliate_id, a.id);
  }

  // 6. Create payouts with a shared batch_id; below-minimum groups are skipped
  const batch_id = randomUUID();
  const submitted_at = new Date().toISOString();

  type Inserted = { id: string; affiliate_id: string };
  const insertedPayouts: Inserted[] = [];
  let totalAmount = 0;

  for (const [affiliate_id, group] of byAffiliate) {
    const amount = group.reduce((s, r) => s + Number(r.amount || 0), 0);
    if (amount < minPayout) {
      for (const r of group) skipped.push({ earning_id: r.id, reason: `below minimum (${amount} < ${minPayout})` });
      continue;
    }

    const payout_account_id = accountByAffiliate.get(affiliate_id) ?? null;
    if (!payout_account_id) {
      for (const r of group) skipped.push({ earning_id: r.id, reason: "no verified payout account" });
      continue;
    }

    const { data: ins, error: insErr } = await svc
      .from("payouts")
      .insert({
        affiliate_id,
        payout_account_id,
        amount,
        currency: "usd",
        status: "pending_review",
        period,
        batch_id,
        submitted_by: user.email,
        submitted_at,
        // notes go on the payout for now — same value across all payouts in the batch
        review_notes: notes ?? null,
      })
      .select("id, affiliate_id")
      .single();

    if (insErr || !ins) {
      console.error("[create-batch] insert failed:", insErr);
      // continue — partial success is better than total failure; the AM can re-submit
      for (const r of group) skipped.push({ earning_id: r.id, reason: "insert failed" });
      continue;
    }

    insertedPayouts.push(ins as Inserted);
    totalAmount += amount;

    // 7. Link the earnings to this payout
    const groupIds = group.map((r) => r.id);
    const { error: linkErr } = await svc
      .from("earnings")
      .update({ payout_id: (ins as Inserted).id, updated_at: new Date().toISOString() })
      .in("id", groupIds)
      .eq("status", "approved")
      .is("payout_id", null);
    if (linkErr) {
      console.error("[create-batch] earnings link failed:", linkErr);
      // The payout exists but earnings aren't linked — Finance can still see and reject.
    }
  }

  if (insertedPayouts.length === 0) {
    return NextResponse.json({ approved: 0, batch_id: null, skipped, message: "All affiliate groups skipped." }, { status: 409 });
  }

  logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: "admin.batch_submit",
    resourceType: "payouts",
    metadata: {
      batch_id,
      period,
      payout_count: insertedPayouts.length,
      total_amount: totalAmount,
      earning_ids_sample: earning_ids.slice(0, 10),
      skipped_count: skipped.length,
    },
  });

  return NextResponse.json({
    batch_id,
    payout_count: insertedPayouts.length,
    total_amount: totalAmount,
    skipped,
  });
}
```

**Step 3: Verify**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/app/api/admin/payouts/create-batch/route.ts
git commit -m "feat(admin/payouts): explicit earning_ids batch submission to pending_review"
```

---

### Task 5: New `approve-batch` route

**Files:**
- Create: `src/app/api/admin/payouts/approve-batch/route.ts`

```ts
/**
 * POST /api/admin/payouts/approve-batch
 *
 * Finance-only: flip all payouts in a batch from pending_review → requested.
 * Sets reviewed_by/at and optional review_notes.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isFinanceEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";

const BodySchema = z.object({
  batch_id: z.string().uuid(),
  notes: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !isFinanceEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let rawBody: unknown;
  try { rawBody = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const { batch_id, notes } = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  const now = new Date().toISOString();
  const { data: updated, error } = await svc
    .from("payouts")
    .update({
      status: "requested",
      reviewed_by: user.email,
      reviewed_at: now,
      review_notes: notes ?? null,
      updated_at: now,
    })
    .eq("batch_id", batch_id)
    .eq("status", "pending_review")
    .select("id, amount, affiliate_id");

  if (error) {
    console.error("[admin/payouts/approve-batch] update failed:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const rows = updated ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ approved: 0, message: "No payouts in pending_review for that batch." }, { status: 409 });
  }

  logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: "admin.batch_approve",
    resourceType: "payouts",
    metadata: { batch_id, count: rows.length },
  });

  return NextResponse.json({ approved: rows.length, batch_id });
}
```

**Verify + commit:**
```bash
npx tsc --noEmit
git add src/app/api/admin/payouts/approve-batch/route.ts
git commit -m "feat(admin/payouts): approve-batch route (Finance-gated)"
```

---

### Task 6: New `reject-batch` route

**Files:**
- Create: `src/app/api/admin/payouts/reject-batch/route.ts`

```ts
/**
 * POST /api/admin/payouts/reject-batch
 *
 * Finance-only: flip all payouts in a batch from pending_review → rejected.
 * Clears earnings.payout_id so the earnings can be re-batched later.
 * Requires notes.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isFinanceEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";

const BodySchema = z.object({
  batch_id: z.string().uuid(),
  notes: z.string().min(1).max(500),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !isFinanceEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let rawBody: unknown;
  try { rawBody = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const { batch_id, notes } = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // 1. Find the payouts in this batch (pending_review only)
  const { data: payoutRows, error: lookupErr } = await svc
    .from("payouts")
    .select("id")
    .eq("batch_id", batch_id)
    .eq("status", "pending_review");

  if (lookupErr) {
    console.error("[admin/payouts/reject-batch] lookup failed:", lookupErr);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const payoutIds = ((payoutRows as { id: string }[] | null) ?? []).map((r) => r.id);
  if (payoutIds.length === 0) {
    return NextResponse.json({ rejected: 0, message: "No payouts in pending_review for that batch." }, { status: 409 });
  }

  // 2. Clear earnings.payout_id for those payouts (so the earnings are re-batchable)
  const { error: clearErr } = await svc
    .from("earnings")
    .update({ payout_id: null, updated_at: new Date().toISOString() })
    .in("payout_id", payoutIds);
  if (clearErr) {
    console.error("[admin/payouts/reject-batch] earnings unlink failed:", clearErr);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  // 3. Flip the payouts to rejected
  const now = new Date().toISOString();
  const { error: rejErr } = await svc
    .from("payouts")
    .update({
      status: "rejected",
      reviewed_by: user.email,
      reviewed_at: now,
      review_notes: notes,
      updated_at: now,
    })
    .in("id", payoutIds);

  if (rejErr) {
    console.error("[admin/payouts/reject-batch] payouts update failed:", rejErr);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: "admin.batch_reject",
    resourceType: "payouts",
    metadata: { batch_id, count: payoutIds.length, notes },
  });

  return NextResponse.json({ rejected: payoutIds.length, batch_id });
}
```

**Verify + commit:**
```bash
npx tsc --noEmit
git add src/app/api/admin/payouts/reject-batch/route.ts
git commit -m "feat(admin/payouts): reject-batch route (Finance-gated, unlinks earnings)"
```

---

### Task 7: Modify `execute-batch` — Finance gate + optional batch_id scope

**Files:**
- Modify: `src/app/api/admin/payouts/execute-batch/route.ts`

**Step 1: Read the existing file**

```bash
cat src/app/api/admin/payouts/execute-batch/route.ts
```

**Step 2: Apply two surgical changes**

(a) Replace the auth check (currently `isAdminEmail`):

```ts
import { isFinanceEmail } from "@/lib/admin";
// ...
if (!user || !isFinanceEmail(user.email)) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

(b) Accept an optional `{ batch_id?: string }` body. At the top of the handler, parse the body if present, default to `null`:

```ts
let batch_id: string | null = null;
try {
  const body = await request.json();
  if (body && typeof body.batch_id === "string") batch_id = body.batch_id;
} catch { /* empty body is fine */ }
```

You'll need to change the function signature from `export async function POST()` to `export async function POST(request: NextRequest)` and add `import { NextRequest, NextResponse } from "next/server"` if not already imported.

(c) After fetching `requestedPayouts`, scope by `batch_id` when provided:

```ts
const { data: requestedPayouts, error: fetchError } = await svc
  .from("payouts")
  .select("*")
  .eq("status", "requested")
  .order("created_at", { ascending: true });

if (fetchError) { /* existing error path */ }

let payoutsToExecute: Payout[] = requestedPayouts ?? [];
if (batch_id) {
  payoutsToExecute = payoutsToExecute.filter((p) => p.batch_id === batch_id);
}
```

(d) Update the audit log call to include `batch_id`:

```ts
metadata: {
  // existing keys
  batch_id,                       // NEW
  // ...
},
```

(e) Update the `action` name from whatever it currently is to `admin.batch_execute` for consistency with the design doc. (If it was something else like `admin.payouts_execute`, change it. Verify by reading the existing line.)

**Step 3: Verify**

```bash
npx tsc --noEmit
npm run build 2>&1 | tail -5
```

**Step 4: Commit**

```bash
git add src/app/api/admin/payouts/execute-batch/route.ts
git commit -m "feat(admin/payouts): execute-batch Finance-gated + optional batch_id scope"
```

---

### Task 8: Modify `update-status` — Finance gate + mark-paid loop

**Files:**
- Modify: `src/app/api/admin/payouts/update-status/route.ts`

**Step 1: Read existing**

```bash
cat src/app/api/admin/payouts/update-status/route.ts
```

**Step 2: Two changes**

(a) Replace the auth check with `isFinanceEmail`:
```ts
import { isFinanceEmail } from "@/lib/admin";
// ...
if (!user || !isFinanceEmail(user.email)) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

(b) After the existing payout update + notification logic, when `status === "completed"`, also mark the linked earnings as paid:

```ts
// Find the existing block that handles status === "completed" (it inserts a notification).
// Immediately AFTER the notification insert (or wherever the success branch lives), add:

let earnings_marked_paid = 0;
if (status === "completed") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: paidRows, error: paidErr } = await (svc as any)
    .from("earnings")
    .update({ status: "paid", updated_at: new Date().toISOString() })
    .eq("payout_id", payout_id)
    .eq("status", "approved")
    .select("id");
  if (paidErr) {
    console.error("[admin/payouts/update-status] mark-paid failed:", paidErr);
    // Don't fail the request — the payout completion is already recorded.
    // The earnings can be reconciled out-of-band if this update fails.
  }
  earnings_marked_paid = (paidRows ?? []).length;
}
```

(c) Update the audit log metadata to include `earnings_marked_paid` (use `admin.payout_complete` for the action name when `status === "completed"`, and `admin.payout_fail` when `status === "failed"`):

```ts
logSecurityEvent({
  userId: user.id,
  userEmail: user.email,
  action: status === "completed" ? "admin.payout_complete" : "admin.payout_fail",
  resourceType: "payouts",
  metadata: { payout_id, status, earnings_marked_paid },
});
```

(d) Return the count in the response:

```ts
return NextResponse.json({ success: true, earnings_marked_paid });
```

**Step 3: Verify**

```bash
npx tsc --noEmit
npm run build 2>&1 | tail -5
```

**Step 4: Commit**

```bash
git add src/app/api/admin/payouts/update-status/route.ts
git commit -m "feat(admin/payouts): mark linked earnings 'paid' when payout completes"
```

---

## Phase 3 — `/admin/earnings` month filter + submit drawer

### Task 9: Server-side month list + Tx Date enrichment

**Files:**
- Modify: `src/app/admin/earnings/page.tsx`

**Step 1: Read existing**

```bash
cat src/app/admin/earnings/page.tsx
```

The page already enriches each earning with `tpv` and `funnel_percent` from the joined transactions table via `transaction_ref → transactions.airtable_record_id`. Add `transaction_date` to that join and surface it on each row.

**Step 2: Edit the file**

(a) Extend the `transactions.select` to include `transaction_date`:

```ts
const { data: refTxns } = await db
  .from("transactions")
  .select("airtable_record_id, amount, funnel_percent, transaction_date")
  .in("airtable_record_id", earningRefs);
type RefRow = Pick<Transaction, "airtable_record_id" | "amount"> & {
  funnel_percent: number | null;
  transaction_date: string | null;
};
for (const t of (refTxns ?? []) as RefRow[]) {
  txnByRef.set(t.airtable_record_id, {
    amount: Number(t.amount) || 0,
    funnel_percent: t.funnel_percent != null ? Number(t.funnel_percent) : null,
    transaction_date: t.transaction_date,
  });
}
```

(Update the `txnByRef` Map type to include `transaction_date: string | null`.)

(b) Add `transaction_date` and `payout_id` to the `enriched` mapping:

```ts
const enriched: AdminEarning[] = allEarnings.map((e) => {
  const ref = e.transaction_ref ? txnByRef.get(e.transaction_ref) : undefined;
  return {
    // existing fields...
    transaction_date:      ref?.transaction_date ?? null,
    payout_id:             e.payout_id,
  };
});
```

(c) Compute the list of available months from earnings, server-side:

```ts
// Build month options from the joined transaction_date values.
// Format: { value: "2026-04", label: "April 2026" }
const monthSet = new Set<string>();
for (const e of enriched) {
  if (e.transaction_date) {
    const ym = e.transaction_date.slice(0, 7); // "2026-04"
    monthSet.add(ym);
  }
}
const months = [...monthSet].sort().reverse().map((ym) => {
  const [yr, mo] = ym.split("-");
  const d = new Date(Number(yr), Number(mo) - 1, 1);
  const label = d.toLocaleString("en-US", { month: "long", year: "numeric" });
  return { value: ym, label };
});
```

(d) Pass `months` to `<AdminEarningsTable months={months} ...>` along with the existing `earnings` prop.

**Step 3: Verify**

```bash
npx tsc --noEmit
```

(The TypeScript error about `AdminEarning` not having `transaction_date` / `payout_id` is expected — those are added in Task 10.)

**Step 4: Commit (defer until Task 10 lands the type change so TS is clean)**

Pause here. Continue to Task 10 before committing.

---

### Task 10: AdminEarningsTable — month filter + Tx Date column + "In batch" pill + Submit button

**Files:**
- Modify: `src/components/admin/AdminEarningsTable.tsx`

**Step 1: Extend `AdminEarning` interface**

Add at the top of the file:

```ts
export interface AdminEarning {
  // ... existing fields ...
  transaction_date: string | null;
  payout_id: string | null;
}
```

**Step 2: Accept `months` prop on the component**

```tsx
interface MonthOption { value: string; label: string; }

export default function AdminEarningsTable({
  earnings,
  months,
}: {
  earnings: AdminEarning[];
  months: MonthOption[];
}) {
  // ...
}
```

**Step 3: Add a `monthFilter` state**

Near the existing `statusFilter` `useState`, add:

```ts
const [monthFilter, setMonthFilter] = useState<string>("all");
```

**Step 4: Extend the `filtered` memo**

```ts
const filtered = useMemo(() => {
  let list = earnings;
  if (monthFilter !== "all") {
    list = list.filter((e) => e.transaction_date && e.transaction_date.startsWith(monthFilter));
  }
  if (statusFilter === "all") return list;
  if (statusFilter === "blocked") {
    return list.filter((e) => e.status === "pending" && !isContractSigned(e.contract_status));
  }
  return list.filter((e) => e.status === statusFilter);
}, [earnings, statusFilter, monthFilter]);
```

**Step 5: Render the month filter `<select>`**

Find the existing filter row (where the status `<select>` lives, around the header section) and add the month picker BEFORE the status filter:

```tsx
<select
  value={monthFilter}
  onChange={(e) => setMonthFilter(e.target.value)}
  className="text-xs rounded-xl border border-surface-200 bg-white text-gray-900 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-600/30"
>
  <option value="all">All months</option>
  {months.map((m) => (
    <option key={m.value} value={m.value}>{m.label}</option>
  ))}
</select>
```

**Step 6: Replace the "Date" column with "Tx Date"**

Find the column header — currently labeled `Date`:
```tsx
<th className="th">Date</th>
```
Change to:
```tsx
<th className="th">Tx Date</th>
```

And in the row body, change the cell that renders `fmt.date(e.created_at)` to `fmt.date(e.transaction_date ?? e.created_at)` — the fallback to `created_at` keeps display sane when `transaction_date` is null. Also wrap with a fallback marker:

```tsx
<td className="td">
  {e.transaction_date ? (
    <span className="text-xs text-gray-700">{fmt.date(e.transaction_date)}</span>
  ) : (
    <span className="text-xs text-brand-400 italic">{fmt.date(e.created_at)}</span>
  )}
</td>
```

**Step 7: Add "In batch" pill in the Status column**

Find the Status cell that currently renders `<EarningStatusBadge ... />` (or similar). Append a small pill when `e.payout_id` is set:

```tsx
<td className="td">
  {/* existing status badge */}
  {e.payout_id && (
    <span className="ml-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full border text-brand-600 bg-brand-50 border-brand-200">
      In batch
    </span>
  )}
</td>
```

**Step 8: Add the "Submit for payout review" button next to "Approve Selected"**

Find the existing "Approve Selected" button block. Add a sibling button beneath it (or next to it in the header action row):

```tsx
{selectedApprovedIds.length > 0 && (
  <button
    onClick={() => setSubmitDrawerOpen(true)}
    disabled={pending}
    className="btn-primary px-3 py-1.5 rounded-xl text-xs disabled:opacity-50"
    type="button"
  >
    Submit for payout review ({selectedApprovedIds.length})
  </button>
)}
```

You'll need to compute `selectedApprovedIds`: the subset of `selected` that has `status === "approved"` AND `payout_id == null`. Add this near the other `useMemo`s:

```ts
const selectedApprovedIds = useMemo(
  () => Array.from(selected).filter((id) => {
    const e = earnings.find((x) => x.id === id);
    return e && e.status === "approved" && e.payout_id == null;
  }),
  [selected, earnings],
);
```

And `submitDrawerOpen` state:

```ts
const [submitDrawerOpen, setSubmitDrawerOpen] = useState(false);
```

**Step 9: Conditionally render `<SubmitBatchDrawer>`**

At the bottom of the component's returned JSX:

```tsx
{submitDrawerOpen && (
  <SubmitBatchDrawer
    earnings={earnings.filter((e) => selectedApprovedIds.includes(e.id))}
    defaultPeriod={monthFilter !== "all" ? monthFilter : new Date().toISOString().slice(0, 7)}
    onClose={() => setSubmitDrawerOpen(false)}
    onSuccess={() => {
      setSubmitDrawerOpen(false);
      setSelected(new Set());
      router.refresh();
    }}
  />
)}
```

Import the new component:
```ts
import SubmitBatchDrawer from "./SubmitBatchDrawer";
```

**Step 10: Verify**

```bash
npx tsc --noEmit
```

Expected: only error is `Cannot find module './SubmitBatchDrawer'` — that's the next task.

**Step 11: Pause; commit after Task 11**

---

### Task 11: `SubmitBatchDrawer` component

**Files:**
- Create: `src/components/admin/SubmitBatchDrawer.tsx`

**Step 1: Write the component**

```tsx
"use client";

import { useMemo, useState } from "react";
import { fmt } from "@/lib/fmt";
import type { AdminEarning } from "./AdminEarningsTable";

interface Props {
  earnings: AdminEarning[];
  defaultPeriod: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SubmitBatchDrawer({ earnings, defaultPeriod, onClose, onSuccess }: Props) {
  const [period, setPeriod] = useState(defaultPeriod);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Group by affiliate for preview
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; total: number; count: number }>();
    for (const e of earnings) {
      const cur = m.get(e.affiliate_id) ?? { name: e.affiliate_name, total: 0, count: 0 };
      cur.total += e.amount;
      cur.count += 1;
      m.set(e.affiliate_id, cur);
    }
    return [...m.entries()].map(([id, g]) => ({ id, ...g })).sort((a, b) => b.total - a.total);
  }, [earnings]);

  const total = groups.reduce((s, g) => s + g.total, 0);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payouts/create-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          earning_ids: earnings.map((e) => e.id),
          period,
          notes: notes.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? json.message ?? "Submission failed");
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="drawer-backdrop fixed inset-0 bg-gray-900/30 z-40" onClick={onClose} />
      <div className="drawer-panel fixed inset-y-0 right-0 w-full max-w-lg bg-white shadow-card-md p-6 z-50 overflow-y-auto">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Submit for payout review</h2>
            <p className="text-xs text-brand-400 mt-1">
              {earnings.length} earnings across {groups.length} affiliate{groups.length === 1 ? "" : "s"}
            </p>
          </div>
          <button onClick={onClose} className="text-sm text-brand-400 hover:text-gray-900">Close</button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>
        )}

        <div className="space-y-4">
          <Field label="Period">
            <input
              className="input-base w-full font-mono text-xs"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="2026-04"
            />
            <p className="text-[10px] text-brand-400 mt-1">e.g. 2026-04 (used for grouping in Finance UI)</p>
          </Field>

          <Field label="Notes for Finance (optional)">
            <textarea
              className="input-base w-full"
              rows={3}
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any context Finance should know"
            />
          </Field>

          <div>
            <p className="text-[10px] font-bold text-brand-400 uppercase tracking-wider mb-2">Preview</p>
            <div className="card overflow-hidden">
              <table className="min-w-full text-xs">
                <thead className="bg-surface-50/60 border-b border-surface-200/60">
                  <tr>
                    <th className="th">Affiliate</th>
                    <th className="th text-right">Earnings</th>
                    <th className="th text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-200/60">
                  {groups.map((g) => (
                    <tr key={g.id}>
                      <td className="td"><span className="text-sm text-gray-900">{g.name}</span></td>
                      <td className="td text-right tabular-nums">{g.count}</td>
                      <td className="td text-right tabular-nums font-semibold">{fmt.currency(g.total)}</td>
                    </tr>
                  ))}
                  <tr className="bg-surface-50/60">
                    <td className="td font-bold text-gray-900">Total</td>
                    <td className="td"></td>
                    <td className="td text-right tabular-nums font-bold text-gray-900">{fmt.currency(total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-surface-200/60">
            <button onClick={onClose} className="text-sm text-brand-400 hover:text-gray-900">Cancel</button>
            <button
              onClick={submit}
              disabled={submitting || !period.trim() || earnings.length === 0}
              className="btn-primary px-4 py-2 rounded-xl text-sm disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Send to Finance"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
```

**Step 2: Verify**

```bash
npx tsc --noEmit
npm run build 2>&1 | tail -5
```
Both clean.

**Step 3: Smoke** (`npm run dev`)

Visit `/admin/earnings`. Confirm:
- Month filter appears in header row, populated with months derived from transaction dates.
- Selecting a month filters the table.
- "Tx Date" column renders transaction_date with the italic-brand fallback when missing.
- Selecting 1+ approved earnings (whose `payout_id` is null) reveals "Submit for payout review (N)" button.
- Clicking it opens the drawer with the right affiliate breakdown.
- Submitting calls `/api/admin/payouts/create-batch` and refreshes the table.
- Submitted earnings now show "In batch" pill.

**Step 4: Commit Tasks 9–11 together**

```bash
git add src/app/admin/earnings/page.tsx src/components/admin/AdminEarningsTable.tsx src/components/admin/SubmitBatchDrawer.tsx
git commit -m "feat(admin/earnings): month filter + Tx Date column + submit-batch drawer"
```

---

## Phase 4 — `/admin/payouts` Finance review UI

### Task 12: Server-side batch grouping

**Files:**
- Modify: `src/app/admin/payouts/page.tsx`

**Step 1: Read existing**

```bash
cat src/app/admin/payouts/page.tsx
```

**Step 2: Add server-side grouping by `batch_id`**

After the existing data fetches, group payouts:

```ts
// Group payouts by batch_id (null batch_id → "Legacy" bucket)
type BatchGroup = {
  batch_id: string | null;
  period: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  status: string;     // representative status (first row's status; we'll only group same-status)
  rows: PayoutRow[];
  total: number;
};

function groupBatches(payouts: Payout[], rows: PayoutRow[]): BatchGroup[] {
  const byKey = new Map<string, BatchGroup>();
  for (const p of payouts) {
    const key = `${p.batch_id ?? "legacy"}::${p.status}`;
    const row = rows.find((r) => r.id === p.id);
    if (!row) continue;
    const existing = byKey.get(key);
    if (existing) {
      existing.rows.push(row);
      existing.total += row.amount;
    } else {
      byKey.set(key, {
        batch_id: p.batch_id,
        period: p.period,
        submitted_by: p.submitted_by,
        submitted_at: p.submitted_at,
        reviewed_by: p.reviewed_by,
        reviewed_at: p.reviewed_at,
        review_notes: p.review_notes,
        status: p.status,
        rows: [row],
        total: row.amount,
      });
    }
  }
  return [...byKey.values()].sort((a, b) =>
    (b.submitted_at ?? "").localeCompare(a.submitted_at ?? ""),
  );
}

const pendingReviewBatches = groupBatches(
  allPayouts.filter((p) => p.status === "pending_review"),
  payoutRows,
);
const requestedBatches = groupBatches(
  allPayouts.filter((p) => p.status === "requested"),
  payoutRows,
);
```

**Step 3: Detect Finance user**

Add:
```ts
import { isFinanceEmail } from "@/lib/admin";
// ...
const isFinance = isFinanceEmail(user.email);
```

**Step 4: Pass new props to the renderer**

You'll pass `pendingReviewBatches`, `requestedBatches`, and `isFinance` to a new client component `BatchReviewSections.tsx` (Task 13). Plumb them through; render the new section above the existing `PayoutBatchManager`.

```tsx
<BatchReviewSections
  pendingReview={pendingReviewBatches}
  requested={requestedBatches}
  isFinance={isFinance}
/>
{/* existing PayoutBatchManager and other content stays */}
```

**Step 5: Pause; commit after Task 13**

---

### Task 13: `BatchReviewSections` component

**Files:**
- Create: `src/components/admin/BatchReviewSections.tsx`

**Step 1: Write the component**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/fmt";
import type { PayoutRow } from "./PayoutBatchManager";

export interface BatchGroup {
  batch_id: string | null;
  period: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  status: string;
  rows: PayoutRow[];
  total: number;
}

interface Props {
  pendingReview: BatchGroup[];
  requested: BatchGroup[];
  isFinance: boolean;
}

export default function BatchReviewSections({ pendingReview, requested, isFinance }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejectingBatch, setRejectingBatch] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  function approve(batch_id: string) {
    if (!isFinance) return;
    setActionError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/payouts/approve-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batch_id }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? json.message ?? "Approve failed");
        router.refresh();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Approve failed");
      }
    });
  }

  function executeBatch(batch_id: string) {
    if (!isFinance) return;
    if (!confirm(`Execute batch via Mercury? Real ACH transfers will be initiated.`)) return;
    setActionError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/payouts/execute-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batch_id }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? json.message ?? "Execute failed");
        router.refresh();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Execute failed");
      }
    });
  }

  function openReject(batch_id: string) {
    setRejectingBatch(batch_id);
    setRejectNotes("");
    setActionError(null);
  }
  function confirmReject() {
    if (!rejectingBatch || !isFinance) return;
    if (!rejectNotes.trim()) { setActionError("Notes required when rejecting"); return; }
    const batch_id = rejectingBatch;
    const notes = rejectNotes.trim();
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/payouts/reject-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batch_id, notes }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? json.message ?? "Reject failed");
        setRejectingBatch(null);
        router.refresh();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Reject failed");
      }
    });
  }

  return (
    <div className="space-y-6">
      {actionError && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">{actionError}</div>
      )}

      {pendingReview.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-brand-400 uppercase tracking-wider">Awaiting Finance review</h2>
            <span className="text-xs text-brand-400 tabular-nums">{pendingReview.length} batch{pendingReview.length === 1 ? "" : "es"}</span>
          </div>
          {pendingReview.map((batch) => (
            <BatchCard
              key={`${batch.batch_id}-pending`}
              batch={batch}
              actions={
                <>
                  <button
                    onClick={() => batch.batch_id && approve(batch.batch_id)}
                    disabled={!isFinance || pending || !batch.batch_id}
                    title={!isFinance ? "Finance team only" : undefined}
                    className="btn-primary px-3 py-1.5 rounded-xl text-xs disabled:opacity-40"
                  >
                    Approve batch
                  </button>
                  <button
                    onClick={() => batch.batch_id && openReject(batch.batch_id)}
                    disabled={!isFinance || pending || !batch.batch_id}
                    title={!isFinance ? "Finance team only" : undefined}
                    className="text-xs text-red-600 hover:text-red-700 disabled:opacity-40 px-3 py-1.5"
                  >
                    Reject
                  </button>
                </>
              }
            />
          ))}
        </section>
      )}

      {requested.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-brand-400 uppercase tracking-wider">Approved — ready to execute</h2>
            <span className="text-xs text-brand-400 tabular-nums">{requested.length} batch{requested.length === 1 ? "" : "es"}</span>
          </div>
          {requested.map((batch) => (
            <BatchCard
              key={`${batch.batch_id}-requested`}
              batch={batch}
              actions={
                <button
                  onClick={() => batch.batch_id && executeBatch(batch.batch_id)}
                  disabled={!isFinance || pending || !batch.batch_id}
                  title={!isFinance ? "Finance team only" : undefined}
                  className="btn-primary px-3 py-1.5 rounded-xl text-xs disabled:opacity-40"
                >
                  Execute via Mercury
                </button>
              }
            />
          ))}
        </section>
      )}

      {rejectingBatch && (
        <>
          <div className="drawer-backdrop fixed inset-0 bg-gray-900/30 z-40" onClick={() => setRejectingBatch(null)} />
          <div className="drawer-panel fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-card-md p-6 z-50 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Reject batch</h2>
              <button onClick={() => setRejectingBatch(null)} className="text-sm text-brand-400 hover:text-gray-900">Close</button>
            </div>
            <p className="text-xs text-brand-400 mb-3">Linked earnings will be unlinked and returned to the approved pool.</p>
            <textarea
              className="input-base w-full"
              rows={4}
              maxLength={500}
              placeholder="Reason (required)"
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
            />
            <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-surface-200/60">
              <button onClick={() => setRejectingBatch(null)} className="text-sm text-brand-400 hover:text-gray-900">Cancel</button>
              <button
                onClick={confirmReject}
                disabled={pending || !rejectNotes.trim()}
                className="btn-primary px-4 py-2 rounded-xl text-sm disabled:opacity-50 bg-red-600 hover:bg-red-700"
              >
                Confirm reject
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function BatchCard({ batch, actions }: { batch: BatchGroup; actions: React.ReactNode }) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            {batch.period ?? "No period"}
            {batch.batch_id && <span className="ml-2 text-[10px] font-mono text-brand-400">{batch.batch_id.slice(0, 8)}</span>}
          </p>
          <p className="text-xs text-brand-400 mt-0.5">
            {batch.submitted_by ? `Submitted by ${batch.submitted_by}` : "Legacy batch"}
            {batch.submitted_at && ` · ${fmt.relative(batch.submitted_at)}`}
          </p>
          {batch.review_notes && (
            <p className="text-xs text-gray-700 mt-1.5 italic">&ldquo;{batch.review_notes}&rdquo;</p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-display-sm font-bold tabular-nums text-gray-900">{fmt.currency(batch.total)}</p>
          <p className="text-[10px] text-brand-400">{batch.rows.length} payout{batch.rows.length === 1 ? "" : "s"}</p>
        </div>
      </div>

      <table className="min-w-full text-xs border-t border-surface-200/60 mt-2">
        <thead>
          <tr className="bg-surface-50/60">
            <th className="th">Affiliate</th>
            <th className="th text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-200/60">
          {batch.rows.map((r) => (
            <tr key={r.id}>
              <td className="td text-sm text-gray-900">{r.affiliate_name}</td>
              <td className="td text-right tabular-nums font-semibold">{fmt.currency(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-surface-200/60">
        {actions}
      </div>
    </div>
  );
}
```

**Step 2: Verify**

```bash
npx tsc --noEmit
npm run build 2>&1 | tail -5
```
Both clean.

**Step 3: Commit Tasks 12–13 together**

```bash
git add src/app/admin/payouts/page.tsx src/components/admin/BatchReviewSections.tsx
git commit -m "feat(admin/payouts): Finance review sections (approve/reject/execute by batch)"
```

---

## Phase 5 — Sidebar badge

### Task 14: Sidebar Payouts badge

**Files:**
- Modify: `src/app/admin/layout.tsx` (compute count + pass through)
- Modify: `src/components/layout/AppSidebar.tsx` (render badge if a nav item has `badgeCount`)

**Step 1: Inspect existing nav item shape**

```bash
grep -nE "interface NavItem|NavItem\s*=|badge" src/components/layout/AppSidebar.tsx | head
```

If `NavItem` doesn't have a `badgeCount` (or similar) field, add it:

```ts
export interface NavItem {
  // ... existing fields
  badgeCount?: number;
}
```

In the `<a>` rendering, when `item.badgeCount && item.badgeCount > 0`, render a small pill to the right of the label:

```tsx
{item.badgeCount && item.badgeCount > 0 ? (
  <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-accent text-brand-700 tabular-nums">
    {item.badgeCount}
  </span>
) : null}
```

**Step 2: Compute count in admin layout**

In `src/app/admin/layout.tsx`, fetch the count of distinct `batch_id`s in `pending_review`:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = createServiceClient() as any;
const { data: pendingReviewRows } = await db
  .from("payouts")
  .select("batch_id")
  .eq("status", "pending_review")
  .not("batch_id", "is", null);

const batchIds = new Set<string>();
for (const r of (pendingReviewRows ?? []) as { batch_id: string | null }[]) {
  if (r.batch_id) batchIds.add(r.batch_id);
}
const pendingReviewBatchCount = batchIds.size;
```

**Step 3: Wire the count into the Payouts nav item**

Find `ADMIN_NAV`. Inline-augment the Payouts item with `badgeCount`:

```ts
const navWithBadges = ADMIN_NAV.map((item) =>
  item.href === "/admin/payouts" ? { ...item, badgeCount: pendingReviewBatchCount } : item,
);
```

Pass `navWithBadges` to `<AppSidebar navItems={navWithBadges} ... />`.

**Step 4: Verify**

```bash
npx tsc --noEmit
npm run build 2>&1 | tail -5
```

**Step 5: Smoke**

`npm run dev`. With at least one pending_review batch in the DB:
- Sidebar shows `Payouts (1)` (or whatever) with the accent pill.
- Submitting a batch from `/admin/earnings` then revisiting any admin page → badge count increments.

**Step 6: Commit**

```bash
git add src/app/admin/layout.tsx src/components/layout/AppSidebar.tsx
git commit -m "feat(admin): sidebar badge for pending_review batches"
```

---

## Phase 6 — Verification & PR

### Task 15: Full verification matrix

**Step 1: Type & build**

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -5
```
Clean.

**Step 2: Manual smoke matrix on `npm run dev`** (with `FINANCE_EMAILS` set locally)

| Action | Expected |
|---|---|
| Visit `/admin/earnings` as AM | Month filter dropdown visible; Tx Date column shows transaction dates |
| Filter to a month | Only earnings with transactions in that month show |
| Select 2 approved earnings + Submit | Drawer opens with affiliate breakdown; submission succeeds |
| Submitted earnings | Show "In batch" pill; sidebar Payouts badge increments |
| Visit `/admin/payouts` as AM | "Awaiting Finance review" section shows the batch; Approve/Reject buttons disabled with tooltip |
| Visit `/admin/payouts` as Finance | Approve/Reject buttons enabled |
| Click Approve | Batch moves to "Ready to execute" section |
| Click Execute via Mercury | Mercury call fires (or dev no-op); payouts → `processing` |
| Manually call update-status with `completed` for a payout in the batch | Linked earnings flip to `paid`; sidebar badge updates |
| Submit another batch, then Reject with notes | Earnings revert to `approved` with `payout_id` cleared; batch shows `rejected` |
| Visit as a non-admin email | Redirected to `/dashboard` per existing guard |

**Step 3: Data verification**

```sql
-- Pick a recent batch_id and check linkage
select e.id, e.status, e.payout_id, p.status as payout_status, p.batch_id, p.period
from earnings e
left join payouts p on p.id = e.payout_id
where p.batch_id = '<batch_id>';
```

After `update-status → completed`: every linked earning should be `status='paid'`.

**Step 4: Audit log spot check**

```sql
select action, metadata, created_at from security_audit_logs
where action like 'admin.batch%' or action like 'admin.payout_%'
order by created_at desc
limit 20;
```
Expect: `admin.batch_submit`, `admin.batch_approve`, `admin.batch_execute`, `admin.payout_complete` events with batch/payout IDs.

**(no commit unless fixes are needed)**

---

### Task 16: Push branch + open PR

```bash
git push -u origin feat/earnings-month-filter-finance-flow
gh pr create --title "feat(admin): earnings month filter + AM→Finance payout flow" --body "$(cat <<'EOF'
## Summary
- New month filter on `/admin/earnings` keyed off `transactions.transaction_date`
- AM submits a batch of selected earnings; new payout status `pending_review`
- Finance role gated by `FINANCE_EMAILS` env var (grey@kashupay.com, miles@kashupay.com)
- Finance approves/rejects batches at `/admin/payouts`; only Finance can execute via Mercury
- When a payout flips to `completed`, all linked earnings flip to `paid` (loop closure via new `earnings.payout_id` FK)
- Reject path unlinks earnings so they're re-batchable
- Sidebar badge on Payouts shows count of `pending_review` batches

## Migrations
`020_payment_batches.sql` applied to prod before merge:
- `payouts`: 6 new columns (`batch_id`, `submitted_*`, `reviewed_*`, `review_notes`)
- `payouts.status` CHECK extended with `pending_review` and `rejected`
- `earnings.payout_id` FK added

## Env vars
`FINANCE_EMAILS` set in Vercel preview + prod before merge.

## Test plan
- [ ] AM at /admin/earnings: filter by month, submit batch
- [ ] AM at /admin/payouts: sees batch in "Awaiting" (read-only)
- [ ] Finance at /admin/payouts: approve → execute → mark completed → earnings flip to paid
- [ ] Reject path: notes required, earnings unlinked
- [ ] Sidebar badge tracks pending_review count
- [ ] Non-finance admin can't approve/execute (403 from server, disabled in UI)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Decisions to keep top-of-mind during execution

- **One commit per task** (except the bundled pairs noted: 9+10+11 and 12+13).
- **`force-dynamic` on every page** — preserve on the modified `/admin/earnings` and `/admin/payouts`.
- **`supabase as any` cast** when using service client (project convention).
- **`text-brand-400` not `text-gray-500`**; `fmt.*` not `.toFixed/.toLocaleString`; no `rounded-lg` on inputs (CLAUDE.md §2 bans).
- **Apply the migration BEFORE running the modified routes** — otherwise the new columns won't exist and writes fail.
- **Set `FINANCE_EMAILS` in Vercel BEFORE merging** — otherwise Finance routes return 403 in prod.
- **`isFinanceEmail` does NOT call `isAdminEmail` internally** — Finance routes are explicitly Finance-gated, but the page-level admin gate upstream already ensures the user is an admin. If a finance-only account is ever needed without admin access, the helpers can be chained.
- **Drawer/modal animations use the existing `.drawer-backdrop` / `.drawer-panel` utilities** in `globals.css` (added during the /tools work).
