# Design: Delegate Access (affiliate invites teammates)

**Date:** 2026-07-13
**Status:** Approved (brainstorming) → ready for implementation plan
**Ported from:** MRP Dashboard `partner_delegates` feature (adapted to the affiliate domain)

## Context / problem

Affiliates want to grant a teammate/VA access to their affiliate dashboard. Today
`get_my_affiliate_id()` is a strict 1:1 `auth.uid() → affiliates.id` map and RLS everywhere
keys off it, so a second person (a separate `auth.users` row) has no way to see an affiliate's
data. MRP solved the equivalent problem with a `partner_delegates` table + a service-client
"act-as" branch in its context helper; we mirror that.

## Permission model (from brainstorming)

Default delegate sees **referrals + conversions only, no financial/payout info**, and it is
**customizable per delegate**. Concretely:

- **Always visible** (base): Dashboard funnel/conversions + counts, Users (referrals), Tools
  (referral links/QR), Support — with all `$` figures scrubbed.
- **Opt-in toggle `can_view_earnings`** (default OFF): unlocks the Earnings page + `$` amounts
  on the dashboard/leaderboard.
- **Opt-in toggle `can_view_payouts`** (default OFF): unlocks the Payouts page **read-only**
  (schedule + history, bank shown masked). No request-payout button, no bank edit.
- **Always owner-only** (delegates blocked regardless of flags): request payout, edit bank
  details, and delegate management (invite/edit/revoke).

## Architecture decision — resolution mechanism

**Chosen: service-client "act-as" in `getAffiliateContext()`** (mirrors the existing view-as
branch and MRP). Rejected: teaching `get_my_affiliate_id()` to return the owner's id for
delegates — it mutates the central RLS chokepoint every policy depends on, makes a delegate
indistinguishable from the owner at the DB layer (can't scrub earnings per-permission), and is
the exact approach MRP abandoned (their migration 039) for security.

## Components

### 1. Data model — `supabase/migrations/025_affiliate_delegates.sql` (DONE)
`affiliate_delegates`: `id`, `affiliate_id → affiliates(id) ON DELETE CASCADE` (the OWNER),
`delegate_email`, `delegate_name`, `delegate_user_id → auth.users(id)` (backfilled on first
login), `has_password`, `can_view_earnings` (default false), `can_view_payouts` (default false),
`invited_by`, `invited_at`, `accepted_at`, timestamps. Functional unique index on
`lower(trim(delegate_email))` = v1 rule "one email = one affiliate". RLS on with an owner-only
SELECT policy; all writes via the service client. `accept_delegate_invite()` security-definer RPC
stamps `delegate_user_id`/`accepted_at` on first login by exact `lower(trim())` email match
(idempotent, no `ilike` wildcard — avoids the invite-hijack MRP flagged).

### 2. Resolution — `src/lib/affiliate-context.ts`
Add a 4th branch after the direct-affiliate miss: look up `affiliate_delegates` by
`delegate_user_id`; on first login call `accept_delegate_invite()` (via the **anon** client, so
`auth.uid()`/`auth.jwt()` resolve) then re-read via the service client; resolve the owner
affiliate with the service client. Extend `AffiliateContext` with `isDelegate`, `delegateEmail`,
`delegatePermissions {canViewEarnings, canViewPayouts}`, `delegateOwnerName`. Mechanically
identical to view-as (service client `db` + explicit `affiliate_id` scoping), already proven
across the dashboard.

### 3. Integration hazards (must handle)
- **`on_auth_user_created` email-match trigger** could mis-link a delegate whose email collides
  with an affiliate row. Guard: the invite route **rejects any email already belonging to an
  affiliate** ("this email is an affiliate account"). Also cleanly enforces the v1 limitation
  that an affiliate can't also be someone's delegate.
- **`src/proxy.ts` password gate + admin/affiliate-less redirect** assume `auth.uid()` = an
  owner. Fix: proxy also checks `affiliate_delegates` by `user_id` → allows `/dashboard`, skips
  the admin redirect, gates on `delegate.has_password`. `setup-password` and `post-login` get a
  parallel delegate branch so a delegate isn't stranded on "Account Being Set Up" / a
  `/setup-password` loop.

### 4. Permission enforcement
- `src/lib/dashboard/delegate-scrub.ts` (mirrors MRP `scrub.ts`): nulls earnings/payout `$`
  server-side before data reaches the client when the flag is off.
- Nav (`src/app/dashboard/layout.tsx`): build `AFFILIATE_NAV` conditionally — drop Earnings /
  Payouts unless the matching flag is on.
- Route gates: `/api/payouts/*` (request + `mercury-account` bank edit) and all
  `/api/dashboard/delegates*` mutations return **403 for delegates**.

### 5. Invite / accept flow (Supabase 24h — chosen)
`POST/GET /api/dashboard/delegates`, `PATCH/DELETE /api/dashboard/delegates/[id]` — owner-only.
Invite = insert row → `svc.auth.admin.inviteUserByEmail(email, { data:{role:"delegate",
affiliate_id}, redirectTo: .../auth/confirm })`; stamp `delegate_user_id` from the returned user
when available; roll back the row on email failure; treat `email_exists` as non-fatal. Accept is
inline on first authenticated load via the RPC (no separate accept page), same as MRP.

### 6. UI
- `DelegateAccessCard` on the **Profile page** (owner view): invite form (name, email, 2
  permission checkboxes), delegate list with Active/Pending badges + per-row edit/revoke.
- `DelegateBanner`: sticky "You're viewing **{Owner}**'s account as a delegate" for delegates,
  in the dashboard layout.

## Testing
- **Unit:** `accept_delegate_invite` email normalization; scrub nulls the right fields per flags;
  invite collision + self-invite guards.
- **Endpoint auth:** delegates get 403 on all mutations; list scoped to owner; affiliate-email
  collision rejected.
- **Resolution:** delegate resolves to owner affiliate with both flags OFF by default.
- **Manual E2E:** invite → accept → set password → land on owner dashboard with `$` hidden →
  toggle earnings on → figures appear → revoke → access gone.

## Out of scope (YAGNI)
Admin-side delegate management UI; one delegate serving multiple affiliates; granular per-row
permissions beyond the two view flags; non-expiring invites (chose Supabase 24h).
