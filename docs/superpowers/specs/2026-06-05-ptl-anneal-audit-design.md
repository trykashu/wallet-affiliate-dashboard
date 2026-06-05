# PTL Audit — "Anneal the Fixes" — Design

**Date:** 2026-06-05
**Status:** Approved (design)
**Area:** Admin → Partner Transaction Log (PTL) ↔ User Transactions (UT) audit

---

## Problem

The admin **PTL ↔ UT Audit** ([AuditPanel.tsx](../../../src/components/admin/AuditPanel.tsx),
[audit-ptl/route.ts](../../../src/app/api/admin/audit-ptl/route.ts)) cross-checks the
Partner Transaction Log (PTL — partner commissions, Airtable) against User Transactions
(UT — Airtable), keyed on **Transaction ID**, and reports three discrepancy types per month:

- **orphans** — a PTL row whose Transaction ID has no matching UT row.
- **drifts** — a PTL row whose `Amount` differs from the matching UT `Amount`.
- **missing** — a UT "Transfer In" with a referrer but no PTL row (affiliate under-paid).

Today only **missing** rows are fixable, one at a time, via a per-row "Create in PTL" button.
Orphans and drifts are display-only. There is no bulk remediation.

## Goal

1. Treat **User Transactions (UT) as the source of truth** — PTL should conform to UT.
2. After a report is generated, add a single **"Anneal the fixes"** button that applies the
   safe corrections in bulk, behind a preview/confirm step, then re-runs the audit.

## Decisions (from brainstorming)

| Discrepancy | Anneal behavior |
|---|---|
| **missing** | **Create** a PTL row from the UT row (all of them). |
| **drift, unpaid** (`Commission Status` = `Owed` or blank) | **Correct** PTL `Amount` = UT `Amount`. |
| **drift, paid** (any non-`Owed` status) | **Skip + report** — never rewrite a historical/paid payout automatically. |
| **orphans** | **Skip + report** — never auto-delete partner commission rows (may be legit manual entries/refunds). |

**Safety flow:** Preview → Confirm → Apply → auto re-audit. The button is hidden/disabled
when nothing is actionable (0 missing and 0 unpaid drifts).

**Source-of-truth note:** UT is authoritative for amounts and for whether a commission should
exist. Anneal only ever makes PTL *match* UT for the safe cases; it never deletes and never
edits paid rows.

## Approach (chosen: server-authoritative plan/apply)

A single new endpoint computes and applies the plan server-side, always from fresh data:

`POST /api/admin/audit-ptl/anneal` with body `{ dryRun: boolean }`
- Admin-gated (`isAdminEmail`).
- Re-fetches PTL + UT from Airtable, runs the existing audit, and calls `buildAnnealPlan`.
- `dryRun: true` → returns the plan (counts + row lists) **without writing**. Used for the preview.
- `dryRun: false` → re-derives the plan from fresh data and **applies** it, returning per-item results.

Rationale: the anneal rules live in one place on the server; apply always acts on fresh data
(can't apply a stale client list or double-create); the existing TxnID dupe guard carries over.
Cost is a couple extra Airtable reads per click — acceptable for an admin action.

## Components & files

**New**
- `src/app/api/admin/audit-ptl/anneal/route.ts` — the `POST { dryRun }` endpoint above.
- `src/lib/audit/ptl-anneal.ts` — Airtable mutation helpers:
  - `createPtlRowFromUt(utRecord, deps)` — extracted from the current create-row route
    (referrer→affiliate resolution, field mapping, TxnID dupe check, `typecast` create).
  - `correctPtlAmount(ptlId, utAmount, deps)` — PATCH a PTL row's `Amount`.
  - `deps` carries `{ affiliateBase, launchBase, pat }` so the helpers are unit-testable.

**Changed**
- `src/lib/audit/ptl-audit.ts`
  - Extend `DriftRow` with `commission_status: string` (so paid-vs-unpaid is known).
  - Add pure `buildAnnealPlan(months: MonthAudit[]): AnnealPlan` where
    `AnnealPlan = { toCreate: MissingRow[]; toCorrect: DriftRow[]; skipped: { paidDrifts: DriftRow[]; orphans: OrphanRow[] } }`.
    `unpaid` = `commission_status` is `"Owed"` or empty; everything else is paid/skip.
- `src/app/api/admin/audit-ptl/create-row/route.ts` — refactor to call the shared
  `createPtlRowFromUt` helper (identical behavior, no duplication).
- `src/components/admin/AuditPanel.tsx` — add the **Anneal** button, preview/confirm UI,
  results summary, and auto re-audit. The per-row "Create in PTL" button stays as a manual
  escape hatch.

## Data flow

1. Admin clicks **Trigger UTX / PTX Audit** → existing `GET /api/admin/audit-ptl` → report
   (drifts now carry `commission_status`).
2. Admin clicks **Anneal the fixes** → `POST /anneal { dryRun: true }` → preview summary:
   *"Create N rows · correct M unpaid drifts · skip X paid drifts + Y orphans."*
3. Admin confirms → `POST /anneal { dryRun: false }` → applies; returns
   `{ created, corrected, failed: [{ id, reason }], skipped: { paidDrifts, orphans } }`.
4. Panel auto re-runs the audit so the now-clean state and any failures are visible.

## Error handling

- Per-item try/catch; **partial success is acceptable** — one failing row never blocks the rest.
- **Idempotent:** apply re-derives from fresh PTL+UT, so re-clicking after a partial failure
  only acts on what is still broken; the TxnID dupe guard prevents double-creates.
- Admin-gated; `500` if Airtable env (`AIRTABLE_AFFILIATE_BASE` / `AIRTABLE_LAUNCH_BASE` /
  `AIRTABLE_PAT`) is not configured.
- Airtable writes: respect the 10-records-per-create limit (batch creates), modest sequential
  concurrency for PATCHes to avoid rate limits.

## Testing

- Pure unit tests on `buildAnnealPlan`: a `MonthAudit[]` fixture with a mix of orphans,
  paid + unpaid drifts, and missing rows asserts:
  - `toCreate` = exactly the missing rows.
  - `toCorrect` = exactly the unpaid drifts.
  - `skipped.paidDrifts` = the paid drifts; `skipped.orphans` = all orphans.
  - No paid drift or orphan ever appears in `toCreate`/`toCorrect`.
- Drift classification: `Owed`/blank → correctable; `Paid` (and any other status) → skipped.
- Confirm the repo's test setup during planning; if none exists, note the lightest way to
  cover the pure function (the plan logic is pure and isolated by design for exactly this).

## Out of scope (YAGNI)

- Auto-deleting or auto-flagging orphans.
- Rewriting paid commissions.
- Reconciling whitelabel (Payova) or test (`1ATEST`) referrers — already excluded by the audit.
- Any change to how UT or PTL are populated upstream.
