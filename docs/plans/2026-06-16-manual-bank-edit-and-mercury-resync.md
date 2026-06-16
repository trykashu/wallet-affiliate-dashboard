# Manual Bank-Detail Editing (Admin + Affiliate) with Safe Mercury Re-sync — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let admins manually edit any affiliate's bank details, and let affiliates self-edit their own, while keeping Mercury correct (no stale recipient) without adding any synchronous Mercury call.

**Architecture:** A pure decision function `buildBankAccountUpdate()` computes the `payout_accounts` upsert row + whether bank details changed; when they changed it nulls `provider_id` so the next payout re-binds the Mercury recipient via the existing lazy `getOrCreateRecipient` dedupe. A thin `saveBankDetails(svc, …)` wrapper does the DB I/O. Two routes call it: admin (service client, `is_verified=true`) and affiliate self-service (anon client, `is_verified=false` → pending admin re-verify). `execute-batch`, the finance gate, and payout limits are untouched.

**Tech Stack:** Next.js 15 App Router, Supabase, Zod, Node built-in test runner (`tsx --test`, `node:test` + `node:assert/strict`). Design doc: `docs/plans/2026-06-16-manual-bank-edit-and-mercury-resync-design.md`.

**Conventions:** tests live beside source as `*.test.ts`; run a single test file with `npx tsx --test src/path/file.test.ts`. Every code change must pass `npx tsc --noEmit` and `npm run build` before the final commit. Match the dark admin theme (`ad-*` classes / `var(--ad-*)`) for admin UI; light Kashu theme for affiliate UI.

---

## Task 1: Pure helper `buildBankAccountUpdate` + tests

**Files:**
- Create: `src/lib/payouts/bank-account-update.ts`
- Test: `src/lib/payouts/bank-account-update.test.ts`

**Step 1: Write the failing tests**

```ts
// src/lib/payouts/bank-account-update.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBankAccountUpdate, type ExistingAccount } from "./bank-account-update";

const existing: ExistingAccount = {
  routing_number: "021000021",
  account_number_last4: "6789",
  metadata: { full_account_number: "0123456789", routing_number: "021000021", source: "pdf_upload" },
  address1: "1 A St", address2: null, city: "Reno", region: "NV", postal_code: "89501", country: "US",
  provider_id: "rec_OLD",
};
const baseInput = {
  affiliateId: "aff_1",
  accountHolderName: "Jane Doe",
  routingNumber: "021000021",
  accountNumber: "0123456789",
  address: { address1: "1 A St", address2: null, city: "Reno", region: "NV", postalCode: "89501", country: "US" },
};

test("account number changed -> bankChanged true, provider_id cleared", () => {
  const { row, bankChanged } = buildBankAccountUpdate(existing, { ...baseInput, accountNumber: "9999999999" }, { markVerified: true, source: "admin_manual" });
  assert.equal(bankChanged, true);
  assert.equal(row.provider_id, null);
  assert.equal(row.account_number_last4, "9999");
  assert.equal((row.metadata as { full_account_number: string }).full_account_number, "9999999999");
  assert.equal(row.is_verified, true);
  assert.equal(row.is_default, true);
});

test("routing changed -> bankChanged true, provider_id cleared", () => {
  const { row, bankChanged } = buildBankAccountUpdate(existing, { ...baseInput, routingNumber: "031000031" }, { markVerified: true, source: "admin_manual" });
  assert.equal(bankChanged, true);
  assert.equal(row.provider_id, null);
});

test("nothing changed -> bankChanged false, provider_id preserved", () => {
  const { row, bankChanged } = buildBankAccountUpdate(existing, baseInput, { markVerified: true, source: "admin_manual" });
  assert.equal(bankChanged, false);
  assert.equal(row.provider_id, "rec_OLD");
});

test("blank account number keeps existing account, not bankChanged on that field", () => {
  const { row, bankChanged } = buildBankAccountUpdate(existing, { ...baseInput, accountNumber: "" }, { markVerified: true, source: "admin_manual" });
  assert.equal((row.metadata as { full_account_number: string }).full_account_number, "0123456789");
  assert.equal(row.account_number_last4, "6789");
  assert.equal(bankChanged, false);
  assert.equal(row.provider_id, "rec_OLD");
});

test("address changed -> bankChanged true, provider_id cleared", () => {
  const { row, bankChanged } = buildBankAccountUpdate(existing, { ...baseInput, address: { ...baseInput.address, city: "Vegas" } }, { markVerified: true, source: "admin_manual" });
  assert.equal(bankChanged, true);
  assert.equal(row.provider_id, null);
});

test("affiliate self-edit -> is_verified false + pending_review metadata", () => {
  const { row } = buildBankAccountUpdate(existing, baseInput, { markVerified: false, source: "self_service" });
  assert.equal(row.is_verified, false);
  assert.equal((row.metadata as { pending_review?: boolean }).pending_review, true);
});

test("new account (no existing) -> insert shape, bankChanged true, provider_id null", () => {
  const { row, bankChanged } = buildBankAccountUpdate(null, baseInput, { markVerified: false, source: "self_service" });
  assert.equal(bankChanged, true);
  assert.equal(row.provider_id, null);
  assert.equal(row.provider, "mercury");
});
```

**Step 2: Run to verify it fails**

Run: `npx tsx --test src/lib/payouts/bank-account-update.test.ts`
Expected: FAIL ("Cannot find module './bank-account-update'").

**Step 3: Write minimal implementation**

```ts
// src/lib/payouts/bank-account-update.ts
/**
 * Pure decision logic for saving an affiliate's Mercury bank details.
 * Computes the payout_accounts upsert row and whether bank details changed.
 * When they changed, provider_id is nulled so the next payout re-binds the
 * Mercury recipient (getOrCreateRecipient dedupe). No Mercury call here.
 */
export interface BankAddressInput {
  address1: string;
  address2?: string | null;
  city: string;
  region: string;       // 2-letter state
  postalCode: string;
  country?: string;     // default "US"
}
export interface BankInput {
  affiliateId: string;
  accountHolderName: string;
  routingNumber: string;
  accountNumber?: string;   // blank/undefined => keep existing
  address?: BankAddressInput;
}
export interface ExistingAccount {
  routing_number: string | null;
  account_number_last4: string | null;
  metadata: Record<string, unknown> | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  provider_id: string | null;
}
export interface BuildOpts {
  markVerified: boolean;
  source: "admin_manual" | "self_service";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildBankAccountUpdate(
  existing: ExistingAccount | null,
  input: BankInput,
  opts: BuildOpts,
): { row: Record<string, any>; bankChanged: boolean } {
  const existingFull = (existing?.metadata as { full_account_number?: string } | null)?.full_account_number ?? null;
  const fullAccount = input.accountNumber && input.accountNumber.length > 0 ? input.accountNumber : existingFull;
  const last4 = fullAccount ? fullAccount.slice(-4) : existing?.account_number_last4 ?? null;

  const addr = input.address;
  const norm = (v: string | null | undefined) => (v ?? "").trim();
  const addressChanged = !!addr && (
    norm(addr.address1) !== norm(existing?.address1) ||
    norm(addr.address2) !== norm(existing?.address2) ||
    norm(addr.city) !== norm(existing?.city) ||
    norm(addr.region) !== norm(existing?.region) ||
    norm(addr.postalCode) !== norm(existing?.postal_code)
  );
  const bankChanged =
    existing === null ||
    norm(input.routingNumber) !== norm(existing.routing_number) ||
    (!!fullAccount && fullAccount !== existingFull) ||
    addressChanged;

  const metadata: Record<string, unknown> = {
    ...(existing?.metadata ?? {}),
    full_account_number: fullAccount,
    routing_number: input.routingNumber,
    source: opts.source,
  };
  if (opts.source === "self_service") {
    metadata.pending_review = true;
    metadata.pending_reason = "Affiliate updated bank details — pending verification";
  } else {
    delete metadata.pending_review;
    delete metadata.pending_reason;
  }

  const row: Record<string, any> = {
    affiliate_id: input.affiliateId,
    provider: "mercury",
    account_name: input.accountHolderName,
    routing_number: input.routingNumber,
    account_number_last4: last4,
    is_verified: opts.markVerified,
    is_default: true,
    metadata,
    provider_id: bankChanged ? null : (existing?.provider_id ?? null),
    updated_at: new Date().toISOString(),
  };
  if (addr) {
    row.address1 = addr.address1;
    row.address2 = addr.address2 ?? null;
    row.city = addr.city;
    row.region = addr.region;
    row.postal_code = addr.postalCode;
    row.country = addr.country || "US";
  }
  return { row, bankChanged };
}
```

**Step 4: Run to verify it passes**

Run: `npx tsx --test src/lib/payouts/bank-account-update.test.ts`
Expected: PASS (all tests).

**Step 5: Commit**

```bash
git add src/lib/payouts/bank-account-update.ts src/lib/payouts/bank-account-update.test.ts
git commit -m "feat(payouts): pure buildBankAccountUpdate (clears provider_id on bank change)"
```

---

## Task 2: `saveBankDetails(svc, …)` DB wrapper

**Files:**
- Create: `src/lib/payouts/save-bank-details.ts`

(No unit test — thin DB I/O over the tested pure helper; covered by route + manual e2e.)

**Step 1: Implement**

```ts
// src/lib/payouts/save-bank-details.ts
import { buildBankAccountUpdate, type BankInput, type BuildOpts, type ExistingAccount } from "./bank-account-update";

const SELECT = "id, routing_number, account_number_last4, metadata, address1, address2, city, region, postal_code, country, provider_id";

/**
 * Upsert an affiliate's mercury payout_account using the pure builder.
 * `svc` is any Supabase client — service client (admin) or anon client (affiliate, RLS-scoped).
 * Returns { last4, bankChanged }.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function saveBankDetails(svc: any, input: BankInput, opts: BuildOpts): Promise<{ last4: string | null; bankChanged: boolean }> {
  const { data: existing } = await svc
    .from("payout_accounts")
    .select(SELECT)
    .eq("affiliate_id", input.affiliateId)
    .eq("provider", "mercury")
    .limit(1)
    .maybeSingle();

  const { row, bankChanged } = buildBankAccountUpdate((existing as ExistingAccount | null) ?? null, input, opts);

  if (existing) {
    const { error } = await svc.from("payout_accounts").update(row).eq("id", existing.id);
    if (error) throw new Error(`save-bank-details update failed: ${error.message}`);
  } else {
    const { error } = await svc.from("payout_accounts").insert(row);
    if (error) throw new Error(`save-bank-details insert failed: ${error.message}`);
  }
  return { last4: row.account_number_last4 ?? null, bankChanged };
}
```

**Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors.

**Step 3: Commit**

```bash
git add src/lib/payouts/save-bank-details.ts
git commit -m "feat(payouts): saveBankDetails wrapper over the pure builder"
```

---

## Task 3: Admin API route `POST /api/admin/affiliates/[id]/bank`

**Files:**
- Create: `src/app/api/admin/affiliates/[id]/bank/route.ts`

**Reference:** mirror the gate + params pattern of `src/app/api/admin/affiliates/[id]/address/route.ts`.

**Step 1: Implement**

```ts
// src/app/api/admin/affiliates/[id]/bank/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";
import { saveBankDetails } from "@/lib/payouts/save-bank-details";

export const dynamic = "force-dynamic";

const Body = z.object({
  account_holder_name: z.string().min(1).max(200),
  routing_number: z.string().regex(/^\d{9}$/),
  account_number: z.string().regex(/^\d{4,17}$/).optional().or(z.literal("")),
  address1: z.string().min(2),
  address2: z.string().optional().nullable(),
  city: z.string().min(2),
  region: z.string().regex(/^[A-Za-z]{2}$/),
  postal_code: z.string().regex(/^\d{5}(-\d{4})?$/),
});

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id: affiliateId } = await ctx.params;

  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  const b = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  try {
    const { last4, bankChanged } = await saveBankDetails(svc, {
      affiliateId,
      accountHolderName: b.account_holder_name,
      routingNumber: b.routing_number,
      accountNumber: b.account_number || undefined,
      address: { address1: b.address1, address2: b.address2 ?? null, city: b.city, region: b.region.toUpperCase(), postalCode: b.postal_code, country: "US" },
    }, { markVerified: true, source: "admin_manual" });

    await svc.from("affiliates").update({ bank_details_needed: false }).eq("id", affiliateId);
    await logSecurityEvent({
      userId: user.id, userEmail: user.email, action: "bank_data_updated",
      resourceType: "payout_account", resourceId: affiliateId,
      metadata: { changed_by: `admin:${user.email}`, bank_changed: bankChanged },
    });
    return NextResponse.json({ success: true, last4, bankChanged });
  } catch (e) {
    console.error("[admin bank] save failed:", e);
    return NextResponse.json({ error: "Failed to save bank details" }, { status: 500 });
  }
}

export function GET() { return NextResponse.json({ error: "Method not allowed" }, { status: 405 }); }
```

**Step 2: Verify compile + build**

Run: `npx tsc --noEmit && npm run build 2>&1 | grep -E "api/admin/affiliates/\[id\]/bank|error|✓ Compiled"`
Expected: route listed, compiled OK.

**Step 3: Commit**

```bash
git add src/app/api/admin/affiliates/[id]/bank/route.ts
git commit -m "feat(admin): POST /api/admin/affiliates/[id]/bank manual bank edit (verified, mercury re-sync)"
```

---

## Task 4: Affiliate route — extend `POST /api/payouts/mercury-account`

**Files:**
- Modify: `src/app/api/payouts/mercury-account/route.ts`

**Change:** accept optional address; route through `saveBankDetails` with `markVerified:false, source:"self_service"`; keep `bank_details_needed=false`; audit `changed_by:"self"`.

**Step 1: Replace the body schema + write logic** (full file)

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/audit-log";
import { saveBankDetails } from "@/lib/payouts/save-bank-details";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  account_holder_name: z.string().min(1).max(200),
  routing_number: z.string().regex(/^\d{9}$/, "Routing number must be exactly 9 digits"),
  account_number: z.string().regex(/^\d{4,17}$/, "Account number must be 4-17 digits"),
  address1: z.string().min(2),
  address2: z.string().optional().nullable(),
  city: z.string().min(2),
  region: z.string().regex(/^[A-Za-z]{2}$/),
  postal_code: z.string().regex(/^\d{5}(-\d{4})?$/),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  const b = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: affiliate } = await db.from("affiliates").select("id").single();
  if (!affiliate) return NextResponse.json({ error: "Affiliate not found" }, { status: 404 });

  try {
    const { last4 } = await saveBankDetails(db, {
      affiliateId: affiliate.id,
      accountHolderName: b.account_holder_name,
      routingNumber: b.routing_number,
      accountNumber: b.account_number,
      address: { address1: b.address1, address2: b.address2 ?? null, city: b.city, region: b.region.toUpperCase(), postalCode: b.postal_code, country: "US" },
    }, { markVerified: false, source: "self_service" });

    await db.from("affiliates").update({ bank_details_needed: false }).eq("id", affiliate.id);
    await logSecurityEvent({
      userId: user.id, userEmail: user.email, action: "bank_data_updated",
      resourceType: "payout_account", resourceId: affiliate.id, metadata: { changed_by: "self" },
    });
    return NextResponse.json({ success: true, last4, pending_review: true });
  } catch (e) {
    console.error("[mercury-account] save failed:", e);
    return NextResponse.json({ error: "Failed to save account" }, { status: 500 });
  }
}
```

**Step 2: Verify compile + build.** Run: `npx tsc --noEmit && npm run build 2>&1 | grep -E "error|✓ Compiled"`. Expected: OK.

**Step 3: Commit**

```bash
git add src/app/api/payouts/mercury-account/route.ts
git commit -m "feat(payouts): affiliate self-edit collects address, marks pending review, re-syncs mercury"
```

---

## Task 5: Affiliate UI — address fields + pending state in `BankAccountForm`

**Files:**
- Modify: `src/components/dashboard/BankAccountForm.tsx`
- Check: `src/components/dashboard/PayoutsClient.tsx` (props already pass account; verify form still renders via the existing "Update bank details" button).

**Changes (light Kashu theme — keep existing classes):**
1. Add state + inputs for `address1, address2, city, region (maxLength 2, uppercased), postalCode`, prefilled from the passed `account` (address1/city/region/postal_code) when present.
2. Add the 5 address fields to the POST body to `/api/payouts/mercury-account`.
3. On success, show copy: **"Your updated bank details are pending verification and will be active once an admin confirms them."** (replaces the plain "saved" banner for self-edits).
4. Client-side validate region `^[A-Za-z]{2}$` and ZIP `^\d{5}(-\d{4})?$` before submit (mirror `RequestedBatchesSection` AddressModal’s `canSave`).

**Verification (no component test in repo):**
Run: `npx tsc --noEmit && npm run build 2>&1 | grep -E "error|✓ Compiled"` → OK.
Manual: `npm run dev`, log in as an affiliate (or admin view-as), open Payouts → "Update bank details", fill bank + address, submit → see the pending-verification message.

**Commit**

```bash
git add src/components/dashboard/BankAccountForm.tsx src/components/dashboard/PayoutsClient.tsx
git commit -m "feat(payouts): affiliate bank form collects address + shows pending-verification state"
```

---

## Task 6: Admin UI — "Edit bank" drawer + row action in `AffiliateTable`

**Files:**
- Create: `src/components/admin/EditBankDrawer.tsx`
- Modify: `src/components/admin/AffiliateTable.tsx` (add an "Edit bank" action button per row; open the drawer)

**EditBankDrawer (dark admin theme — `ad-*` / `var(--ad-*)`, mirror the `AddressModal` in `RequestedBatchesSection.tsx`):**
- Props: `{ affiliateId, affiliateName, existing?: { account_name, last4, address1, address2, city, region, postal_code } | null, onClose, onSaved }`.
- Fields: holder name, routing (`\d{9}`), account number (placeholder `•••• {last4}`, **blank = keep existing**), address1/2/city/region(2)/zip — prefilled from `existing`.
- `canSave`: name ≥ 2, routing 9 digits, account blank OR 4–17 digits, region 2 letters, zip valid.
- Submit → `POST /api/admin/affiliates/{affiliateId}/bank` → on ok `onSaved()` (router.refresh in parent).
- Use `.ad-input`, `.ad-btn-primary`, `.drawer-backdrop`/`.drawer-panel` (already dark-scoped).

**AffiliateTable change:** in the actions cell add a button "Edit bank" that sets a `editBankFor` state object `{id, name, ...existing}`; render `<EditBankDrawer .../>` when set. The table’s `AffiliateWithCounts` already has `hasBankAccount`; pass through any account fields needed for prefill (extend the page query in Task 7 to include them).

**Verification:** `npx tsc --noEmit && npm run build` → OK. Manual: Admin → Affiliates → row → "Edit bank" → edit → save → row refreshes.

**Commit**

```bash
git add src/components/admin/EditBankDrawer.tsx src/components/admin/AffiliateTable.tsx
git commit -m "feat(admin): Edit-bank drawer + row action on the Affiliates page"
```

---

## Task 7: Surface "pending verification" + admin verify on the Affiliates page

**Files:**
- Modify: `src/app/admin/affiliates/page.tsx`
- Modify: `src/components/admin/AffiliateTable.tsx`

**Changes:**
1. In `page.tsx`, the payout-accounts fetch currently filters `is_verified=true`. Change to fetch ALL mercury accounts (drop the filter), and compute per affiliate:
   - `hasBankAccount` = has an account with `is_verified=true` (unchanged meaning).
   - `bankPendingReview` = has an account where `is_verified=false` OR `metadata.pending_review === true`.
   - Pass through prefill fields (account_name, account_number_last4, address1/2/city/region/postal_code) on `AffiliateWithCounts` for the Edit drawer.
2. In `AffiliateTable`, when `bankPendingReview` (and not verified), show an amber **"Pending review"** `ad-badge-amber` chip in the Bank column. The Edit-bank drawer save (admin, `markVerified:true`) clears it.

**Verification:** `npx tsc --noEmit && npm run build` → OK. Manual: do an affiliate self-edit → confirm the affiliate shows "Pending review" in admin → open Edit bank → save → chip flips to "On file".

**Commit**

```bash
git add src/app/admin/affiliates/page.tsx src/components/admin/AffiliateTable.tsx
git commit -m "feat(admin): surface affiliate self-edits as 'Pending review' until admin verifies"
```

---

## Task 8: Full verification + push

**Steps:**
1. `npm test` → all `*.test.ts` pass (incl. `bank-account-update.test.ts`).
2. `npx tsc --noEmit` → clean.
3. `npm run build` → ✓, both new routes listed (`/api/admin/affiliates/[id]/bank`, `/api/payouts/mercury-account`).
4. Confirm **untouched**: `src/lib/mercury.ts`, `src/app/api/admin/payouts/execute-batch/route.ts`, `isFinanceEmail` gate, payout limits (`git diff --name-only` shows none of these).
5. Manual e2e (dev): admin edit (routing/account) → verified; affiliate self-edit → pending → admin verify; sanity-check that after a routing/account change the stored `provider_id` is null (next payout re-binds).
6. Commit any cleanup, then push to `main`.

```bash
git push origin main
```

## Notes / guardrails
- **Do NOT** add a synchronous Mercury call anywhere in the save path. Mercury re-sync = nulling `provider_id`; `execute-batch` does the rest at next payout.
- **Known limitation:** a pure address-only change for an affiliate with an existing recipient won't update Mercury (dedupe re-finds by routing+account). Document only; out of scope.
- Never expose `metadata.full_account_number` to the client; the admin drawer prefills only `•••• last4`.
