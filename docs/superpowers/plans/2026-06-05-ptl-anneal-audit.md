# PTL "Anneal the Fixes" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single "Anneal the fixes" button to the admin PTL↔UT audit that, behind a preview→confirm→re-audit flow, creates missing PTL rows and corrects unpaid amount drifts using User Transactions as the source of truth.

**Architecture:** A server-authoritative endpoint (`POST /api/admin/audit-ptl/anneal`, `{dryRun}`) re-fetches PTL+UT from Airtable, runs the existing audit, builds a plan via a pure `buildAnnealPlan()`, and either returns it (dryRun) or applies it (create missing via a shared helper, PATCH unpaid drifts). Paid drifts and orphans are always skipped + reported.

**Tech Stack:** Next.js 15 App Router route handlers, TypeScript, Airtable REST (`src/lib/airtable.ts`), `node:test`/`tsx` for unit tests, React client component for the panel.

**Spec:** `docs/superpowers/specs/2026-06-05-ptl-anneal-audit-design.md`

---

### Task 1: Capture Commission Status on drifts + pure `buildAnnealPlan`

**Files:**
- Modify: `src/lib/audit/ptl-audit.ts`
- Test: `src/lib/audit/ptl-audit.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/audit/ptl-audit.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnnealPlan, type MonthAudit } from "./ptl-audit";

function month(over: Partial<MonthAudit> = {}): MonthAudit {
  return {
    month: "2026-05", ptl_count: 0, ptl_sum: 0, ut_match_sum: 0,
    orphans: [], drifts: [], missing: [], ...over,
  };
}

test("buildAnnealPlan: missing -> toCreate, orphans -> skipped", () => {
  const plan = buildAnnealPlan([
    month({
      missing: [{ ut_id: "utA", user_email: "a@x.com", referrer: "R1", amount: 100, transaction_id: "T1", transaction_date: "2026-05-01" }],
      orphans: [{ ptl_id: "ptlO", user_email: "o@x.com", amount: 50, transaction_id: "T9", transaction_date: "2026-05-02" }],
    }),
  ]);
  assert.equal(plan.toCreate.length, 1);
  assert.equal(plan.toCreate[0].ut_id, "utA");
  assert.equal(plan.skipped.orphans.length, 1);
  assert.equal(plan.toCorrect.length, 0);
});

test("buildAnnealPlan: unpaid drift -> toCorrect, paid drift -> skipped", () => {
  const plan = buildAnnealPlan([
    month({
      drifts: [
        { ptl_id: "p1", transaction_id: "T1", ptl_amount: 90, ut_amount: 100, delta: 10, commission_status: "Owed" },
        { ptl_id: "p2", transaction_id: "T2", ptl_amount: 80, ut_amount: 100, delta: 20, commission_status: "" },
        { ptl_id: "p3", transaction_id: "T3", ptl_amount: 70, ut_amount: 100, delta: 30, commission_status: "Paid" },
      ],
    }),
  ]);
  assert.deepEqual(plan.toCorrect.map((d) => d.ptl_id), ["p1", "p2"]);
  assert.deepEqual(plan.skipped.paidDrifts.map((d) => d.ptl_id), ["p3"]);
});

test("buildAnnealPlan: paid drift/orphan never in action sets", () => {
  const plan = buildAnnealPlan([
    month({
      orphans: [{ ptl_id: "o1", user_email: "", amount: 1, transaction_id: "T", transaction_date: "" }],
      drifts: [{ ptl_id: "p3", transaction_id: "T3", ptl_amount: 70, ut_amount: 100, delta: 30, commission_status: "Paid" }],
    }),
  ]);
  const actionIds = [...plan.toCreate.map(() => ""), ...plan.toCorrect.map((d) => d.ptl_id)];
  assert.ok(!actionIds.includes("p3"));
  assert.ok(!actionIds.includes("o1"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A3 ptl-audit`
Expected: FAIL — `buildAnnealPlan` is not exported / `commission_status` missing on `DriftRow`.

- [ ] **Step 3: Add `commission_status` to `DriftRow` and populate it**

In `src/lib/audit/ptl-audit.ts`, extend the `DriftRow` interface:

```ts
export interface DriftRow {
  ptl_id: string;
  transaction_id: string;
  ptl_amount: number;
  ut_amount: number;
  delta: number;
  commission_status: string;
}
```

In `auditPtlVsUt`, update the drift push (inside the PTL pass) to include the status:

```ts
    if (Math.abs(uAmt - amt) > 0.01) {
      bucket.drifts.push({
        ptl_id: p.id,
        transaction_id: txnId,
        ptl_amount: amt,
        ut_amount: uAmt,
        delta: uAmt - amt,
        commission_status: String(p.fields["Commission Status"] ?? "").trim(),
      });
    }
```

- [ ] **Step 4: Add the `AnnealPlan` type and `buildAnnealPlan`**

Append to `src/lib/audit/ptl-audit.ts`:

```ts
export interface AnnealPlan {
  toCreate: MissingRow[];                 // missing PTL rows to create from UT
  toCorrect: DriftRow[];                  // unpaid drifts to set Amount = UT amount
  skipped: { paidDrifts: DriftRow[]; orphans: OrphanRow[] };
}

/** A drift is safe to auto-correct only when its commission is still unpaid. */
const UNPAID_STATUSES = new Set(["", "owed"]);
export function isUnpaidStatus(status: string): boolean {
  return UNPAID_STATUSES.has((status ?? "").trim().toLowerCase());
}

/** Partition audit results into create / correct / skipped per the anneal rules. */
export function buildAnnealPlan(months: MonthAudit[]): AnnealPlan {
  const plan: AnnealPlan = { toCreate: [], toCorrect: [], skipped: { paidDrifts: [], orphans: [] } };
  for (const m of months) {
    plan.toCreate.push(...m.missing);
    plan.skipped.orphans.push(...m.orphans);
    for (const d of m.drifts) {
      if (isUnpaidStatus(d.commission_status)) plan.toCorrect.push(d);
      else plan.skipped.paidDrifts.push(d);
    }
  }
  return plan;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -A3 ptl-audit`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck + commit**

```bash
./node_modules/.bin/tsc --noEmit
git add src/lib/audit/ptl-audit.ts src/lib/audit/ptl-audit.test.ts
git commit -m "feat(audit): commission_status on drifts + buildAnnealPlan"
```

---

### Task 2: Pure PTL field mapping `buildPtlFieldsFromUt`

**Files:**
- Create: `src/lib/audit/ptl-anneal.ts`
- Test: `src/lib/audit/ptl-anneal.test.ts`

This extracts the exact field shape currently inlined in `create-row/route.ts` into a pure, tested function.

- [ ] **Step 1: Write the failing test**

Create `src/lib/audit/ptl-anneal.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPtlFieldsFromUt } from "./ptl-anneal";

const utRow = {
  id: "utX",
  createdTime: "2026-05-01T00:00:00.000Z",
  fields: {
    "Transaction ID": " T1 ",
    "Amount": 250,
    "Referrer": ["R1"],
    "Transaction Type": "Transfer In",
    "Date Txn Started": "2026-05-01",
    "Email": ["user@x.com"],
    "Last 4": "1234",
    "Card Issuer": "Visa",
  },
};

test("buildPtlFieldsFromUt: maps core fields and template defaults", () => {
  const f = buildPtlFieldsFromUt(utRow, "recAff1");
  assert.equal(f["Transaction ID"], "T1");           // trimmed
  assert.equal(f["Amount"], 250);
  assert.equal(f["Funnel %"], "8.5 %");
  assert.equal(f["Referrer"], "R1");
  assert.equal(f["Commission Status"], "Owed");
  assert.equal(f["Transaction Type"], "Transfer In");
  assert.equal(f["Transaction Date"], "2026-05-01");
  assert.deepEqual(f["Partner Match"], ["recAff1"]);
  assert.equal(f["User Email"], "user@x.com");
  assert.equal(f["Last 4 of Card"], 1234);
  assert.equal(f["Card Issuer"], "Visa");
});

test("buildPtlFieldsFromUt: strips empty/null optionals", () => {
  const f = buildPtlFieldsFromUt(
    { id: "u", createdTime: "", fields: { "Transaction ID": "T2", "Amount": 10, "Referrer": ["R2"] } },
    "recAff2",
  );
  assert.equal("Last 4 of Card" in f, false);
  assert.equal("Card Issuer" in f, false);
  assert.equal("User Email" in f, false);
  assert.equal(f["Transaction Type"], "Transfer In"); // default
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A3 ptl-anneal`
Expected: FAIL — module `./ptl-anneal` not found.

- [ ] **Step 3: Implement `buildPtlFieldsFromUt`**

Create `src/lib/audit/ptl-anneal.ts`:

```ts
import type { ATRecord } from "./ptl-audit";

/**
 * Build the Partner Transaction Log field object from a User Transactions row,
 * mirroring the upstream automation's template. Pure — no I/O.
 * Caller supplies the resolved Kashu Affiliates record id for `Partner Match`.
 */
export function buildPtlFieldsFromUt(
  ut: ATRecord,
  affiliateRecordId: string,
): Record<string, unknown> {
  const txnId = String(ut.fields["Transaction ID"] ?? "").trim();
  const referrer = (ut.fields["Referrer"] as string[] | undefined)?.[0]?.trim() ?? "";
  const emailArr = ut.fields["Email"] as string[] | undefined;
  const last4Raw = ut.fields["Last 4"];

  const fields: Record<string, unknown> = {
    "Transaction ID": txnId,
    "Amount": Number(ut.fields["Amount"]) || 0,
    "Funnel %": "8.5 %",
    "Referrer": referrer,
    "Commission Status": "Owed",
    "Transaction Type": (ut.fields["Transaction Type"] as string | undefined) ?? "Transfer In",
    "Transaction Date": (ut.fields["Date Txn Started"] as string | undefined) ?? null,
    "Partner Match": [affiliateRecordId],
    "User Email": emailArr?.[0] ?? null,
  };
  if (last4Raw !== undefined && last4Raw !== null && last4Raw !== "") {
    fields["Last 4 of Card"] = Number(last4Raw);
  }
  if (ut.fields["Card Issuer"]) fields["Card Issuer"] = ut.fields["Card Issuer"];

  // Strip nulls/empties — Airtable rejects null on some types.
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== ""));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -A3 ptl-anneal`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
./node_modules/.bin/tsc --noEmit
git add src/lib/audit/ptl-anneal.ts src/lib/audit/ptl-anneal.test.ts
git commit -m "feat(audit): pure buildPtlFieldsFromUt mapping"
```

---

### Task 3: `createPtlRowFromUt` network helper + refactor create-row route

**Files:**
- Modify: `src/lib/audit/ptl-anneal.ts`
- Modify: `src/app/api/admin/audit-ptl/create-row/route.ts`

No unit test for the network helper (matches the codebase, which does not test fetch-based routes); the pure mapping it depends on is covered by Task 2. Verified by `tsc` + `npm run build`.

- [ ] **Step 1: Add `createPtlRowFromUt` to `ptl-anneal.ts`**

Append to `src/lib/audit/ptl-anneal.ts`:

```ts
const PTL_TABLE = "tbluxSVVoAuhEWLd7";
const UT_TABLE = "tblyWtDBeiZAqDm8P";
const AFFILIATES_TABLE = "tbl9OoVL64Z1GiNzU";
const AT = "https://api.airtable.com/v0";

export interface AnnealDeps {
  affiliateBase: string;
  launchBase: string;
  pat: string;
}

export class AnnealError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
  }
}

/**
 * Create a PTL row for the given User Transactions record id.
 * Resolves the referrer to a Kashu Affiliates record, refuses if a PTL row
 * already exists for the Transaction ID. Returns the new PTL record id.
 */
export async function createPtlRowFromUt(
  utRecordId: string,
  deps: AnnealDeps,
): Promise<{ ptl_id: string; transaction_id: string }> {
  const { affiliateBase, launchBase, pat } = deps;
  const auth = { Authorization: `Bearer ${pat}` };

  const utRes = await fetch(`${AT}/${launchBase}/${UT_TABLE}/${utRecordId}`, { headers: auth, cache: "no-store" });
  if (!utRes.ok) throw new AnnealError(`UT fetch ${utRes.status}`, 502);
  const ut = (await utRes.json()) as ATRecord;

  const txnId = String(ut.fields["Transaction ID"] ?? "").trim();
  if (!txnId) throw new AnnealError("UT row has no Transaction ID", 422);

  const dupeFilter = encodeURIComponent(`{Transaction ID}='${txnId}'`);
  const dupeRes = await fetch(`${AT}/${affiliateBase}/${PTL_TABLE}?filterByFormula=${dupeFilter}&maxRecords=1`, { headers: auth, cache: "no-store" });
  const dupeJ = (await dupeRes.json()) as { records?: Array<{ id: string }> };
  if (dupeJ.records && dupeJ.records.length > 0) {
    throw new AnnealError(`PTL row already exists for TxnID ${txnId}: ${dupeJ.records[0].id}`, 409);
  }

  const referrer = (ut.fields["Referrer"] as string[] | undefined)?.[0]?.trim();
  if (!referrer) throw new AnnealError("UT row has no Referrer", 422);
  const affFilter = encodeURIComponent(`{Attribution ID}='${referrer}'`);
  const affRes = await fetch(`${AT}/${affiliateBase}/${AFFILIATES_TABLE}?filterByFormula=${affFilter}&maxRecords=1`, { headers: auth, cache: "no-store" });
  const affJ = (await affRes.json()) as { records?: Array<{ id: string }> };
  const affiliateRecordId = affJ.records?.[0]?.id;
  if (!affiliateRecordId) throw new AnnealError(`No Kashu Affiliates row for referrer ${referrer}`, 404);

  const cleaned = buildPtlFieldsFromUt(ut, affiliateRecordId);
  const createRes = await fetch(`${AT}/${affiliateBase}/${PTL_TABLE}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ records: [{ fields: cleaned }], typecast: true }),
  });
  const createJ = await createRes.json();
  if (!createRes.ok) throw new AnnealError(`PTL create ${createRes.status}: ${JSON.stringify(createJ).slice(0, 300)}`, 502);
  const created = (createJ as { records: Array<{ id: string }> }).records[0];
  return { ptl_id: created.id, transaction_id: txnId };
}
```

Add the `ATRecord` import at the top (merge with the existing import):

```ts
import type { ATRecord } from "./ptl-audit";
```

- [ ] **Step 2: Refactor create-row route to use the helper**

Replace the body of `src/app/api/admin/audit-ptl/create-row/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { createPtlRowFromUt, AnnealError } from "@/lib/audit/ptl-anneal";

export const dynamic = "force-dynamic";

const Body = z.object({ ut_record_id: z.string().min(1) });

export async function POST(req: Request) {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const affiliateBase = process.env.AIRTABLE_AFFILIATE_BASE?.replace(/\\n|"|\s/g, "");
  const launchBase = process.env.AIRTABLE_LAUNCH_BASE?.replace(/\\n|"|\s/g, "");
  const pat = process.env.AIRTABLE_PAT?.replace(/\\n|"|\s/g, "");
  if (!affiliateBase || !launchBase || !pat) {
    return NextResponse.json({ error: "Airtable not configured" }, { status: 500 });
  }

  try {
    const r = await createPtlRowFromUt(parsed.data.ut_record_id, { affiliateBase, launchBase, pat });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof AnnealError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[audit-ptl/create-row] failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Create failed" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify build + commit**

```bash
./node_modules/.bin/tsc --noEmit && npm run build
git add src/lib/audit/ptl-anneal.ts src/app/api/admin/audit-ptl/create-row/route.ts
git commit -m "refactor(audit): share createPtlRowFromUt between create-row and anneal"
```

Expected: tsc clean, build `✓ Compiled successfully`.

---

### Task 4: `POST /api/admin/audit-ptl/anneal` endpoint

**Files:**
- Create: `src/app/api/admin/audit-ptl/anneal/route.ts`

Network/orchestration route — verified by `tsc` + `npm run build`. The plan logic it relies on (`buildAnnealPlan`) is unit-tested in Task 1.

- [ ] **Step 1: Implement the route**

Create `src/app/api/admin/audit-ptl/anneal/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { fetchAllRecords, patchRecords } from "@/lib/airtable";
import { auditPtlVsUt, buildAnnealPlan } from "@/lib/audit/ptl-audit";
import { createPtlRowFromUt, AnnealError } from "@/lib/audit/ptl-anneal";

export const dynamic = "force-dynamic";

const PTL_TABLE = "tbluxSVVoAuhEWLd7";
const UT_TABLE = "tblyWtDBeiZAqDm8P";

const Body = z.object({ dryRun: z.boolean() });

export async function POST(req: Request) {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const affiliateBase = process.env.AIRTABLE_AFFILIATE_BASE?.replace(/\\n|"|\s/g, "");
  const launchBase = process.env.AIRTABLE_LAUNCH_BASE?.replace(/\\n|"|\s/g, "");
  const pat = process.env.AIRTABLE_PAT?.replace(/\\n|"|\s/g, "");
  if (!affiliateBase || !launchBase || !pat) {
    return NextResponse.json({ error: "Airtable not configured" }, { status: 500 });
  }

  try {
    // Always re-derive the plan from fresh data.
    const [ptl, ut] = await Promise.all([
      fetchAllRecords(affiliateBase, PTL_TABLE),
      fetchAllRecords(launchBase, UT_TABLE),
    ]);
    const months = auditPtlVsUt(ptl.records, ut.records);
    const plan = buildAnnealPlan(months);

    const summary = {
      create: plan.toCreate.length,
      correct: plan.toCorrect.length,
      skip_paid_drifts: plan.skipped.paidDrifts.length,
      skip_orphans: plan.skipped.orphans.length,
    };

    if (parsed.data.dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, summary, plan });
    }

    // Apply: create missing rows (sequential — dupe-guarded inside helper).
    const created: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    for (const row of plan.toCreate) {
      try {
        const r = await createPtlRowFromUt(row.ut_id, { affiliateBase, launchBase, pat });
        created.push(r.ptl_id);
      } catch (e) {
        failed.push({ id: row.ut_id, reason: e instanceof Error ? e.message : "create failed" });
      }
    }

    // Apply: correct unpaid drifts (PATCH Amount = UT amount; batched by helper).
    const corrections = plan.toCorrect.map((d) => ({ id: d.ptl_id, fields: { Amount: d.ut_amount } }));
    const patch = await patchRecords(affiliateBase, PTL_TABLE, corrections);
    for (const f of patch.failed) failed.push({ id: f.record_id, reason: f.error });

    return NextResponse.json({
      ok: true,
      dryRun: false,
      summary,
      result: {
        created: created.length,
        corrected: patch.updated,
        failed,
        skipped: { paidDrifts: plan.skipped.paidDrifts.length, orphans: plan.skipped.orphans.length },
      },
    });
  } catch (e) {
    if (e instanceof AnnealError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[audit-ptl/anneal] failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Anneal failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify build + commit**

```bash
./node_modules/.bin/tsc --noEmit && npm run build
git add src/app/api/admin/audit-ptl/anneal/route.ts
git commit -m "feat(audit): anneal endpoint (dryRun preview + apply)"
```

Expected: tsc clean, build success. New route `ƒ /api/admin/audit-ptl/anneal` in the route list.

---

### Task 5: AuditPanel — Anneal button, preview/confirm, results, re-audit

**Files:**
- Modify: `src/components/admin/AuditPanel.tsx`

UI — verified by `tsc` + `npm run build` and a manual click-through.

- [ ] **Step 1: Add `commission_status` to the client `DriftRow` interface**

In `src/components/admin/AuditPanel.tsx`, update:

```ts
interface DriftRow {
  ptl_id: string;
  transaction_id: string;
  ptl_amount: number;
  ut_amount: number;
  delta: number;
  commission_status: string;
}
```

- [ ] **Step 2: Add anneal types + state**

Below the `AuditResponse` interface, add:

```ts
interface AnnealSummary { create: number; correct: number; skip_paid_drifts: number; skip_orphans: number; }
interface AnnealApplyResult { created: number; corrected: number; failed: Array<{ id: string; reason: string }>; skipped: { paidDrifts: number; orphans: number }; }
```

Inside `AuditPanel`, add state (next to the existing `useState` hooks):

```ts
  const [annealPhase, setAnnealPhase] = useState<"idle" | "previewing" | "preview" | "applying" | "done">("idle");
  const [annealPreview, setAnnealPreview] = useState<AnnealSummary | null>(null);
  const [annealResult, setAnnealResult] = useState<AnnealApplyResult | null>(null);
  const [annealError, setAnnealError] = useState<string | null>(null);
```

- [ ] **Step 3: Add preview + apply handlers**

Add inside `AuditPanel` (after `createMissing`):

```ts
  const previewAnneal = useCallback(async () => {
    setAnnealPhase("previewing");
    setAnnealError(null);
    setAnnealResult(null);
    try {
      const res = await fetch("/api/admin/audit-ptl/anneal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Preview failed (${res.status})`);
      setAnnealPreview(body.summary as AnnealSummary);
      setAnnealPhase("preview");
    } catch (e) {
      setAnnealError(e instanceof Error ? e.message : "Preview failed");
      setAnnealPhase("idle");
    }
  }, []);

  const applyAnneal = useCallback(async () => {
    setAnnealPhase("applying");
    setAnnealError(null);
    try {
      const res = await fetch("/api/admin/audit-ptl/anneal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Anneal failed (${res.status})`);
      setAnnealResult(body.result as AnnealApplyResult);
      setAnnealPhase("done");
      await runAudit();           // re-audit to show the now-clean state
    } catch (e) {
      setAnnealError(e instanceof Error ? e.message : "Anneal failed");
      setAnnealPhase("preview");
    }
  }, [runAudit]);

  const actionable = result
    ? result.totals.missing + result.months.reduce((n, m) => n + m.drifts.filter((d) => {
        const s = (d.commission_status ?? "").trim().toLowerCase();
        return s === "" || s === "owed";
      }).length, 0)
    : 0;
```

- [ ] **Step 4: Render the Anneal control block**

In the JSX, immediately after the closing `</div>` of the `grid grid-cols-3 gap-3` summary cards block (and before the `Generated …` paragraph), insert:

```tsx
          {annealError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-xs text-red-700">{annealError}</p>
            </div>
          )}

          {actionable > 0 && annealPhase !== "done" && (
            <div className="flex flex-wrap items-center gap-3 p-3 bg-surface-50/60 border border-surface-200/60 rounded-xl">
              {annealPhase === "preview" && annealPreview ? (
                <>
                  <p className="text-xs text-gray-900 flex-1">
                    Will <strong>create {annealPreview.create}</strong> PTL row{annealPreview.create === 1 ? "" : "s"} and{" "}
                    <strong>correct {annealPreview.correct}</strong> unpaid drift{annealPreview.correct === 1 ? "" : "s"}.{" "}
                    <span className="text-brand-400">
                      Skipping {annealPreview.skip_paid_drifts} paid drift{annealPreview.skip_paid_drifts === 1 ? "" : "s"} + {annealPreview.skip_orphans} orphan{annealPreview.skip_orphans === 1 ? "" : "s"}.
                    </span>
                  </p>
                  <button onClick={applyAnneal} disabled={annealPhase !== "preview"} className="btn-primary text-xs">
                    Confirm &amp; anneal
                  </button>
                  <button onClick={() => setAnnealPhase("idle")} className="text-xs text-brand-400 hover:text-gray-700">
                    Cancel
                  </button>
                </>
              ) : annealPhase === "applying" ? (
                <p className="text-xs text-brand-400">Annealing…</p>
              ) : (
                <>
                  <p className="text-xs text-gray-900 flex-1">
                    {actionable} discrepanc{actionable === 1 ? "y" : "ies"} can be auto-fixed from User Transactions.
                  </p>
                  <button onClick={previewAnneal} disabled={annealPhase === "previewing"} className="btn-primary text-xs">
                    {annealPhase === "previewing" ? "Checking…" : "Anneal the fixes"}
                  </button>
                </>
              )}
            </div>
          )}

          {annealResult && annealPhase === "done" && (
            <div className="p-3 bg-accent/10 border border-accent/30 rounded-xl">
              <p className="text-xs text-gray-900">
                ✓ Created {annealResult.created} · corrected {annealResult.corrected}
                {annealResult.failed.length > 0 && (
                  <span className="text-red-600"> · {annealResult.failed.length} failed</span>
                )}
                <span className="text-brand-400"> · skipped {annealResult.skipped.paidDrifts} paid + {annealResult.skipped.orphans} orphans</span>
              </p>
              {annealResult.failed.length > 0 && (
                <ul className="mt-1 text-[10px] text-red-600 list-disc pl-4">
                  {annealResult.failed.map((f) => <li key={f.id}>{f.id}: {f.reason}</li>)}
                </ul>
              )}
            </div>
          )}
```

- [ ] **Step 5: Verify build + commit**

```bash
./node_modules/.bin/tsc --noEmit && npm run build
git add src/components/admin/AuditPanel.tsx
git commit -m "feat(audit): Anneal the fixes button with preview/confirm/re-audit"
```

Expected: tsc clean, build success.

- [ ] **Step 6: Manual verification**

Run `npm run dev`, sign in as admin, open the admin page with the audit panel. Click **Trigger UTX / PTX Audit**. With at least one missing/unpaid-drift present:
- The Anneal block shows the actionable count.
- **Anneal the fixes** → preview line ("Will create N… correct M… skipping…").
- **Confirm & anneal** → "Annealing…" → success summary → audit re-runs and the fixed rows are gone.
- Confirm paid drifts and orphans remain listed.

---

## Self-Review

**Spec coverage:**
- UT as source of truth → drift correction sets PTL Amount = UT Amount; missing created from UT. ✓ (Tasks 1, 3, 4)
- Create missing → Task 3/4. ✓
- Correct unpaid drifts → `buildAnnealPlan` + patch in Task 4. ✓
- Skip+report paid drifts & orphans → `buildAnnealPlan` skipped sets + UI summary. ✓ (Tasks 1, 5)
- Preview → confirm → apply → re-audit → Task 5 handlers. ✓
- Button hidden when nothing actionable → `actionable > 0` guard. ✓ (Task 5)
- Per-item partial-failure reporting → `failed[]` in Task 4 + UI list in Task 5. ✓
- Idempotent / dupe-safe → fresh re-derive + TxnID dupe guard in `createPtlRowFromUt`. ✓ (Tasks 3, 4)
- Shared create logic → `createPtlRowFromUt` used by both routes. ✓ (Task 3)
- Tests for `buildAnnealPlan` + mapping → Tasks 1, 2. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code and exact commands. ✓

**Type consistency:** `DriftRow.commission_status` defined in Task 1 and consumed in Tasks 4/5; `AnnealPlan`/`AnnealDeps`/`AnnealError` names consistent across Tasks 1–4; `createPtlRowFromUt(utRecordId, deps)` signature identical in Tasks 3 and 4; client `AnnealSummary`/`AnnealApplyResult` match the route's `summary`/`result` JSON. ✓
