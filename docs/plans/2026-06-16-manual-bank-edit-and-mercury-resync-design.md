# Design: Manual bank-detail editing (admin + affiliate) with safe Mercury re-sync

**Date:** 2026-06-16
**Status:** Approved (brainstorming) → ready for implementation plan

## Context / problem

Admins need a way to **manually update an affiliate's bank details**, and affiliates need a
**self-service button** in their portal to update their own. Today:

- The only affiliate-facing write path is `POST /api/payouts/mercury-account`
  ([route](../../src/app/api/payouts/mercury-account/route.ts)) via
  [`BankAccountForm`](../../src/components/dashboard/BankAccountForm.tsx) — it collects
  name/routing/account only (no address; account_type not persisted) and sets
  `is_verified=true` immediately.
- Admin has no direct "edit these bank numbers" form — only CSV upload, PDF/PandaDoc extraction,
  and an address-only endpoint.
- **Mercury hazard:** the Mercury recipient id lives in `payout_accounts.provider_id`, is created
  **lazily at payout time** and **reused** ([execute-batch](../../src/app/api/admin/payouts/execute-batch/route.ts),
  [mercury.ts `getOrCreateRecipient`](../../src/lib/mercury.ts)). The current self-service save path
  does **not** clear `provider_id`, so editing bank details after a recipient exists would keep
  paying the **old** account. Mercury's client here is **create-only with dedupe** — there is no
  update-recipient endpoint.

## Goal

Two safe edit surfaces (admin + affiliate self-service) that keep Mercury correct without adding any
synchronous Mercury API call or touching the payout/finance flow.

## Core principle — Mercury safety

**Any bank-detail change clears `payout_accounts.provider_id`.** The next payout re-binds to the
corrected details through the existing `getOrCreateRecipient` dedupe (find-or-create by
routing+account). Consequences:

- No synchronous Mercury call is added; `execute-batch`, `isFinanceEmail` gate, and payout limits
  (`max_single_payout` / `max_daily_aggregate` / `max_batch_size`) are **untouched**.
- The stale Mercury recipient is orphaned (never paid again) — harmless.
- Rejected alternative: eager Mercury update/recreate at save time — Mercury has no update endpoint,
  needs address present, and injects Mercury failure into the save UX. Higher risk, contradicts
  "don't screw with Mercury."

## Components

### 1. Shared save helper — `src/lib/payouts/save-bank-details.ts`
`saveBankDetails(svc, { affiliateId, accountHolderName, routingNumber, accountNumber?, address?, markVerified, source, changedBy })`
- Loads the existing `provider='mercury'` account (id, routing, `metadata.full_account_number`,
  address, provider_id).
- `accountNumber` omitted/blank ⇒ keep existing (admin edit convenience; avoids forcing re-entry).
- Computes `bankChanged` = routing OR account OR any address field differs.
- Upserts `payout_accounts` in the established metadata shape (`full_account_number`,
  `routing_number`, `source`), address columns, `is_default=true`, `is_verified=markVerified`,
  and **`provider_id = null` when `bankChanged`**.
- Returns `{ last4, bankChanged }`. Pure helper; both routes use it. Caller owns audit logging +
  affiliate-flag side effects.

### 2. Admin path
- New `POST /api/admin/affiliates/[id]/bank` — `isAdminEmail` gate, **service client**. Zod-validate
  (name, routing `^\d{9}$`, account `^\d{4,17}$` or blank, US address). Calls
  `saveBankDetails(markVerified: true, source: "admin_manual", changedBy: admin email)`; clears any
  `bank_review_reasons` review note; `logSecurityEvent("bank_data_updated", {changed_by:"admin:<email>"})`.
- UI: **"Edit bank" row action on the admin Affiliates page** ([AffiliateTable](../../src/components/admin/AffiliateTable.tsx))
  opening a dark drawer (fork the `AddressModal` pattern) with name / routing / account / address,
  prefilled (account shown as `•••• last4`; blank = keep). For a `is_verified:false` (pending) row,
  the same save is the admin "verify".

### 3. Affiliate path
- Extend `POST /api/payouts/mercury-account` to accept optional address fields and route through the
  helper with `markVerified: false`, `source: "self_service"`, `changedBy: "self"`. Adds a
  review note so it surfaces for admin. Does NOT set `is_verified=true`.
- UI: extend [`BankAccountForm`](../../src/components/dashboard/BankAccountForm.tsx) with address
  fields (prefilled from what's on file) and a **"pending verification"** confirmation state.

### 4. Surfacing
- A self-edit appears on the admin Affiliates page as the amber **"Review"** bank chip via a
  `bank_review_reasons` note ("Affiliate updated bank details — pending verification"), so admins
  know to confirm. (`is_verified=false` also keeps it out of payouts until confirmed.)

## Known limitation (documented, out of scope)
A **pure address-only** change for an affiliate who already has a Mercury recipient won't propagate
to Mercury — `getOrCreateRecipient` re-finds the same recipient by routing+account and reuses it
(address not re-sent). Routing/account changes fully re-bind. A true Mercury recipient-update is a
separate feature (Mercury client has no update endpoint today).

## Testing
- Unit-test `saveBankDetails`: `provider_id` cleared on bank change; preserved when nothing changed;
  `is_verified` reflects `markVerified`; blank account keeps existing.
- Endpoint auth: admin route rejects non-admins; affiliate route scoped to own account; affiliate
  save yields `is_verified=false` + review note.
- Manual end-to-end: admin edit → verified + payable; affiliate edit → pending → admin verify;
  confirm `execute-batch` re-binds the Mercury recipient after a routing/account change.

## Out of scope (YAGNI)
Live Mercury recipient update/delete; account_type persistence (Mercury hardcodes
`businessChecking`); multi-account management.
