# Delegate Access Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task.

**Goal:** Let an affiliate invite teammates ("delegates") who log in with their own auth account and see the affiliate's dashboard, with two opt-in visibility flags (earnings, payouts) that default OFF and money-movement always owner-only.

**Architecture:** A delegate is a separate `auth.users` row that resolves to the OWNER's affiliate via the **service client** in a shared `resolveDelegateContext()` helper — NOT via RLS (`get_my_affiliate_id()` stays a strict 1:1 map). First-login acceptance is stamped by the `accept_delegate_invite()` RPC. Permissions are enforced server-side via nav-hiding, page-level guards on `/dashboard/earnings` + `/dashboard/payouts`, and 403s on payout mutation routes. Invites reuse Supabase `inviteUserByEmail` (24h).

**Tech Stack:** Next.js 15 App Router, Supabase (SSR + service client), TypeScript, Zod, Tailwind, `node:test` + `node:assert/strict` for unit tests (`npm test` → `npx tsx --test 'src/**/*.test.ts'`).

**Design doc:** `docs/plans/2026-07-13-delegate-access-design.md`

**Key conventions to follow (from CLAUDE.md):**
- Light/teal theme for affiliate-facing UI (`text-gray-900`, `text-brand-400` for muted, `.card`, `.btn-primary`, `.btn-accent`, `.badge-accent`, `.badge-amber`, `.input-base`). NEVER `text-white` in dashboard content, NEVER `text-gray-500`.
- Use `fmt.*` for all numbers/dates. Use `supabase as any` cast pattern already in the codebase.
- Before every push: `npx tsc --noEmit` AND `npm run build` must both pass with zero errors.

---

## Task 0: Verify the migration ran

**Files:** `supabase/migrations/025_affiliate_delegates.sql` (already created + committed)

**Step 1:** Confirm with the user that the SQL from the chat (table + `accept_delegate_invite()` RPC + RLS policy) ran clean in the Supabase SQL editor. If they hit `policy already exists`, have them prepend `DROP POLICY IF EXISTS "affiliate_delegates_select_own" ON affiliate_delegates;`.

**Step 2:** Sanity-check existence via the read-only probe pattern (service-role script), confirming the table + RPC exist. Do NOT proceed to Task 4+ until confirmed.

---

## Task 1: Extend types + AffiliateContext

**Files:**
- Modify: `src/types/database.ts` (add interfaces near the other row types)
- Modify: `src/lib/affiliate-context.ts:33-41` (extend interface) and the three return sites (`:102-109`, `:144-151`, `:164-171`)

**Step 1: Add types to `src/types/database.ts`** (append after the `Affiliate` interface block):

```typescript
export interface AffiliateDelegate {
  id:                string;
  affiliate_id:      string;
  delegate_email:    string;
  delegate_name:     string;
  delegate_user_id:  string | null;
  has_password:      boolean;
  can_view_earnings: boolean;
  can_view_payouts:  boolean;
  invited_by:        string | null;
  invited_at:        string;
  accepted_at:       string | null;
  created_at:        string;
  updated_at:        string;
}

export interface DelegatePermissions {
  canViewEarnings: boolean;
  canViewPayouts:  boolean;
}
```

**Step 2: Extend the `AffiliateContext` interface** (`src/lib/affiliate-context.ts:33-41`) — add after `brand`:

```typescript
  /** True when the effective session is a delegate acting on the owner's account. */
  isDelegate:          boolean;
  /** The delegate's own email (null unless isDelegate). */
  delegateEmail:       string | null;
  /** The owner affiliate's display name, for the delegate banner (null unless isDelegate). */
  delegateOwnerName:   string | null;
  /** What the delegate may see. For a real owner: both true (no restriction). */
  delegatePermissions: DelegatePermissions;
```

Import `DelegatePermissions` from `@/types/database` at the top.

**Step 3:** Add these defaults to ALL THREE existing return statements (view-as `:102`, preview `:144`, normal `:164`) so they keep compiling — a real owner/admin is unrestricted:

```typescript
    isDelegate:          false,
    delegateEmail:       null,
    delegateOwnerName:   null,
    delegatePermissions: { canViewEarnings: true, canViewPayouts: true },
```

**Step 4:** `npx tsc --noEmit` → expect zero errors (nothing consumes the new fields yet).

**Step 5: Commit**
```bash
git add src/types/database.ts src/lib/affiliate-context.ts
git commit -m "feat(delegates): extend AffiliateContext + delegate types"
```

---

## Task 2: Pure invite-validation helper (TDD)

Extracts the email-normalization + guard logic so it's unit-testable without DB.

**Files:**
- Create: `src/lib/delegates/validate-invite.ts`
- Test: `src/lib/delegates/validate-invite.test.ts`

**Step 1: Write the failing test** (`validate-invite.test.ts`):

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, checkInviteAllowed } from "./validate-invite";

test("normalizeEmail lowercases and trims", () => {
  assert.equal(normalizeEmail("  Foo@Bar.COM "), "foo@bar.com");
});

test("rejects inviting the owner's own email (self-invite)", () => {
  const r = checkInviteAllowed({
    email: "owner@x.com",
    ownerEmail: "Owner@X.com",
    emailIsAffiliate: false,
  });
  assert.equal(r.ok, false);
  assert.match(r.error!, /your own/i);
});

test("rejects an email that already belongs to an affiliate", () => {
  const r = checkInviteAllowed({
    email: "someone@x.com",
    ownerEmail: "owner@x.com",
    emailIsAffiliate: true,
  });
  assert.equal(r.ok, false);
  assert.match(r.error!, /affiliate account/i);
});

test("allows a fresh external email", () => {
  const r = checkInviteAllowed({
    email: "teammate@x.com",
    ownerEmail: "owner@x.com",
    emailIsAffiliate: false,
  });
  assert.equal(r.ok, true);
  assert.equal(r.error, undefined);
});
```

**Step 2: Run to verify it fails**
Run: `npx tsx --test src/lib/delegates/validate-invite.test.ts`
Expected: FAIL (module not found).

**Step 3: Implement** (`validate-invite.ts`):

```typescript
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface InviteCheckInput {
  email: string;            // already normalized OR raw — we normalize internally
  ownerEmail: string;       // the inviting affiliate's email
  emailIsAffiliate: boolean; // true if this email matches any affiliates.email
}

export interface InviteCheckResult {
  ok: boolean;
  error?: string;
}

export function checkInviteAllowed(input: InviteCheckInput): InviteCheckResult {
  const email = normalizeEmail(input.email);
  if (email === normalizeEmail(input.ownerEmail)) {
    return { ok: false, error: "You can't invite your own email as a delegate." };
  }
  if (input.emailIsAffiliate) {
    return {
      ok: false,
      error: "This email belongs to an affiliate account and can't be a delegate.",
    };
  }
  return { ok: true };
}
```

**Step 4: Run to verify pass**
Run: `npx tsx --test src/lib/delegates/validate-invite.test.ts` → Expected: PASS (4 tests).

**Step 5: Commit**
```bash
git add src/lib/delegates/validate-invite.ts src/lib/delegates/validate-invite.test.ts
git commit -m "feat(delegates): pure invite-validation helper + tests"
```

---

## Task 3: Pure nav-gating helper (TDD)

**Files:**
- Create: `src/lib/delegates/delegate-nav.ts`
- Test: `src/lib/delegates/delegate-nav.test.ts`

**Step 1: Write the failing test:**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterNavForDelegate } from "./delegate-nav";

const NAV = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Users",     href: "/dashboard/users" },
  { label: "Earnings",  href: "/dashboard/earnings" },
  { label: "Payouts",   href: "/dashboard/payouts" },
  { label: "Tools",     href: "/dashboard/tools" },
  { label: "Support",   href: "/dashboard/support" },
];

test("owner (not delegate) keeps all nav", () => {
  const out = filterNavForDelegate(NAV, { isDelegate: false, canViewEarnings: false, canViewPayouts: false });
  assert.equal(out.length, 6);
});

test("delegate with no flags loses Earnings + Payouts", () => {
  const out = filterNavForDelegate(NAV, { isDelegate: true, canViewEarnings: false, canViewPayouts: false });
  const hrefs = out.map((n) => n.href);
  assert.ok(!hrefs.includes("/dashboard/earnings"));
  assert.ok(!hrefs.includes("/dashboard/payouts"));
  assert.ok(hrefs.includes("/dashboard/users"));
  assert.ok(hrefs.includes("/dashboard/tools"));
});

test("delegate with earnings flag keeps Earnings but not Payouts", () => {
  const out = filterNavForDelegate(NAV, { isDelegate: true, canViewEarnings: true, canViewPayouts: false });
  const hrefs = out.map((n) => n.href);
  assert.ok(hrefs.includes("/dashboard/earnings"));
  assert.ok(!hrefs.includes("/dashboard/payouts"));
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** (`delegate-nav.ts`):

```typescript
export interface NavGateOpts {
  isDelegate: boolean;
  canViewEarnings: boolean;
  canViewPayouts: boolean;
}

/** Removes Earnings/Payouts nav items a delegate isn't permitted to see. Owners keep everything. */
export function filterNavForDelegate<T extends { href: string }>(
  nav: readonly T[],
  opts: NavGateOpts,
): T[] {
  if (!opts.isDelegate) return [...nav];
  return nav.filter((item) => {
    if (item.href === "/dashboard/earnings") return opts.canViewEarnings;
    if (item.href === "/dashboard/payouts")  return opts.canViewPayouts;
    return true;
  });
}
```

**Step 4: Run → PASS (3 tests).**

**Step 5: Commit**
```bash
git add src/lib/delegates/delegate-nav.ts src/lib/delegates/delegate-nav.test.ts
git commit -m "feat(delegates): pure nav-gating helper + tests"
```

---

## Task 4: Delegate resolution in affiliate-context.ts

Adds a shared `resolveDelegateContext()` helper and a 4th branch in `getAffiliateContext()`.

**Files:**
- Modify: `src/lib/affiliate-context.ts`

**Step 1: Add the shared helper** (after `fetchBrand`, before `getAffiliateContext`). It takes the anon client (for the first-login RPC) + the authed user:

```typescript
import type { Affiliate, WhitelabelBrand, DelegatePermissions } from "@/types/database";

export interface DelegateResolution {
  affiliate:   Affiliate;
  affiliateId: string;
  ownerName:   string;
  delegateEmail: string;
  permissions: DelegatePermissions;
}

/**
 * Resolve a delegate session to the OWNER's affiliate.
 * - Fast path: service-client lookup by delegate_user_id (already accepted).
 * - First login: the row isn't stamped yet, so call accept_delegate_invite()
 *   via the ANON client (it reads auth.uid()/auth.jwt()), then re-read.
 * Returns null if the user is not a delegate.
 */
export async function resolveDelegateContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  anonClient: any,
  userId: string,
): Promise<DelegateResolution | null> {
  const svc = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = svc as any;

  let { data: row } = await s
    .from("affiliate_delegates")
    .select("*")
    .eq("delegate_user_id", userId)
    .maybeSingle();

  if (!row) {
    // First login — stamp via the RPC (uses the caller's own session), then re-read.
    await anonClient.rpc("accept_delegate_invite");
    ({ data: row } = await s
      .from("affiliate_delegates")
      .select("*")
      .eq("delegate_user_id", userId)
      .maybeSingle());
  }

  if (!row) return null;

  const { data: affiliateRaw } = await s
    .from("affiliates")
    .select("*")
    .eq("id", row.affiliate_id)
    .single();
  if (!affiliateRaw) return null;

  const affiliate = affiliateRaw as Affiliate;
  return {
    affiliate,
    affiliateId: affiliate.id,
    ownerName:   affiliate.agent_name,
    delegateEmail: row.delegate_email,
    permissions: {
      canViewEarnings: !!row.can_view_earnings,
      canViewPayouts:  !!row.can_view_payouts,
    },
  };
}
```

**Step 2: Add the delegate branch to `getAffiliateContext()`** — replace the normal-mode block (`:154-172`) so that when the RLS affiliate lookup returns nothing, we try the delegate path before giving up:

```typescript
  // ── Normal mode: use anon client (RLS handles all scoping) ─────────────────
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: affiliateRaw } = await db.from("affiliates").select("*").single();

  if (affiliateRaw) {
    const affiliate = affiliateRaw as Affiliate;
    const brand = await fetchBrand(affiliate.whitelabel_brand_id);
    return {
      db,
      affiliate,
      affiliateId:   affiliate.id,
      isViewingAs:   false,
      viewingAsName: null,
      brand,
      isDelegate:          false,
      delegateEmail:       null,
      delegateOwnerName:   null,
      delegatePermissions: { canViewEarnings: true, canViewPayouts: true },
    };
  }

  // ── Delegate mode: no affiliate row for this user — maybe they're a delegate ──
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const deleg = await resolveDelegateContext(supabase, user.id);
    if (deleg) {
      const brand = await fetchBrand(deleg.affiliate.whitelabel_brand_id);
      return {
        db: createServiceClient(),         // delegates read via service client (RLS is owner-only)
        affiliate:     deleg.affiliate,
        affiliateId:   deleg.affiliateId,
        isViewingAs:   false,
        viewingAsName: null,
        brand,
        isDelegate:          true,
        delegateEmail:       deleg.delegateEmail,
        delegateOwnerName:   deleg.ownerName,
        delegatePermissions: deleg.permissions,
      };
    }
  }

  return null;
```

**Step 3:** `npx tsc --noEmit` → zero errors.

**Step 4:** Manual smoke deferred to Task 13 (needs a real delegate). Commit:
```bash
git add src/lib/affiliate-context.ts
git commit -m "feat(delegates): resolve delegate sessions to owner affiliate via service client"
```

---

## Task 5: post-login delegate acceptance

Ensures the invite magic-link lands a delegate on `/dashboard` (and stamps the row) instead of `/setup-password` or a stranded state.

**Files:**
- Modify: `src/app/api/auth/post-login/route.ts:84-103`

**Step 1:** After the affiliate self-heal block (`:74-94`), before the `?next=` handling, add a delegate branch. When there's no affiliate, try to accept a delegate invite via the anon client:

```typescript
  // Delegate flow: no affiliate row for this user — they may be an invited
  // delegate. accept_delegate_invite() (SECURITY DEFINER, reads auth.uid()/jwt)
  // stamps delegate_user_id/accepted_at and returns the owner affiliate id.
  if (!affiliate) {
    const { data: delegateAffId } = await supabase.rpc("accept_delegate_invite");
    if (delegateAffId) {
      // It's a delegate — send them into the dashboard (no password required).
      const next = request.nextUrl.searchParams.get("next");
      const safeNext =
        next && next.startsWith("/") && !next.startsWith("//") && !next.includes("://")
          ? next
          : "/dashboard";
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }
```

Note: `supabase` (anon, with the user's session) is already in scope at `:16`. The existing `db` is the service client.

**Step 2:** `npx tsc --noEmit` → zero errors. Commit:
```bash
git add src/app/api/auth/post-login/route.ts
git commit -m "feat(delegates): accept delegate invite on post-login"
```

---

## Task 6: Dashboard layout — delegate resolution, banner, nav gating

The layout has its OWN resolution (`:52-99`) that must learn about delegates or a delegate hits `<AccountPending>`.

**Files:**
- Modify: `src/app/dashboard/layout.tsx`

**Step 1:** Import the helpers at the top:
```typescript
import { VIEW_AS_COOKIE, resolveDelegateContext } from "@/lib/affiliate-context";
import { filterNavForDelegate } from "@/lib/delegates/delegate-nav";
import DelegateBanner from "@/components/dashboard/DelegateBanner";
import type { DelegatePermissions } from "@/types/database";
```

**Step 2:** Declare delegate state near `isViewingAs` (`:55-57`):
```typescript
  let isDelegate = false;
  let delegateOwnerName: string | null = null;
  let delegatePerms: DelegatePermissions = { canViewEarnings: true, canViewPayouts: true };
```

**Step 3:** After the normal-mode RLS lookup (`:89-94`) and BEFORE the `if (!affiliate)` AccountPending check (`:96`), add the delegate branch:
```typescript
  // Delegate mode: no affiliate row for this user — resolve the owner they delegate for.
  if (!affiliate && user && !isAdmin) {
    const deleg = await resolveDelegateContext(supabase, user.id);
    if (deleg) {
      affiliate         = deleg.affiliate;
      isDelegate        = true;
      delegateOwnerName = deleg.ownerName;
      delegatePerms     = deleg.permissions;
    }
  }
```

**Step 4:** Gate the nav. Replace `navItems={[...AFFILIATE_NAV]}` (`:171`) with a computed list:
```typescript
  const navItems = filterNavForDelegate([...AFFILIATE_NAV], {
    isDelegate,
    canViewEarnings: delegatePerms.canViewEarnings,
    canViewPayouts:  delegatePerms.canViewPayouts,
  });
```
and pass `navItems={navItems}`.

**Step 5:** Render the delegate banner. Inside the right-hand column (`:177`, just before the view-as banner block at `:179`), add:
```tsx
        {isDelegate && delegateOwnerName && (
          <DelegateBanner ownerName={delegateOwnerName} />
        )}
```

**Step 6:** The notifications count (`:119-127`) uses the anon client + `.eq("affiliate_id", affiliate.id)`. For a delegate this returns 0 via RLS — acceptable (delegates don't own notifications). Leave as-is; it won't error.

**Step 7:** `npx tsc --noEmit` → zero errors (DelegateBanner created next; do Task 7 first if the import fails, then re-check).

**Step 8: Commit** (after Task 7 so the import resolves):
```bash
git add src/app/dashboard/layout.tsx
git commit -m "feat(delegates): resolve delegate in dashboard layout + banner + nav gating"
```

---

## Task 7: DelegateBanner component

**Files:**
- Create: `src/components/dashboard/DelegateBanner.tsx`

**Step 1:** Light/teal Kashu-themed sticky banner (parallels the amber view-as banner but is informational, no exit button — a delegate signs out normally):

```tsx
export default function DelegateBanner({ ownerName }: { ownerName: string }) {
  return (
    <div className="bg-brand-600 text-white px-6 py-2.5 flex items-center gap-2 text-sm">
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
      <span>
        You&apos;re viewing <strong className="font-semibold">{ownerName}</strong>&apos;s account as a delegate.
      </span>
    </div>
  );
}
```

**Step 2:** `npx tsc --noEmit`. Commit together with Task 6:
```bash
git add src/components/dashboard/DelegateBanner.tsx src/app/dashboard/layout.tsx
git commit -m "feat(delegates): DelegateBanner + layout wiring"
```

---

## Task 8: Delegate management API routes (owner-only)

**Files:**
- Create: `src/app/api/dashboard/delegates/route.ts` (POST invite, GET list)
- Create: `src/app/api/dashboard/delegates/[id]/route.ts` (PATCH edit, DELETE revoke)

Shared auth rule: `const ctx = await getAffiliateContext(); if (!ctx || ctx.isDelegate) return 403;` — use `ctx.affiliateId` as the owner. All writes via `createServiceClient()`.

**Step 1: Create `route.ts`:**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAffiliateContext } from "@/lib/affiliate-context";
import { createServiceClient } from "@/lib/supabase/service";
import { logSecurityEvent } from "@/lib/audit-log";
import { normalizeEmail, checkInviteAllowed } from "@/lib/delegates/validate-invite";

export const dynamic = "force-dynamic";

const InviteSchema = z.object({
  delegate_name:     z.string().min(1).max(200),
  delegate_email:    z.string().email().max(200),
  can_view_earnings: z.boolean().optional(),
  can_view_payouts:  z.boolean().optional(),
});

export async function GET() {
  const ctx = await getAffiliateContext();
  if (!ctx || ctx.isDelegate) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data } = await svc
    .from("affiliate_delegates")
    .select("id, delegate_name, delegate_email, delegate_user_id, accepted_at, can_view_earnings, can_view_payouts, invited_at")
    .eq("affiliate_id", ctx.affiliateId)
    .order("invited_at", { ascending: false });
  return NextResponse.json({ delegates: data ?? [] });
}

export async function POST(request: NextRequest) {
  const ctx = await getAffiliateContext();
  if (!ctx || ctx.isDelegate) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let raw: unknown;
  try { raw = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = InviteSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const email = normalizeEmail(parsed.data.delegate_email);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // Guard: is this email an existing affiliate? (email-match trigger hazard)
  const { data: affMatch } = await svc
    .from("affiliates")
    .select("id")
    .ilike("email", email)
    .maybeSingle();

  const check = checkInviteAllowed({
    email,
    ownerEmail: ctx.affiliate.email,
    emailIsAffiliate: !!affMatch,
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 409 });
  }

  // Pre-check the global-unique-email constraint for a friendly message.
  const { data: existing } = await svc
    .from("affiliate_delegates")
    .select("id, affiliate_id")
    .ilike("delegate_email", email)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: "This email is already a delegate." },
      { status: 409 },
    );
  }

  // Insert the row first, then send the invite; roll back if the email send fails.
  const { data: inserted, error: insertErr } = await svc
    .from("affiliate_delegates")
    .insert({
      affiliate_id:      ctx.affiliateId,
      delegate_email:    email,
      delegate_name:     parsed.data.delegate_name,
      can_view_earnings: parsed.data.can_view_earnings ?? false,
      can_view_payouts:  parsed.data.can_view_payouts ?? false,
      invited_by:        ctx.affiliateId,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json({ error: "Could not create delegate." }, { status: 500 });
  }

  const siteUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const { data: invited, error: inviteErr } = await svc.auth.admin.inviteUserByEmail(email, {
    data:       { role: "delegate", affiliate_id: ctx.affiliateId },
    redirectTo: `${siteUrl}/auth/confirm`,
  });

  if (inviteErr) {
    // email_exists (422) is non-fatal — the user already has an auth account and
    // acceptance still happens on next login. Any other error = roll back the row.
    const status = (inviteErr as { status?: number }).status;
    const code = (inviteErr as { code?: string }).code;
    if (status !== 422 && code !== "email_exists") {
      await svc.from("affiliate_delegates").delete().eq("id", inserted.id);
      return NextResponse.json({ error: "Failed to send the invite email." }, { status: 500 });
    }
  }

  // Stamp delegate_user_id immediately when the invite created/returned a user.
  const newUserId = invited?.user?.id;
  if (newUserId) {
    await svc.from("affiliate_delegates")
      .update({ delegate_user_id: newUserId })
      .eq("id", inserted.id);
  }

  logSecurityEvent({
    userId: "self",
    userEmail: ctx.affiliate.email,
    action: "delegate.invited",
    resourceType: "affiliate_delegate",
    resourceId: inserted.id,
    metadata: { affiliate_id: ctx.affiliateId, delegate_email: email },
  });

  return NextResponse.json({ success: true, id: inserted.id });
}
```

**Step 2: Create `[id]/route.ts`:**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAffiliateContext } from "@/lib/affiliate-context";
import { createServiceClient } from "@/lib/supabase/service";
import { logSecurityEvent } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PatchSchema = z.object({
  delegate_name:     z.string().min(1).max(200).optional(),
  can_view_earnings: z.boolean().optional(),
  can_view_payouts:  z.boolean().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RX.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  const ctx = await getAffiliateContext();
  if (!ctx || ctx.isDelegate) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let raw: unknown;
  try { raw = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { error } = await svc
    .from("affiliate_delegates")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("affiliate_id", ctx.affiliateId);   // scope to owner — can't edit others' delegates

  if (error) return NextResponse.json({ error: "Update failed" }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RX.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  const ctx = await getAffiliateContext();
  if (!ctx || ctx.isDelegate) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { error } = await svc
    .from("affiliate_delegates")
    .delete()
    .eq("id", id)
    .eq("affiliate_id", ctx.affiliateId);

  if (error) return NextResponse.json({ error: "Revoke failed" }, { status: 500 });

  logSecurityEvent({
    userId: "self",
    userEmail: ctx.affiliate.email,
    action: "delegate.revoked",
    resourceType: "affiliate_delegate",
    resourceId: id,
    metadata: { affiliate_id: ctx.affiliateId },
  });
  return NextResponse.json({ success: true });
}
```

**Step 3:** Verify `logSecurityEvent`'s signature matches these calls (open `src/lib/audit-log.ts`; adjust field names if needed). `npx tsc --noEmit` → zero errors.

**Step 4: Commit**
```bash
git add src/app/api/dashboard/delegates
git commit -m "feat(delegates): owner-only invite/list/edit/revoke API routes"
```

---

## Task 9: DelegateAccessCard component (owner UI)

**Files:**
- Create: `src/components/dashboard/DelegateAccessCard.tsx`

Client component. Props: `initialDelegates: Array<{id, delegate_name, delegate_email, delegate_user_id, accepted_at, can_view_earnings, can_view_payouts}>`. Renders: an invite form (name, email, two permission checkboxes), and a list with Active (accepted_at set) / Pending badges, per-row permission toggles (PATCH) and a Revoke button (DELETE), calling the Task 8 routes with `fetch`, then `router.refresh()`.

**Step 1:** Build the component using existing tokens (`.card`, `.input-base`, `.btn-primary`, `.btn-accent`, `.badge-accent`, `.badge-amber`, `text-gray-900`, `text-brand-400`). Follow the light theme; mirror the structure of an existing form component such as `src/components/dashboard/BankAccountForm.tsx` for fetch + toast/error patterns. Success/error surfaced inline. Use `fmt` if showing dates.

Key behaviors:
- Submit invite → `POST /api/dashboard/delegates` with `{delegate_name, delegate_email, can_view_earnings, can_view_payouts}`. On non-2xx, show `error` from the JSON. On success, clear form + `router.refresh()`.
- Per row: two checkboxes wired to `PATCH /api/dashboard/delegates/{id}` (debounced or on-change). Revoke → `DELETE` with a confirm().
- Empty state copy: "Invite a teammate to view your referrals and conversions. They won't see earnings or payout details unless you allow it."
- Badge: `accepted_at ? "Active" (badge-accent) : "Pending" (badge-amber)`.

**Step 2:** `npx tsc --noEmit`. Commit:
```bash
git add src/components/dashboard/DelegateAccessCard.tsx
git commit -m "feat(delegates): DelegateAccessCard owner management UI"
```

---

## Task 10: Wire the card into the Profile page

**Files:**
- Modify: `src/app/dashboard/profile/page.tsx`

**Step 1:** In the server component, after resolving `ctx`, fetch the owner's delegates only when NOT a delegate:
```typescript
  const { affiliate, isDelegate, affiliateId, db } = ctx;
  let delegates: any[] = [];
  if (!isDelegate) {
    const { data } = await db
      .from("affiliate_delegates")
      .select("id, delegate_name, delegate_email, delegate_user_id, accepted_at, can_view_earnings, can_view_payouts")
      .eq("affiliate_id", affiliateId)
      .order("invited_at", { ascending: false });
    delegates = data ?? [];
  }
```
Note: in normal mode `db` is the anon client and the RLS `affiliate_delegates_select_own` policy returns the owner's rows; in view-as mode `db` is the service client. Both work.

**Step 2:** Gate the password card and render the delegate card. Wrap the password `<UpdatePasswordForm />` card in `{!isDelegate && ( … )}` (a delegate can't set the owner's password). After the grid, add:
```tsx
      {!isDelegate && (
        <DelegateAccessCard initialDelegates={delegates} />
      )}
```
Import `DelegateAccessCard` at the top.

**Step 3:** `npx tsc --noEmit` + `npm run build`. Commit:
```bash
git add src/app/dashboard/profile/page.tsx
git commit -m "feat(delegates): surface DelegateAccessCard on profile (owner only)"
```

---

## Task 11: Page guards on Earnings + Payouts + overview earnings check

Delegates without the flag must not reach these pages even by direct URL (nav-hiding is not enough).

**Files:**
- Modify: `src/app/dashboard/earnings/page.tsx` (top of the component)
- Modify: `src/app/dashboard/payouts/page.tsx` (top of the component)
- Audit: `src/app/dashboard/page.tsx` + `src/components/dashboard/StatsRow.tsx`

**Step 1:** In `earnings/page.tsx`, right after `const ctx = await getAffiliateContext();` guard:
```typescript
  import { redirect } from "next/navigation";
  // ...
  if (ctx.isDelegate && !ctx.delegatePermissions.canViewEarnings) redirect("/dashboard");
```

**Step 2:** In `payouts/page.tsx`, same pattern:
```typescript
  if (ctx.isDelegate && !ctx.delegatePermissions.canViewPayouts) redirect("/dashboard");
```

**Step 3:** Audit the overview (`src/app/dashboard/page.tsx`) and `StatsRow` for the affiliate's *commission earnings* in dollars. The hero shows Volume + user counts + funnel (conversion data — allowed). IF `StatsRow` or any overview widget renders commission `$`, wrap that widget in `{(!ctx.isDelegate || ctx.delegatePermissions.canViewEarnings) && ( … )}`. If it shows only counts/volume, no change. Document what you found in the commit message.

**Step 4:** `npx tsc --noEmit` + `npm run build`. Commit:
```bash
git add src/app/dashboard/earnings/page.tsx src/app/dashboard/payouts/page.tsx src/app/dashboard/page.tsx
git commit -m "feat(delegates): guard earnings/payouts pages by permission"
```

---

## Task 12: Block payout mutations for delegates (403)

Money-movement is always owner-only, independent of any flag.

**Files:**
- Find + modify the payout mutation routes. Discover with:
  `grep -rl "request_payout\|mercury-account\|payout" src/app/api/payouts src/app/api/dashboard 2>/dev/null`
- Known target: `src/app/api/payouts/mercury-account/route.ts` (bank edit).

**Step 1:** In each payout **mutation** route (the payout-request route and `mercury-account`), after resolving the user/affiliate, add a delegate check. Simplest: call `getAffiliateContext()` and reject:
```typescript
  const ctx = await getAffiliateContext();
  if (ctx?.isDelegate) {
    return NextResponse.json({ error: "Delegates can't modify payout settings." }, { status: 403 });
  }
```
Place it BEFORE any write. (These routes currently resolve the affiliate via `db.from("affiliates").select("id").single()` on the anon client — for a delegate that returns null and the route already 404s, but an explicit 403 is clearer and future-proofs against the service-client path.)

**Step 2:** Do NOT touch `execute-batch`, `isFinanceEmail`, or `mercury.ts` — admin/finance flows are out of scope.

**Step 3:** `npx tsc --noEmit` + `npm run build`. Commit:
```bash
git add src/app/api/payouts
git commit -m "feat(delegates): 403 delegates on payout mutation routes"
```

---

## Task 13: Full verification (build + E2E)

**Step 1: Static checks**
```bash
npm test              # all delegate unit tests pass
npx tsc --noEmit      # zero errors
npm run build         # zero errors
```

**Step 2: Manual E2E** (use the @superpowers:verification-before-completion discipline — evidence before claims). Against a local/preview run:
1. As an affiliate owner → Profile → invite a delegate (fresh external email) with both flags OFF. Row appears "Pending".
2. Open the invite email → accept → land on the owner's dashboard with the delegate banner. Confirm the sidebar has NO Earnings/Payouts items; visiting `/dashboard/earnings` and `/dashboard/payouts` directly redirects to `/dashboard`.
3. Confirm the delegate sees referrals (Users) + funnel/conversions + Tools.
4. As owner, toggle "view earnings" ON → delegate refresh → Earnings nav + page now appear; Payouts still hidden.
5. `curl`/devtools: as the delegate, `POST /api/dashboard/delegates` and `POST /api/payouts/*` → both 403.
6. As owner, Revoke → delegate's next navigation resolves to null → `<AccountPending>` (access gone). (A revoked delegate with a live session loses data access because `resolveDelegateContext` returns null.)

**Step 3:** Update `CLAUDE.md` Self-Annealing Log with a `### [2026-07-13] — Delegate Access` entry: the service-client act-as model, the two flags, the `dashboard/layout.tsx` duplicate-resolution gotcha, and the affiliate-email collision guard.

**Step 4: Commit**
```bash
git add CLAUDE.md
git commit -m "docs: delegate-access self-annealing log entry"
```

---

## Execution notes
- **DRY:** the delegate resolution lives once in `resolveDelegateContext`; both `getAffiliateContext` and the layout call it.
- **YAGNI:** no universal scrub helper (design doc §4) — page guards + nav-hiding + route 403s cover it with less surface. No admin-side delegate UI, no multi-owner delegates, no non-expiring invites.
- **TDD:** the two pure helpers (Tasks 2, 3) are the unit-tested core; DB/route/UI pieces are verified by build + manual E2E (no DB test harness in this repo).
- **Deviation from design doc:** `delegate-scrub.ts` is replaced by targeted page guards; documented here and to be noted in the design doc's status.
