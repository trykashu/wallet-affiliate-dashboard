# Conversion Rate / Status Regression Bug Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop `referred_users.status_slug` from regressing below `transaction_run` once a user has made a transaction, backfill the 7 currently-stuck users, and make the dashboard conversion rate robust to status-slug staleness.

**Architecture:** Three independent fixes in defense-in-depth order:
1. Dashboard `StatsRow` derives "transacted" from `first_transaction_amount` (transaction signal) instead of trusting `status_slug` — fixes the visible bug immediately and is robust to future regressions.
2. `users` and `highlevel` syncs protect `status_slug` during upsert: never downgrade below `transaction_run` if `first_transaction_amount IS NOT NULL`.
3. `transactions` sync drops the `!first_transaction_at` dedup gate on the status-advance path — always re-advance if behind, so any future regression self-heals on the next sync.
4. One-time backfill script to heal the 7 stuck users + insert missing `funnel_events`.

**Tech Stack:** Next.js 15 App Router, Supabase. No test framework in the repo — verification is `npx tsc --noEmit` + `npm run build` + SQL spot-checks. Pure logic gets ad-hoc `node` verification.

**Reference:** root cause traced in chat — `users` sync at [src/app/api/sync/users/route.ts:175](src/app/api/sync/users/route.ts#L175) upserts `status_slug` from CRM, overwriting the `transaction_run` advancement that [src/app/api/sync/transactions/route.ts:397](src/app/api/sync/transactions/route.ts#L397) sets. The `!first_transaction_at` gate at [transactions/route.ts:281](src/app/api/sync/transactions/route.ts#L281) prevents re-advancement on subsequent runs.

---

## Phase 0 — Quick verification of root-cause snapshot

### Task 1: Pre-flight DB check (no code change)

Capture the current stuck-user count before any fix so we can verify the backfill worked.

```bash
set -a; source .env.local; set +a
SUPA_URL="${NEXT_PUBLIC_SUPABASE_URL//\\n/}"; SUPA_URL="${SUPA_URL%\"}"; SUPA_URL="${SUPA_URL#\"}"
SUPA_KEY="${SUPABASE_SERVICE_ROLE_KEY//\\n/}"; SUPA_KEY="${SUPA_KEY%\"}"; SUPA_KEY="${SUPA_KEY#\"}"
curl -s "${SUPA_URL}/rest/v1/referred_users?select=id,full_name,status_slug,first_transaction_amount&first_transaction_amount=not.is.null&status_slug=in.(waitlist,booked_call,sent_onboarding,signed_up)" \
  -H "apikey: ${SUPA_KEY}" -H "Authorization: Bearer ${SUPA_KEY}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'stuck users: {len(d)}'); [print(f'  {r[\"status_slug\"]:15} {r[\"full_name\"]}') for r in d]"
```

Expected: exactly 7 stuck users (the same 7 found during diagnosis: Marc Malek, Leonardo Velazco, Jostane Bolo, Maria Oliveira, Kostiantyn Minov, Jeda Sanders, Jason Frobase). If the count differs, pause and re-verify root cause before applying fixes.

No commit — this is observability only.

---

## Phase 1 — Dashboard fix (user-visible bug, lowest risk)

### Task 2: Treat `first_transaction_amount` as the canonical "transacted" signal

**Files:**
- Modify: `src/components/dashboard/StatsRow.tsx:22-28`

**Step 1: Inspect current logic**

Open `src/components/dashboard/StatsRow.tsx`. The current code at lines 22-28:

```ts
/** Slugs that count as "transacted" (transaction_run or later in the funnel) */
const TRANSACTED_SLUGS = ["transaction_run", "funds_in_wallet", "ach_initiated", "funds_in_bank"];

export default function StatsRow({ users }: Props) {
  const brand = useBrand();
  const total      = users.length;
  const transacted = users.filter((u) => TRANSACTED_SLUGS.includes(u.status_slug)).length;
  const convRate   = total > 0 ? transacted / total : 0;
```

**Step 2: Replace the `transacted` filter**

Change the `transacted` line so it counts any user with a recorded first transaction OR a status at/past `transaction_run`. The new logic should be:

```ts
const total      = users.length;
// "Transacted" = any user with a recorded first transaction OR a status at/past transaction_run.
// We treat first_transaction_amount as the canonical signal because status_slug can be
// regressed by downstream syncs (the funnel-advance and the CRM-stage-pull don't always agree).
const transacted = users.filter(
  (u) =>
    (u.first_transaction_amount != null && u.first_transaction_amount > 0) ||
    TRANSACTED_SLUGS.includes(u.status_slug),
).length;
const convRate   = total > 0 ? transacted / total : 0;
```

Keep the `TRANSACTED_SLUGS` constant — the slug check is still useful for users who may have an advanced status without a recorded amount (edge case: status advanced via funnel events but the transaction is in a non-standard table).

**Step 3: Verify it compiles**

```bash
npx tsc --noEmit
```
Expected: clean.

**Step 4: Inline correctness check**

Replicate the new logic in `node` against Amy's known data to confirm her conversion rate would now be 25%:

```bash
node --input-type=module -e "
const users = [
  { status_slug: 'sent_onboarding', first_transaction_amount: null },
  { status_slug: 'sent_onboarding', first_transaction_amount: null },
  { status_slug: 'signed_up',       first_transaction_amount: 7500 },
  { status_slug: 'sent_onboarding', first_transaction_amount: null },
];
const TRANSACTED = new Set(['transaction_run','funds_in_wallet','ach_initiated','funds_in_bank']);
const transacted = users.filter(u => (u.first_transaction_amount != null && u.first_transaction_amount > 0) || TRANSACTED.has(u.status_slug)).length;
console.log('rate:', (transacted / users.length * 100).toFixed(1) + '%');
"
```
Expected: `rate: 25.0%` (Amy's correct rate: Jason is the 1 of 4).

**Step 5: Commit**

```bash
git add src/components/dashboard/StatsRow.tsx
git commit -m "fix(dashboard): derive conversion rate from first_transaction_amount

The previous logic relied on status_slug, which can be regressed below
transaction_run by the users/HighLevel CRM sync (it overwrites status
from CRM lifecycle stages). Affiliates with real transacting users were
showing 0% conversion because status was stale. Use first_transaction_amount
as the canonical 'transacted' signal; keep the slug check as a fallback."
```

---

## Phase 2 — Stop the regression at the source

### Task 3: Protect `status_slug` in `users` sync

**Files:**
- Modify: `src/app/api/sync/users/route.ts` (around lines 148-178)

**Step 1: Read the existing upsert block**

The relevant section starts at line 148 ("Load existing referred_users for change detection") and runs through line 178. Key issue: the existing lookup at line 157 selects `id, wallet_user_id, status_slug` but ignores `first_transaction_amount`. The upsert at line 175 blindly writes the CRM-derived `status_slug`.

**Step 2: Extend the existing-row lookup to include the financial signal**

In the `existingLookup` block (line 150-166), change the `.select` and the lookup record shape:

```ts
const existingLookup: Record<string, {
  id: string;
  status_slug: string;
  first_transaction_amount: number | null;
}> = {};

for (let i = 0; i < walletIds.length; i += BATCH_SIZE) {
  const batch = walletIds.slice(i, i + BATCH_SIZE);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (db as any)
    .from("referred_users")
    .select("id, wallet_user_id, status_slug, first_transaction_amount")
    .in("wallet_user_id", batch);

  for (const row of existing || []) {
    existingLookup[row.wallet_user_id] = {
      id: row.id,
      status_slug: row.status_slug,
      first_transaction_amount: row.first_transaction_amount,
    };
  }
}
```

**Step 3: Add a stage-protection helper at the top of the file (near other utilities)**

Find the existing imports/constants block. Add this helper (place it near `DEFAULT_STATUS`):

```ts
// Stages at or past transaction_run. Once a referred user reaches one of
// these, the CRM-pulled status MUST NOT regress them — they've proven
// they transacted, regardless of what the CRM lifecycle says.
const TRANSACTED_OR_PAST = new Set<FunnelStatusSlug>([
  "transaction_run",
  "funds_in_wallet",
  "ach_initiated",
  "funds_in_bank",
]);

/** Returns the slug that should be written to status_slug, given the
 *  CRM-derived slug and the existing row state. Never regresses below
 *  transaction_run if the existing row has a recorded first transaction. */
function preserveAdvancedStage(
  crmSlug: FunnelStatusSlug,
  existing: { status_slug: string; first_transaction_amount: number | null } | undefined,
): FunnelStatusSlug {
  if (!existing) return crmSlug;
  const hasTransaction =
    existing.first_transaction_amount != null && existing.first_transaction_amount > 0;
  const existingIsAdvanced = TRANSACTED_OR_PAST.has(existing.status_slug as FunnelStatusSlug);
  // If the user has transacted (or is already past transaction_run),
  // keep whichever stage is more advanced.
  if (hasTransaction || existingIsAdvanced) {
    const existingSlug = existing.status_slug as FunnelStatusSlug;
    // Both slugs may not be in stage order — be defensive.
    const existingIdx = STAGE_ORDER_USERS.indexOf(existingSlug);
    const crmIdx = STAGE_ORDER_USERS.indexOf(crmSlug);
    if (existingIdx === -1) return crmSlug;
    if (crmIdx === -1) return existingSlug;
    return crmIdx > existingIdx ? crmSlug : existingSlug;
  }
  return crmSlug;
}
```

If a `STAGE_ORDER` constant doesn't already exist in this file, add it (it does exist in the transactions sync; copy the same one):

```ts
const STAGE_ORDER_USERS: FunnelStatusSlug[] = [
  "waitlist",
  "booked_call",
  "sent_onboarding",
  "signed_up",
  "transaction_run",
  "funds_in_wallet",
  "ach_initiated",
  "funds_in_bank",
];
```

(Use the suffix `_USERS` to avoid collision risk in case future imports cross paths.)

**Step 4: Apply the protection when building the upsert batch**

Find the loop that builds `rows` (the upsert payloads). After it, BEFORE the batch upsert at line 170, walk `rows` and rewrite each row's `status_slug` using `preserveAdvancedStage`:

```ts
// Protect against status_slug regression: if the existing row indicates
// this user has transacted, never downgrade their stage from the CRM pull.
for (const row of rows) {
  const existing = existingLookup[row.wallet_user_id];
  row.status_slug = preserveAdvancedStage(row.status_slug, existing);
}
```

Place this immediately after the `existingLookup` block (line 167-ish) and before `// Batch upsert` (line 168).

**Step 5: Verify**

```bash
npx tsc --noEmit
npm run build 2>&1 | tail -5
```
Expected: clean. The route compiles.

**Step 6: Inline correctness check**

```bash
node --input-type=module -e "
const STAGE = ['waitlist','booked_call','sent_onboarding','signed_up','transaction_run','funds_in_wallet','ach_initiated','funds_in_bank'];
const TRANSACTED = new Set(['transaction_run','funds_in_wallet','ach_initiated','funds_in_bank']);
function preserve(crm, existing) {
  if (!existing) return crm;
  const has = existing.first_transaction_amount != null && existing.first_transaction_amount > 0;
  const adv = TRANSACTED.has(existing.status_slug);
  if (has || adv) {
    const ei = STAGE.indexOf(existing.status_slug);
    const ci = STAGE.indexOf(crm);
    if (ei === -1) return crm;
    if (ci === -1) return existing.status_slug;
    return ci > ei ? crm : existing.status_slug;
  }
  return crm;
}
// Case 1: existing has transaction at signed_up, CRM says signed_up → keep signed_up
console.log(preserve('signed_up', { status_slug: 'signed_up', first_transaction_amount: 7500 })); // expect: signed_up
// Case 2: existing has transaction at transaction_run, CRM says signed_up → keep transaction_run (the bug case)
console.log(preserve('signed_up', { status_slug: 'transaction_run', first_transaction_amount: 7500 })); // expect: transaction_run
// Case 3: no transaction yet, CRM says signed_up → use signed_up
console.log(preserve('signed_up', { status_slug: 'sent_onboarding', first_transaction_amount: null })); // expect: signed_up
// Case 4: existing past txn run with no amount (rare), CRM says signed_up → keep advanced
console.log(preserve('signed_up', { status_slug: 'funds_in_wallet', first_transaction_amount: null })); // expect: funds_in_wallet
// Case 5: existing at funds_in_wallet, CRM says ach_initiated → CRM is more advanced, take it
console.log(preserve('ach_initiated', { status_slug: 'funds_in_wallet', first_transaction_amount: 7500 })); // expect: ach_initiated
"
```
Expected output:
```
signed_up
transaction_run
signed_up
funds_in_wallet
ach_initiated
```

**Step 7: Commit**

```bash
git add src/app/api/sync/users/route.ts
git commit -m "fix(sync/users): protect status_slug from CRM regression

Users with first_transaction_amount set (or status at/past transaction_run)
will no longer be downgraded by the wallet/CRM upsert. The CRM sync only
overwrites status_slug if the new stage is strictly more advanced than
the existing one. Fixes a regression race where the transactions sync
correctly advanced a user to transaction_run, then this sync pulled the
CRM 'Signed Up' stage and clobbered the advancement back to signed_up."
```

---

### Task 4: Apply the same protection to `highlevel` sync (if applicable)

**Files:**
- Inspect: `src/app/api/sync/highlevel/route.ts`
- Modify: same, if it has the same upsert pattern

**Step 1: Confirm whether highlevel sync writes status_slug**

```bash
grep -n "upsert\|status_slug" src/app/api/sync/highlevel/route.ts | head -20
```

If the route does NOT do a write of `status_slug` (e.g. it only reads), skip this task. From the diagnosis we know it has `status_slug` writes (lines 30, 226 of the file), so it likely does. Read the upsert block:

```bash
sed -n '230,290p' src/app/api/sync/highlevel/route.ts
```

**Step 2: Apply the same fix**

If the file has an `existingLookup` similar to users sync, apply the identical pattern:
- Extend `existingLookup` to fetch `first_transaction_amount`
- Add `preserveAdvancedStage` (or import from a shared lib — see "DRY note" below)
- Walk the upsert rows and rewrite `status_slug` via the helper

**DRY note:** if both `users` and `highlevel` syncs end up with the same helper, factor it out to `src/lib/funnel-stage.ts`:

```ts
// src/lib/funnel-stage.ts
import type { FunnelStatusSlug } from "@/types/database";

export const STAGE_ORDER: FunnelStatusSlug[] = [
  "waitlist","booked_call","sent_onboarding","signed_up",
  "transaction_run","funds_in_wallet","ach_initiated","funds_in_bank",
];

export const TRANSACTED_OR_PAST = new Set<FunnelStatusSlug>([
  "transaction_run","funds_in_wallet","ach_initiated","funds_in_bank",
]);

export function preserveAdvancedStage(
  incoming: FunnelStatusSlug,
  existing: { status_slug: string; first_transaction_amount: number | null } | undefined,
): FunnelStatusSlug {
  if (!existing) return incoming;
  const hasTransaction =
    existing.first_transaction_amount != null && existing.first_transaction_amount > 0;
  const existingIsAdvanced = TRANSACTED_OR_PAST.has(existing.status_slug as FunnelStatusSlug);
  if (hasTransaction || existingIsAdvanced) {
    const existingSlug = existing.status_slug as FunnelStatusSlug;
    const existingIdx = STAGE_ORDER.indexOf(existingSlug);
    const incomingIdx = STAGE_ORDER.indexOf(incoming);
    if (existingIdx === -1) return incoming;
    if (incomingIdx === -1) return existingSlug;
    return incomingIdx > existingIdx ? incoming : existingSlug;
  }
  return incoming;
}
```

Then both `users/route.ts` and `highlevel/route.ts` import from this and the per-file copies go away. Do this as part of Task 4 since adding the second copy is the trigger to refactor.

**Step 3: Verify**

```bash
npx tsc --noEmit
npm run build 2>&1 | tail -5
```

**Step 4: Commit**

```bash
git add src/lib/funnel-stage.ts src/app/api/sync/users/route.ts src/app/api/sync/highlevel/route.ts
git commit -m "fix(sync/highlevel): protect status_slug from CRM regression

Same fix as users sync; factor the helper into src/lib/funnel-stage.ts
since two syncs now need it."
```

---

## Phase 3 — Self-healing transactions sync

### Task 5: Drop the `!first_transaction_at` gate on status-advance

**Files:**
- Modify: `src/app/api/sync/transactions/route.ts` (around lines 280-294)

**Step 1: Read the current gate**

The current logic at line 281:

```ts
// Track first-transaction update (for setting first_transaction_at)
if (!referredUser.first_transaction_at) {
  const alreadyQueued = firstTxnUpdates.some(
    (u) => u.referredUserId === referredUser!.id,
  );
  if (!alreadyQueued) {
    firstTxnUpdates.push({
      referredUserId: referredUser.id,
      affiliateId,
      amount,
      date: dateTxn,
      currentStatusSlug: referredUser.status_slug,
    });
  }
}
```

The `!referredUser.first_transaction_at` gate is the bug: it prevents re-advancement when a user has already been recorded as transacting (and was subsequently regressed).

**Step 2: Change the gate**

Replace the conditional with a two-purpose check: queue the update if EITHER (a) `first_transaction_at` is not yet set (preserves existing behavior of recording the first txn metadata), OR (b) the user's `status_slug` is currently before `transaction_run` (the recovery path):

```ts
// Queue an update if either:
//   - This is the first recorded transaction for this user (set financial fields), OR
//   - The user's status_slug is currently before transaction_run despite having a
//     transaction (self-heal a previously regressed user).
const needsFirstTxnRecord = !referredUser.first_transaction_at;
const currentIdxForCheck = stageIndex(referredUser.status_slug);
const txnRunIdxForCheck = stageIndex("transaction_run");
const needsStageAdvance =
  currentIdxForCheck >= 0 && currentIdxForCheck < txnRunIdxForCheck;

if (needsFirstTxnRecord || needsStageAdvance) {
  const alreadyQueued = firstTxnUpdates.some(
    (u) => u.referredUserId === referredUser!.id,
  );
  if (!alreadyQueued) {
    firstTxnUpdates.push({
      referredUserId: referredUser.id,
      affiliateId,
      amount,
      date: dateTxn,
      currentStatusSlug: referredUser.status_slug,
    });
  }
}
```

**Step 3: Guard the financial-field overwrite in the update loop**

Now that `firstTxnUpdates` can contain users whose financial fields are ALREADY set (because we're processing them only for the stage-advance), Task 5's update loop must not overwrite their existing `first_transaction_amount` / `first_transaction_at` with whatever happens to be in `update.amount` for the latest transaction.

Find the update loop around line 380:

```ts
for (const update of firstTxnUpdates) {
  const kashuFee = calculateKashuFee(update.amount); // 8.5% of TPV

  const updatePayload: Record<string, unknown> = {
    first_transaction_amount: update.amount,
    first_transaction_fee: kashuFee,
    first_transaction_at: update.date || new Date().toISOString(),
  };
  // ...
}
```

We need to know which fields to set. The simplest correct fix: re-fetch `first_transaction_at` per update target and only write the financial fields when it's NULL. Cleaner: include `firstTxnAlreadyRecorded: boolean` on the `firstTxnUpdates` push and use it here.

Modify the push site to carry this flag:

```ts
firstTxnUpdates.push({
  referredUserId: referredUser.id,
  affiliateId,
  amount,
  date: dateTxn,
  currentStatusSlug: referredUser.status_slug,
  firstTxnAlreadyRecorded: !!referredUser.first_transaction_at, // NEW
});
```

And update the TypeScript shape of `firstTxnUpdates` at line 152 to include the new field:

```ts
const firstTxnUpdates: {
  referredUserId: string;
  affiliateId: string;
  amount: number;
  date: string | null;
  currentStatusSlug: FunnelStatusSlug;
  firstTxnAlreadyRecorded: boolean; // NEW
}[] = [];
```

Then in the update loop, build the payload conditionally:

```ts
for (const update of firstTxnUpdates) {
  const updatePayload: Record<string, unknown> = {};

  // Only write financial fields if this is the first recorded transaction.
  // Otherwise we'd clobber the original first-txn metadata with a later
  // transaction's data.
  if (!update.firstTxnAlreadyRecorded) {
    const kashuFee = calculateKashuFee(update.amount); // 8.5% of TPV
    updatePayload.first_transaction_amount = update.amount;
    updatePayload.first_transaction_fee = kashuFee;
    updatePayload.first_transaction_at = update.date || new Date().toISOString();
  }

  // Advance to transaction_run if currently before it (always check)
  const currentIdx = stageIndex(update.currentStatusSlug);
  const txnRunIdx = stageIndex("transaction_run");
  const shouldAdvance = currentIdx >= 0 && currentIdx < txnRunIdx;

  if (shouldAdvance) {
    updatePayload.status_slug = "transaction_run";
  }

  // Skip the write if there's nothing to update (paranoia — should be unreachable
  // since the push site requires at least one of the two conditions).
  if (Object.keys(updatePayload).length === 0) continue;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateError } = await (db as any)
    .from("referred_users")
    .update(updatePayload)
    .eq("id", update.referredUserId);

  if (!updateError) {
    firstTxnProcessed++;

    if (shouldAdvance) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: funnelError } = await (db as any)
        .from("funnel_events")
        .insert({
          referred_user_id: update.referredUserId,
          from_status: update.currentStatusSlug,
          to_status: "transaction_run",
        });
      if (!funnelError) funnelEventsCreated++;
    }
  }
}
```

**Step 4: Verify**

```bash
npx tsc --noEmit
npm run build 2>&1 | tail -5
```

**Step 5: Commit**

```bash
git add src/app/api/sync/transactions/route.ts
git commit -m "fix(sync/transactions): self-heal regressed status_slug

The old gate (\`if (!first_transaction_at)\`) prevented re-advancement when
a previous sync set the financial fields but the user got later regressed
below transaction_run by the CRM sync. Now we also queue updates when the
user's status is behind transaction_run, but only write financial fields
on the first recorded transaction (never clobber the original first-txn
metadata)."
```

---

## Phase 4 — Backfill stuck users

### Task 6: One-time backfill script

**Files:**
- Create: `scripts/backfill-funnel-status.ts`

**Step 1: Write the script**

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
// One-time heal of referred_users whose status_slug is regressed below
// transaction_run despite having first_transaction_amount set. Advances
// them to transaction_run and inserts the corresponding funnel_event.
//
// Run: npx tsx scripts/backfill-funnel-status.ts
// Idempotent: re-running after success is a no-op.
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\\n|"|\s/g, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/\\n|"|\s/g, "");
if (!URL || !KEY) { console.error("Missing env"); process.exit(1); }
const supa = createClient(URL, KEY, { auth: { persistSession: false } });

const PRE_TXN_STATUSES = ["waitlist", "booked_call", "sent_onboarding", "signed_up"];

(async () => {
  // Find stuck users
  const { data: stuck, error: queryErr } = await (supa as any)
    .from("referred_users")
    .select("id, full_name, status_slug, first_transaction_amount, first_transaction_at")
    .not("first_transaction_amount", "is", null)
    .gt("first_transaction_amount", 0)
    .in("status_slug", PRE_TXN_STATUSES);

  if (queryErr) { console.error(queryErr); process.exit(1); }

  type StuckRow = {
    id: string; full_name: string; status_slug: string;
    first_transaction_amount: number; first_transaction_at: string | null;
  };
  const rows = (stuck ?? []) as StuckRow[];
  console.log(`Found ${rows.length} stuck users.`);
  if (rows.length === 0) { console.log("Nothing to do."); return; }

  // Advance each + insert a funnel_event
  let advanced = 0;
  let eventsCreated = 0;
  for (const r of rows) {
    console.log(`  advancing ${r.full_name} (${r.status_slug} → transaction_run)`);

    const { error: updErr } = await (supa as any)
      .from("referred_users")
      .update({
        status_slug: "transaction_run",
        updated_at: new Date().toISOString(),
      })
      .eq("id", r.id)
      // Guard race: only update if still in a pre-txn status
      .in("status_slug", PRE_TXN_STATUSES);

    if (updErr) {
      console.warn(`  WARN: update failed for ${r.full_name}: ${updErr.message}`);
      continue;
    }
    advanced++;

    const { error: evtErr } = await (supa as any)
      .from("funnel_events")
      .insert({
        referred_user_id: r.id,
        from_status: r.status_slug,
        to_status: "transaction_run",
      });
    if (!evtErr) eventsCreated++;
  }

  console.log(`done: advanced ${advanced}, funnel events created ${eventsCreated}`);
})().catch((e) => { console.error(e); process.exit(1); });
```

**Step 2: Verify compile**

```bash
npx tsc --noEmit
```

**Step 3: Commit (don't run yet)**

```bash
git add scripts/backfill-funnel-status.ts
git commit -m "feat(scripts): backfill-funnel-status one-time heal

Advances referred_users with first_transaction_amount set but status_slug
before transaction_run. Idempotent. Run once after deploying the sync
fixes from this branch."
```

---

### Task 7: Run the backfill against prod

**Step 1: Run**

```bash
set -a; source .env.local; set +a
npx tsx scripts/backfill-funnel-status.ts
```

Expected output (approximately):
```
Found 7 stuck users.
  advancing Marc Malek (signed_up → transaction_run)
  advancing Leonardo Velazco (signed_up → transaction_run)
  advancing Jostane Bolo (signed_up → transaction_run)
  advancing Maria Oliveira (signed_up → transaction_run)
  advancing Kostiantyn  Minov (signed_up → transaction_run)
  advancing Jeda Sanders (signed_up → transaction_run)
  advancing Jason Frobase (signed_up → transaction_run)
done: advanced 7, funnel events created 7
```

**Step 2: Verify zero remaining stuck users**

Re-run the Task 1 query:

```bash
set -a; source .env.local; set +a
SUPA_URL="${NEXT_PUBLIC_SUPABASE_URL//\\n/}"; SUPA_URL="${SUPA_URL%\"}"; SUPA_URL="${SUPA_URL#\"}"
SUPA_KEY="${SUPABASE_SERVICE_ROLE_KEY//\\n/}"; SUPA_KEY="${SUPA_KEY%\"}"; SUPA_KEY="${SUPA_KEY#\"}"
curl -s "${SUPA_URL}/rest/v1/referred_users?select=id&first_transaction_amount=not.is.null&status_slug=in.(waitlist,booked_call,sent_onboarding,signed_up)" \
  -H "apikey: ${SUPA_KEY}" -H "Authorization: Bearer ${SUPA_KEY}" \
  | python3 -c "import json,sys; print(f'remaining stuck: {len(json.load(sys.stdin))}')"
```
Expected: `remaining stuck: 0`

**Step 3: Spot-check Amy's user**

```bash
curl -s "${SUPA_URL}/rest/v1/referred_users?select=full_name,status_slug,first_transaction_amount&affiliate_id=eq.b93f5b06-de2f-400d-ad08-8611c5617168" \
  -H "apikey: ${SUPA_KEY}" -H "Authorization: Bearer ${SUPA_KEY}" | python3 -m json.tool
```
Expected: Jason Frobase now has `status_slug: "transaction_run"`. The other 3 users (Britthany, Antonio, sherwyn) remain at `sent_onboarding` (no transactions).

(No commit — runtime step.)

---

## Phase 5 — Verification

### Task 8: Full verification matrix

**Step 1: Build + types clean**

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -5
```

**Step 2: Smoke test the affected dashboard**

`npm run dev`, log in (or view-as) Amy Mauk. Visit `/dashboard`. The "Conversion Rate" stat card should now read **25.0%** (1 of 4 referred users). The "Transacted" card should read **1**.

**Step 3: Confirm no regression on `/admin/funnel`**

Visit `/admin/funnel` — the funnel chart now counts Jason in the transaction_run row across all affiliates. Quick spot check: the stage totals should reflect 7 newly-promoted users compared to before.

**Step 4: Confirm earnings approval gate unaffected**

Visit `/admin/earnings` — Amy/Jason should still appear in the same approval state they were in before. The status-slug fix is read-side; it doesn't change which earnings exist or their statuses.

(No commit unless fixes are needed.)

---

### Task 9: Push branch + open PR

**Files:** none

**Step 1: Push**

```bash
git push -u origin feat/conversion-rate-status-regression-fix
```

**Step 2: Open PR**

```bash
gh pr create --title "fix: conversion rate showing 0% — status_slug regression repair" --body "$(cat <<'EOF'
## Summary
Affiliates with real transacting referred users were seeing 0% conversion rate on /dashboard. Root cause: \`status_slug\` regression race between the transactions sync (correctly advances to transaction_run on first deposit) and the users/CRM sync (overwrites status_slug from CRM lifecycle, defaulting to signed_up). A one-time guard in the transactions sync (\`!first_transaction_at\`) then prevented re-advancement, leaving 7 users permanently stuck.

## Changes
- **Dashboard StatsRow**: conversion rate now derives \`transacted\` from \`first_transaction_amount\` (the canonical transaction signal), with a slug-set fallback. Fixes the visible bug immediately and is robust to future sync drift.
- **Users / HighLevel sync**: when upserting referred_users, never regress \`status_slug\` below an already-transacting state. Helper factored into \`src/lib/funnel-stage.ts\` for shared use.
- **Transactions sync**: also re-advance users whose status is behind transaction_run, not just on first transaction. Financial fields (\`first_transaction_amount\`, etc.) are only written on the first transaction — re-advances only set \`status_slug\`.
- **Backfill script**: \`scripts/backfill-funnel-status.ts\` advanced 7 stuck users + inserted funnel_events.

## Verification
- Local: tsc + build clean
- Amy Mauk's /dashboard conversion rate now shows 25.0% (was 0%)
- Zero remaining stuck users in prod (\`first_transaction_amount IS NOT NULL AND status_slug IN (...pre-txn slugs)\`)

## Test plan
- [ ] /dashboard renders correctly for an affiliate with transacted users (Amy Mauk → 25%)
- [ ] /dashboard renders correctly for an affiliate with no users (0%)
- [ ] /dashboard renders correctly for a 100%-converted affiliate
- [ ] /admin/funnel counts the newly-healed users correctly
- [ ] Re-running scripts/backfill-funnel-status.ts is a no-op
EOF
)"
```

---

## Decisions to keep top-of-mind during execution

- **One commit per task.** Frequent commits = easy rollback.
- **Task 2 (dashboard) is independent and lowest-risk.** Land it first to fix the visible bug for everyone immediately. The deeper sync fixes can follow.
- **Task 7 (backfill run) is destructive on prod.** Confirm `npm run dev` shows Amy at 25% AFTER Task 2 lands BEFORE running the backfill — otherwise rolling back Task 2 + Task 7 separately is harder.
- **DRY trigger:** when Task 4 needs the same helper Task 3 wrote, factor into `src/lib/funnel-stage.ts` rather than copy-paste.
- **`force-dynamic`, `supabase as any` cast, `fmt.*` helpers, `text-brand-400` over `text-gray-500`** — project conventions, don't drift.
- **Don't run backfill in CI** — same as the affiliate-content upload script. One-time local op.
- **No new DB triggers.** This codebase manages `updated_at` and similar app-side; keep that convention.
