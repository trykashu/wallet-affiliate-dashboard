# Earnings Month Filter + Account Manager → Finance Payout Flow — Design

**Date:** 2026-05-11
**Status:** Design approved, ready for implementation plan
**Approach:** A — one-shot consolidated build

## Problem

`/admin/earnings` is operated by Account Managers (AMs) who don't have financial clearance to initiate ACH transfers. Today the same admin approves earnings, creates payout batches, and executes them via Mercury — a separation-of-duties gap. Additionally:

- AMs can't filter earnings by month, making it hard to scope a payout cycle.
- When a payout completes, the related earnings stay at `approved` forever. The "Paid" earnings status is unreachable.

## Goal

1. **Month filter** on `/admin/earnings` keyed off the underlying transaction date.
2. **Two-tier workflow**: AM submits a batch for the month → Finance reviews → Finance executes the ACH → payout completes → linked earnings flip to `paid`.
3. **Role separation**: `FINANCE_EMAILS` env var distinguishes Finance (grey@kashupay.com, miles@kashupay.com) from regular AMs; UI gates surface this gracefully.

## Architecture

### Roles

| Role | Definition | Capabilities |
|---|---|---|
| Account Manager (AM) | `ADMIN_EMAILS` | Approve earnings (existing, contract-gated). Prepare a payment batch from filtered earnings. Submit batch to Finance. |
| Finance | `FINANCE_EMAILS` (subset of admins) | Approve / reject submitted batches. Execute via Mercury. Mark payouts as completed/failed. |

Convention: every email in `FINANCE_EMAILS` MUST also be in `ADMIN_EMAILS`. `isFinanceEmail()` is a new helper; `isAdminEmail()` stays unchanged.

### Payout state machine (extended)

```
[earnings:pending → earnings:approved  ─ AM approves (contract-gated, PR #2)]
        │
        ▼
[AM creates batch from filtered earnings]
        │
        ▼
[payouts:pending_review]   ← NEW
        │  Finance approves                Finance rejects
        ▼                                   │
[payouts:requested]                         ▼
        │  Finance executes (Mercury)   [payouts:rejected]   ← NEW terminal
        ▼                                   │
[payouts:processing]                        │ earnings.payout_id cleared
        │                                    │ earnings stay 'approved', re-batchable
        ▼
[payouts:completed | failed]
        │  side effect on completed (NEW):
        ▼
[earnings:paid]   ← all earnings WHERE payout_id = this payout
```

### Why state on `payouts`, not a new `payment_batches` table

Keeps blast radius small. A "batch" is operationally defined as the set of payouts that share a `batch_id` (new column). The source of truth stays in the existing `payouts` rows. New columns capture submission and review metadata without a join.

## Data model

### Migration `020_payment_batches.sql`

```sql
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

### TypeScript updates (`src/types/database.ts`)

- `PayoutStatus` union: add `"pending_review"` and `"rejected"`.
- `Payout`: add the 6 new fields (`batch_id`, `submitted_by`, `submitted_at`, `reviewed_by`, `reviewed_at`, `review_notes`).
- `Earning`: add `payout_id: string | null`.

### State transitions are app-enforced

No DB triggers (matches project convention). All transitions live in their respective route handlers; defense in depth via re-validation at each step.

## Server-side routes

### Modify: `POST /api/admin/payouts/create-batch`

- Body: `{ earning_ids: string[], period: string, notes?: string }` (currently takes no body and auto-selects all approved earnings; this becomes an explicit AM action).
- Gate: `isAdminEmail`.
- Validate every earning: exists, `status='approved'`, `payout_id IS NULL`, affiliate has `agreement_status IN ('Completed','signed')` (re-run the PR #2 contract gate as defense in depth), affiliate has a verified `payout_account`.
- Generate `batch_id = crypto.randomUUID()`.
- Group earnings by affiliate, sum amounts.
- Per affiliate: insert one payout row with `status='pending_review'`, `batch_id`, `period`, `submitted_by=user.email`, `submitted_at=now()`.
- Update each earning: set `payout_id` (no status change yet).
- Audit log: `admin.batch_submit`.
- Returns `{ batch_id, payout_count, total_amount, skipped: [{ earning_id, reason }] }`.

### New: `POST /api/admin/payouts/approve-batch`

- Body: `{ batch_id: string, notes?: string }`.
- Gate: `isFinanceEmail`.
- Update payouts WHERE `batch_id = X AND status='pending_review'` → `status='requested'`, `reviewed_by`, `reviewed_at`, `review_notes`.
- Audit: `admin.batch_approve`.

### New: `POST /api/admin/payouts/reject-batch`

- Body: `{ batch_id: string, notes: string }` (notes required).
- Gate: `isFinanceEmail`.
- Update payouts: `status='rejected'`, `reviewed_*`.
- Clear `earnings.payout_id` for all earnings linked to this batch's payouts (so they're re-batchable).
- Audit: `admin.batch_reject`.

### Modify: `POST /api/admin/payouts/execute-batch`

- Add `isFinanceEmail` gate (was `isAdminEmail`).
- Optional body: `{ batch_id?: string }` — if set, executes only payouts in that batch with `status='requested'`. If omitted, retains current behavior of executing all `requested`.
- Rest unchanged (Mercury call, transitions to `processing`).
- Audit: `admin.batch_execute`.

### Modify: `POST /api/admin/payouts/update-status`

- Add `isFinanceEmail` gate (tightened from admin).
- On flip to `completed`:
  - Existing: notify affiliate.
  - **NEW**: `UPDATE earnings SET status='paid' WHERE payout_id = <this payout> AND status='approved'`.
  - Audit metadata includes `earnings_marked_paid` count.

### New: `isFinanceEmail` helper (`src/lib/admin.ts`)

```ts
export function isFinanceEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const finance = (process.env.FINANCE_EMAILS ?? "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return finance.includes(email.toLowerCase());
}
```

## UI

### `/admin/earnings` — month filter + submit-for-review

**Month filter row** above the existing status filter:
- `<select>` populated server-side from distinct months in joined `transactions.transaction_date`.
- Default: current month.
- Special options: "All time", "No transaction date" (rare orphans).

**Column change**: rename "Date" → "Tx Date" and source from `transaction_date` instead of `earnings.created_at`. The diagnosis already joins `transaction_ref → transactions`; we now display that joined date.

**New action**: "Submit for payout review" button (next to existing "Approve Selected").
- Visible to AMs; disabled with tooltip for Finance-only users (rare in practice since Finance ⊆ admins; only matters if a finance-only account is created later).
- Click → slide-over drawer:
  - Period field (defaults to selected month, e.g. `2026-04`).
  - Optional notes textarea (max 500 chars).
  - Preview table grouped by affiliate: name, earnings count, sum, payout account status. Affiliates missing a verified payout account are highlighted and excluded.
  - Total + "Send to Finance" button → calls `create-batch`.
- After submission, the drawer closes, toast confirms, table refreshes. The submitted earnings now show a "In batch: 2026-04" pill in their Status column (computed from `payout_id IS NOT NULL`).

### `/admin/payouts` — Finance review screen

Expanded from current minimal page.

**Section 1: Awaiting Finance review** (only renders if any `pending_review` batches exist)
- Card per `batch_id`. Header: period, submitted_by, submitted_at, total amount, payout count.
- Inner table: affiliate name, amount, payout account, AM's notes.
- For Finance: **Approve batch** button (flips to `requested`), **Reject batch** button (opens modal requiring notes).
- For AMs: read-only view of their own submissions; buttons disabled with tooltip "Finance team only".

**Section 2: Ready to execute** (Finance only)
- Payouts in `status='requested'`, grouped by batch.
- **Execute via Mercury** button per batch → calls `execute-batch` with `batch_id`.

**Section 3: History**
- Filterable list of payouts: `completed`, `failed`, `rejected`, plus a "Legacy" filter for pre-feature payouts (`batch_id IS NULL`).
- Filters: status, period (month picker).

### Sidebar badge

`src/app/admin/layout.tsx` — add a numeric badge next to "Payouts" showing count of distinct `batch_id` values in `pending_review`. Server-fetched in the layout, passed through `AppSidebar` props. Visible to all admins so AMs can see their submitted batches mid-flight.

## Auth & role enforcement

### `FINANCE_EMAILS` setup

- `.env.local`, `.env.local.example`: `FINANCE_EMAILS=grey@kashupay.com,miles@kashupay.com`
- Vercel preview + prod: same value
- Document in CLAUDE.md §9

### Defense-in-depth gate matrix

| Surface | Gate |
|---|---|
| `/admin/*` page-level | `isAdminEmail` (existing) |
| `submit batch` (create-batch route) | `isAdminEmail` |
| `approve batch` route | `isFinanceEmail` |
| `reject batch` route | `isFinanceEmail` |
| `execute batch` route | `isFinanceEmail` (tightened) |
| `update payout status` route | `isFinanceEmail` (tightened) |
| Mark-paid side effect on earnings | runs inside `update-status` |

### UI gating

- AMs see Finance buttons disabled with tooltip ("Finance team only"). Cleaner than hiding — makes the workflow visible without making it actionable.
- Finance users see everything AMs see plus approve/reject/execute actions.

### Audit log

Every state transition writes to `security_audit_logs`:
- `admin.batch_submit` — `{ batch_id, period, payout_count, total_amount }`
- `admin.batch_approve` — `{ batch_id, count }`
- `admin.batch_reject` — `{ batch_id, count, notes }`
- `admin.batch_execute` — `{ batch_id, payout_ids }`
- `admin.payout_complete` — `{ payout_id, earnings_marked_paid }`

Full chain of custody for every payout cycle.

## Testing & rollout

### Pre-deploy verification

- `npx tsc --noEmit` clean
- `npm run build` clean
- Manual smoke on `npm run dev`:
  - AM at `/admin/earnings`: filter to April 2026, select 2 approved earnings, submit batch with notes.
  - AM at `/admin/payouts`: see batch in "Awaiting Finance" (read-only).
  - Finance at `/admin/payouts`: approve → flips to `requested`. Execute → Mercury call (dry-run in dev).
  - Manually `update-status` a payout to `completed`: linked earnings flip to `paid`.
  - Sidebar badge correctly reflects `pending_review` count.
  - Reject flow: submit → Finance rejects with notes → `earnings.payout_id` cleared, status stays `approved`, batch_id rows show `rejected`.

### Data verification (post-merge)

```sql
-- After approving + executing a batch:
select e.id, e.status, e.payout_id, p.status as payout_status, p.batch_id, p.period
from earnings e
left join payouts p on p.id = e.payout_id
where p.batch_id = '<batch_id>';
-- Expect: e.status='approved' until payout flips to completed, then 'paid'.
```

### Rollout sequence

1. **Env vars**: set `FINANCE_EMAILS` in Vercel preview + prod **before** merging the feature PR.
2. **Migration**: run `020_payment_batches.sql` in Supabase SQL editor; verify the CHECK constraint accepts new values via a no-op `select` against `payouts.status`.
3. **Feature PR**: routes + UI + role-gating + sidebar badge. Single deploy flips the workflow on.

No feature flag — gates are role-based and any new value is opt-in (AM has to actively use "Submit for review"). Legacy payouts with `batch_id IS NULL` continue to work via the existing execute path.

## Risks

- **AM scope mismatch**: if AM filters April but only checks 8/10 boxes, the other 2 earnings stay `approved` with `payout_id=null`. Visible in next month's view. **Intentional** — AM controls scope.
- **Race: concurrent batch submissions overlap**: prevented by `earnings.payout_id` being set in create-batch. The second submission either sees `payout_id IS NOT NULL` (skip with reason in response) or rejects the explicit ID. Server validates atomically.
- **Pre-feature payouts**: existing rows get `batch_id=NULL`. The Finance UI shows them in a "Legacy" section. They flow through `execute-batch` and `update-status` as before. The mark-paid loop only fires for rows with `payout_id` set, so legacy payouts don't accidentally mark old earnings paid.
- **Mercury webhook reliability**: the mark-paid loop depends on `update-status` being called with `completed`. If the Mercury webhook never fires, payouts stay `processing` and earnings stay `approved`. Existing manual `update-status` route remains the fallback for ops.

## Decisions captured (from brainstorm)

| Question | Decision |
|---|---|
| Month filter basis | Transaction date (joined via `transaction_ref → transactions.transaction_date`) |
| Role model | `FINANCE_EMAILS` env var (parallel to `ADMIN_EMAILS`) — emails: grey@kashupay.com, miles@kashupay.com |
| Batch artifact | Extend `payouts` with `batch_id` + status transitions (no new table) |
| Loop closure | `payout_id` FK on earnings + bulk update on payout completion |
| Notification | UI badge in admin sidebar (no email/Slack for v1) |
| Approach | A — one-shot consolidated build |
