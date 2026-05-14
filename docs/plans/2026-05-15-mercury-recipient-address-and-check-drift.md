# Mercury Recipient Address + Check Route Drift Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop using Kashu's Cheyenne, WY address on every Mercury recipient. Pull the affiliate's address from their signed PandaDoc contract, store it on `payout_accounts`, and pass it through to Mercury recipient creation along with the affiliate's email. Bundle: fix the cron check route so it uses `payout_id` for the earnings flip and mirrors `Commission Status = Paid` to Airtable (currently drifts from `update-status`).

**Architecture:** Extends the title-first extractor from PR #13 to also pull address fields. Adds 5 new columns to `payout_accounts` (`address1`, `address2`, `city`, `region`, `postal_code`, `country`). The Mercury recipient creation function gains a required `address` parameter; the execute-batch caller reads it from the payout_accounts row and the email from `affiliates.email`. The BankPreviewDrawer renders the new fields so AMs can verify before Confirm. A one-shot script backfills addresses for existing payout_accounts whose pandadoc_id is set.

**Tech Stack:** Next.js 15 App Router, Supabase Postgres, `node:test` via `npx tsx --test`. Test fixtures expand the existing `src/lib/pandadoc.test.ts` suite.

**Reference:** Source of bug — `src/lib/mercury.ts:71-75` hardcodes the address. Caller — `src/app/api/admin/payouts/execute-batch/route.ts:146` passes only name+routing+account. Check route drift — `src/app/api/cron/check-mercury-payouts/route.ts:80-86` uses `affiliate_id` instead of `payout_id` for earnings; missing Airtable mirror.

---

## Phase 0 — Database

### Task 1: Migration `021_payout_account_address.sql`

**Files:**
- Create: `supabase/migrations/021_payout_account_address.sql`

**Step 1: Write the migration**

```sql
-- 021_payout_account_address.sql
-- Adds the recipient mailing address fields to payout_accounts so we stop
-- using Kashu's address on every Mercury recipient. Fields are nullable to
-- avoid breaking existing rows; backfill script runs after this migration.

alter table public.payout_accounts
  add column if not exists address1     text,
  add column if not exists address2     text,
  add column if not exists city         text,
  add column if not exists region       text,
  add column if not exists postal_code  text,
  add column if not exists country      text default 'US';
```

**Step 2: Apply in Supabase SQL editor.** Verify with:
```sql
select column_name from information_schema.columns
 where table_schema='public' and table_name='payout_accounts'
   and column_name in ('address1','address2','city','region','postal_code','country');
```
Expected: 6 rows.

**Step 3: Commit**
```bash
git add supabase/migrations/021_payout_account_address.sql
git commit -m "feat(db): payout_accounts address columns for Mercury recipient"
```

---

### Task 2: TypeScript types

**Files:**
- Modify: `src/types/database.ts` — extend `PayoutAccount` interface

**Step 1: Inspect current shape**

```bash
grep -nA 12 "^export interface PayoutAccount" src/types/database.ts | head -20
```

**Step 2: Add the 6 new fields**

In `src/types/database.ts`, find `export interface PayoutAccount` and append:

```ts
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
```

**Step 3: Verify**

```bash
npx tsc --noEmit
```
Clean.

**Step 4: Commit**

```bash
git add src/types/database.ts
git commit -m "feat(types): PayoutAccount address fields"
```

---

## Phase 1 — Extractor

### Task 3: Add address extraction to `extractBankDetails`

**Files:**
- Modify: `src/lib/pandadoc.ts`
- Modify: `src/lib/pandadoc.test.ts` (new failing tests)

**Step 1: Add 3 failing tests at the bottom of `pandadoc.test.ts`**

```ts
describe("extractBankDetails — address extraction (2026-05-15)", () => {
  it("extracts address fields when titled", () => {
    const fields: PandaDocField[] = [
      f("Alex Rivera", { title: "Account Holder Name" }),
      f("121000358", { title: "Routing Number" }),
      f("000123456789", { title: "Account Number" }),
      f("123 Main St", { title: "Address" }),
      f("Apt 4", { title: "Apartment / Unit" }),
      f("Boulder", { title: "City" }),
      f("CO", { title: "State" }),
      f("80301", { title: "Zip Code" }),
    ];

    const result = extractBankDetails(fields);
    assert.equal(result.address1, "123 Main St");
    assert.equal(result.address2, "Apt 4");
    assert.equal(result.city, "Boulder");
    assert.equal(result.region, "CO");
    assert.equal(result.postal_code, "80301");
    assert.equal(result.country, "US");
  });

  it("warns when address is missing", () => {
    const fields: PandaDocField[] = [
      f("Alex Rivera", { title: "Account Holder Name" }),
      f("121000358", { title: "Routing Number" }),
      f("000123456789", { title: "Account Number" }),
    ];
    const result = extractBankDetails(fields);
    assert.equal(result.address1, null);
    assert.ok(result.warnings.some((w) => w.toLowerCase().includes("address")));
  });

  it("accepts common state-abbreviation OR full-name variants", () => {
    const fields: PandaDocField[] = [
      f("123 Main St", { title: "Street" }),
      f("Boulder", { title: "City" }),
      f("Colorado", { title: "State" }),
      f("80301", { title: "ZIP" }),
      f("121000358", { title: "Routing Number" }),
      f("000123456789", { title: "Account Number" }),
    ];
    const result = extractBankDetails(fields);
    assert.equal(result.region, "CO"); // normalized to 2-letter code
  });
});
```

**Step 2: Verify they fail**

```bash
npm test 2>&1 | tail -20
```
Expected: 3 failures in the new describe block. The 8 existing tests still pass.

**Step 3: Extend the `ExtractedBankDetails` interface**

In `src/lib/pandadoc.ts`, find the interface (currently has 7 fields + `warnings`). Add:

```ts
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
```

**Step 4: Add the state-normalization helper** above `extractBankDetails`:

```ts
// 50 US states + DC, full name → 2-letter abbreviation.
// Used to normalize PandaDoc state fields where users may type either form.
const US_STATE_BY_NAME: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY",
};
const US_STATE_CODES = new Set(Object.values(US_STATE_BY_NAME));

function normalizeRegion(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  const upper = v.toUpperCase();
  if (upper.length === 2 && US_STATE_CODES.has(upper)) return upper;
  const code = US_STATE_BY_NAME[v.toLowerCase()];
  if (code) return code;
  return v; // leave as-is if we don't recognize (international, typo, etc.)
}
```

**Step 5: Add address extraction in `extractBankDetails`** before the `return` statement:

```ts
  // 7. ADDRESS — title-first; defaults country to "US".
  const address1 = findByTitle(partnerFields, "address1", "address 1", "street address", "street", "address")?.value.trim() ?? null;
  const address2 = findByTitle(partnerFields, "address2", "address 2", "apartment", "apt", "suite", "unit")?.value.trim() ?? null;
  const city = findByTitle(partnerFields, "city")?.value.trim() ?? null;
  const region = normalizeRegion(findByTitle(partnerFields, "state", "region", "province")?.value ?? null);
  const postal_code = findByTitle(partnerFields, "zip", "postal code", "postal")?.value.trim() ?? null;
  const country = findByTitle(partnerFields, "country")?.value.trim() ?? "US";

  // Treat partial address as a warning.
  if (!address1) warnings.push("Address line 1 not found in PandaDoc");
  if (!city) warnings.push("City not found in PandaDoc");
  if (!region) warnings.push("State/region not found in PandaDoc");
  if (!postal_code) warnings.push("Postal code not found in PandaDoc");
```

**Step 6: Update the `return` object** to include the new fields:

```ts
  return {
    email,
    account_holder_name: accountHolderName,
    routing_number: routingNumber,
    account_number: accountNumber,
    account_type: accountType,
    routing_valid: routingNumber !== null,
    account_valid: accountNumber !== null,
    warnings,
    address1,
    address2,
    city,
    region,
    postal_code,
    country,
  };
```

**Step 7: Verify tests now pass**

```bash
npm test 2>&1 | tail -20
```
Expected: 11/11 pass (8 original + 3 new).

**Step 8: Verify build**

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -5
```

**Step 9: Commit**

```bash
git add src/lib/pandadoc.ts src/lib/pandadoc.test.ts
git commit -m "feat(pandadoc): extract address fields with state normalization

Title-first match on 'address'/'street', 'city', 'state'/'region',
'zip'/'postal', 'country'. State value normalized to 2-letter USPS
abbreviation when possible. Partial address contributes warnings so
the BankPreviewDrawer surfaces gaps to AMs."
```

---

## Phase 2 — Wiring

### Task 4: Refetch-bank route saves address

**Files:**
- Modify: `src/app/api/admin/affiliates/refetch-bank/route.ts`

**Step 1: Extend the `bankPayload` to include address fields**

Find the existing `bankPayload` object. Add (in the same shape — null where not extracted):

```ts
const bankPayload = {
  // ...existing fields...
  address1: bankDetails.address1,
  address2: bankDetails.address2,
  city: bankDetails.city,
  region: bankDetails.region,
  postal_code: bankDetails.postal_code,
  country: bankDetails.country,
};
```

**Step 2: Extend the route's `preview` payload** with the address fields (already returned by extractBankDetails):

```ts
const preview = {
  // ...existing fields...
  address1: bankDetails.address1,
  address2: bankDetails.address2,
  city: bankDetails.city,
  region: bankDetails.region,
  postal_code: bankDetails.postal_code,
  country: bankDetails.country,
};
```

**Step 3: Verify**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/app/api/admin/affiliates/refetch-bank/route.ts
git commit -m "feat(api/refetch-bank): persist + preview address fields"
```

---

### Task 5: BankPreviewDrawer shows address

**Files:**
- Modify: `src/components/admin/BankPreviewDrawer.tsx`

**Step 1: Extend `BankPreview` interface**

Add 6 fields to the existing interface:

```ts
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
```

**Step 2: Render the address block** below the existing preview-fields card, ABOVE the warnings panel.

Insert this block after the `<div className="card p-4 bg-surface-50 space-y-3">…</div>` block:

```tsx
{(preview.address1 || preview.city || preview.region || preview.postal_code) && (
  <div className="card p-4 bg-surface-50 space-y-3">
    <p className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Mailing address (for Mercury)</p>
    <p className="text-sm text-gray-900 leading-relaxed">
      {preview.address1 ?? <span className="text-brand-400">— address 1 missing —</span>}
      {preview.address2 && <><br />{preview.address2}</>}
      <br />
      {preview.city ?? <span className="text-brand-400">— city missing —</span>}
      {", "}
      {preview.region ?? <span className="text-brand-400">— state missing —</span>}
      {" "}
      {preview.postal_code ?? <span className="text-brand-400">— zip missing —</span>}
      <br />
      <span className="text-xs text-brand-400">{preview.country ?? "US"}</span>
    </p>
  </div>
)}
```

**Step 3: Verify**

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -5
```

**Step 4: Commit**

```bash
git add src/components/admin/BankPreviewDrawer.tsx
git commit -m "feat(admin): show mailing address in BankPreviewDrawer"
```

---

### Task 6: `getOrCreateRecipient` accepts address

**Files:**
- Modify: `src/lib/mercury.ts`

**Step 1: Change the signature + body**

Replace the function:

```ts
export interface RecipientAddress {
  address1: string;
  address2?: string | null;
  city: string;
  region: string;       // 2-letter state code (e.g. "WY")
  postalCode: string;
  country: string;      // 2-letter (e.g. "US")
}

export async function getOrCreateRecipient(
  name: string,
  routingNumber: string,
  accountNumber: string,
  address: RecipientAddress,
  email?: string
): Promise<string> {
  const payload = {
    name,
    emails: email ? [email] : ["payouts@kashupay.com"],
    electronicRoutingInfo: {
      accountNumber,
      routingNumber,
      electronicAccountType: "businessChecking",
      address: {
        address1: address.address1,
        address2: address.address2 ?? undefined,
        city: address.city,
        region: address.region,
        postalCode: address.postalCode,
        country: address.country || "US",
      },
    },
  };

  console.log("[mercury] Creating recipient:", JSON.stringify({
    ...payload,
    electronicRoutingInfo: { ...payload.electronicRoutingInfo, accountNumber: "<redacted>" },
  }));

  const data = await mercuryFetch(`/recipients`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  console.log("[mercury] Recipient created:", data.id);
  return data.id;
}
```

Notice the `<redacted>` in the log — the previous version logged the full account number, which is a real PII leak.

**Step 2: Verify**

```bash
npx tsc --noEmit
```
Expected: build will fail at the caller site (execute-batch) because we added a required `address` arg. That's expected; next task fixes it.

**Step 3: Commit**

```bash
git add src/lib/mercury.ts
git commit -m "feat(mercury): getOrCreateRecipient requires address + redacts log"
```

---

### Task 7: Execute-batch passes address + email

**Files:**
- Modify: `src/app/api/admin/payouts/execute-batch/route.ts`

**Step 1: Extend the payout/account fetch to include address fields and affiliate email**

Find the existing `accounts` fetch. The select currently grabs core bank fields. Extend it:

```ts
const { data: accounts } = await svc
  .from("payout_accounts")
  .select("id, affiliate_id, account_name, routing_number, metadata, provider_id, address1, address2, city, region, postal_code, country")
  .in("affiliate_id", affiliateIds)
  .eq("is_default", true);
```

And add an affiliate-email fetch:

```ts
const { data: affEmails } = await svc
  .from("affiliates")
  .select("id, email")
  .in("id", affiliateIds);
type AffEmailRow = { id: string; email: string | null };
const emailByAffiliate = new Map<string, string | null>();
for (const a of (affEmails as AffEmailRow[] | null) ?? []) emailByAffiliate.set(a.id, a.email);
```

**Step 2: Build the address argument + bail with a clear error when address is missing**

Inside the per-payout loop, after looking up the account row:

```ts
if (!account) {
  // existing: skip or fail
  continue;
}

if (!account.address1 || !account.city || !account.region || !account.postal_code) {
  errors.push(`Payout ${payout.id}: payout_account is missing address — affiliate must Re-verify bank from PandaDoc first`);
  continue;
}

const address = {
  address1: account.address1,
  address2: account.address2,
  city: account.city,
  region: account.region,
  postalCode: account.postal_code,
  country: account.country || "US",
};
```

**Step 3: Update the `getOrCreateRecipient` call**

Change:
```ts
recipientId = await getOrCreateRecipient(accountName, routingNumber, accountNumber);
```
to:
```ts
const email = emailByAffiliate.get(payout.affiliate_id) ?? undefined;
recipientId = await getOrCreateRecipient(accountName, routingNumber, accountNumber, address, email ?? undefined);
```

**Step 4: Verify**

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -5
```
Clean.

**Step 5: Commit**

```bash
git add src/app/api/admin/payouts/execute-batch/route.ts
git commit -m "feat(execute-batch): pass affiliate address + email to Mercury

Reads address from payout_accounts and email from affiliates. Skips
payouts whose account is missing address fields with a clear error
that prompts the AM to Re-verify the affiliate's bank from PandaDoc.
This stops every Mercury recipient from being created with Kashu's
Cheyenne, WY address."
```

---

## Phase 3 — Backfill

### Task 8: Backfill script

**Files:**
- Create: `scripts/backfill-payout-account-addresses.ts`

**Step 1: Write the script**

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
// One-shot heal: re-fetches PandaDoc for every payout_account whose
// address columns are null. Saves the extracted address. Skips affiliates
// without pandadoc_id and reports what fields couldn't be extracted.
//
// Run: npx tsx scripts/backfill-payout-account-addresses.ts
// Idempotent: re-run is a no-op for already-filled rows.
import { createClient } from "@supabase/supabase-js";
import { fetchDocumentFields, extractBankDetails } from "../src/lib/pandadoc";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\\n|"|\s/g, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/\\n|"|\s/g, "");
if (!URL || !KEY) { console.error("Missing env"); process.exit(1); }
const supa = createClient(URL, KEY, { auth: { persistSession: false } });

(async () => {
  const { data: accts } = await (supa as any).from("payout_accounts")
    .select("id, affiliate_id, address1, city, region, postal_code")
    .or("address1.is.null,city.is.null,region.is.null,postal_code.is.null");

  console.log(`Found ${(accts ?? []).length} payout_accounts missing address fields.`);
  if (!accts || accts.length === 0) return;

  const affiliateIds = Array.from(new Set(accts.map((a: any) => a.affiliate_id)));
  const { data: affs } = await (supa as any).from("affiliates")
    .select("id, agent_name, pandadoc_id")
    .in("id", affiliateIds);
  const affMap = new Map<string, { agent_name: string; pandadoc_id: string | null }>();
  for (const a of affs ?? []) affMap.set(a.id, a);

  let updated = 0; let skipped = 0;
  for (const acct of accts as any[]) {
    const aff = affMap.get(acct.affiliate_id);
    if (!aff?.pandadoc_id) { skipped++; console.log(`  - ${aff?.agent_name ?? acct.affiliate_id}: no pandadoc_id, skipping`); continue; }

    try {
      const fields = await fetchDocumentFields(aff.pandadoc_id);
      const ex = extractBankDetails(fields);
      const payload: Record<string, unknown> = {};
      if (ex.address1) payload.address1 = ex.address1;
      if (ex.address2) payload.address2 = ex.address2;
      if (ex.city) payload.city = ex.city;
      if (ex.region) payload.region = ex.region;
      if (ex.postal_code) payload.postal_code = ex.postal_code;
      if (ex.country) payload.country = ex.country;
      if (Object.keys(payload).length === 0) { skipped++; console.warn(`  ! ${aff.agent_name}: no address extracted`); continue; }
      payload.updated_at = new Date().toISOString();
      const { error } = await (supa as any).from("payout_accounts").update(payload).eq("id", acct.id);
      if (error) { skipped++; console.error(`  ! ${aff.agent_name}: update failed: ${error.message}`); continue; }
      updated++;
      console.log(`  ✓ ${aff.agent_name}: ${ex.address1}, ${ex.city}, ${ex.region} ${ex.postal_code}`);
    } catch (e) {
      skipped++;
      console.error(`  ! ${aff?.agent_name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\ndone: ${updated} updated, ${skipped} skipped`);
})().catch((e) => { console.error(e); process.exit(1); });
```

**Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit (don't run yet)**

```bash
git add scripts/backfill-payout-account-addresses.ts
git commit -m "feat(scripts): backfill-payout-account-addresses heal"
```

---

### Task 9: Run the backfill against prod

**Step 1: Run**

```bash
set -a; source .env.local; set +a
npx tsx scripts/backfill-payout-account-addresses.ts
```

Expected: log per affiliate, then `done: N updated, M skipped`.

**Step 2: Verify**

```sql
select count(*) from payout_accounts where address1 is not null and city is not null;
select count(*) from payout_accounts where address1 is null;
```

(no commit — runtime step)

---

## Phase 4 — Check route drift

### Task 10: Fix check route to mirror update-status

**Files:**
- Modify: `src/app/api/cron/check-mercury-payouts/route.ts`

**Step 1: Use `payout_id` for the earnings flip (replaces line 84 `affiliate_id` filter)**

Find this block:
```ts
if (newStatus === "completed") {
  await svc
    .from("earnings")
    .update({ status: "paid", updated_at: new Date().toISOString() })
    .eq("affiliate_id", payout.affiliate_id)
    .eq("status", "approved");
}
```

Replace with the same pattern used in `update-status` (PR #5):

```ts
let earningsMarkedPaid = 0;
let airtableUpdated = 0;
const airtableErrors: Array<{ record_id: string; error: string }> = [];

if (newStatus === "completed") {
  const nowIso = new Date().toISOString();
  const { data: paidRows, error: paidError } = await svc
    .from("earnings")
    .update({ status: "paid", updated_at: nowIso })
    .eq("payout_id", payout.id)
    .eq("status", "approved")
    .select("id, transaction_ref");
  if (paidError) {
    console.error("[check-mercury] Mark-paid failed:", paidError);
  } else {
    type PaidRow = { id: string; transaction_ref: string | null };
    const rows = (paidRows ?? []) as PaidRow[];
    earningsMarkedPaid = rows.length;

    // Mirror "Paid" to Airtable Partner Transaction Log. Best-effort.
    const baseId = process.env.AIRTABLE_LAUNCH_BASE;
    const recordIds = rows.map((r) => r.transaction_ref).filter((r): r is string => !!r);
    if (baseId && recordIds.length > 0) {
      try {
        const patch = await patchRecords(
          baseId,
          AIRTABLE_TRANSACTIONS_TABLE_ID,
          recordIds.map((id) => ({
            id,
            fields: { [COMMISSION_STATUS_FIELD]: COMMISSION_STATUS_PAID_VALUE },
          })),
        );
        airtableUpdated = patch.updated;
        airtableErrors.push(...patch.failed);
      } catch (e) {
        airtableErrors.push({ record_id: "(setup)", error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
}
```

**Step 2: Add the Airtable imports + constants** at the top of the file, mirroring `update-status`:

```ts
import { patchRecords } from "@/lib/airtable";

const AIRTABLE_TRANSACTIONS_TABLE_ID = "tblyWtDBeiZAqDm8P";
const COMMISSION_STATUS_FIELD = "Commission Status";
const COMMISSION_STATUS_PAID_VALUE = "Paid";
```

**Step 3: Verify**

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -5
```

**Step 4: Commit**

```bash
git add src/app/api/cron/check-mercury-payouts/route.ts
git commit -m "fix(cron/check-mercury): align with update-status

Two behavioral fixes to the cron route that flips processing → completed
when Mercury reports a transaction as sent:
1. Earnings flip uses payout_id (not affiliate_id) — matches update-status
   and avoids over-flipping unrelated approved earnings for the affiliate.
2. Adds Airtable Commission Status='Paid' mirror, same as update-status
   (PR #6). Best-effort: failures logged but don't block the DB update."
```

---

## Phase 5 — Verification

### Task 11: Full verification matrix

**Step 1: Build + types + tests**

```bash
npm test 2>&1 | tail -5
npx tsc --noEmit && npm run build 2>&1 | tail -5
```

All clean. Tests: 11/11 pass.

**Step 2: Manual smoke**

| Surface | Expectation |
|---|---|
| `/admin/affiliates` Re-verify on an affiliate | Drawer now shows a Mailing Address card with the extracted address |
| Backfill ran | `select count(*) from payout_accounts where address1 is not null` shows the heal count |
| Try execute-batch with a payout whose account has no address1 | Returns an error like "missing address — affiliate must Re-verify"; does NOT create a Mercury recipient with Kashu's address |
| Check cron route called against a completed payout | Earnings link via `payout_id`; Airtable record's Commission Status flips to Paid |

**Step 3: Spot-check Mercury console**

After the next real payout execution, look at the Mercury recipient: the address should match what came from the affiliate's PandaDoc, NOT `1603 Capitol Ave Ste 415, Cheyenne, WY`.

---

### Task 12: Open PR

```bash
git push -u origin feat/mercury-recipient-address-and-check-drift
gh pr create --title "feat(mercury): affiliate address + check-route drift fix" --body "$(cat <<'EOF'
## Summary
- Every Mercury recipient was being created with Kashu's Cheyenne, WY address. Now pulls address from the affiliate's signed PandaDoc and stores it on payout_accounts.
- The cron check-mercury-payouts route had two consistency bugs vs update-status: marked earnings paid by affiliate_id (over-flips), and didn't mirror Commission Status to Airtable. Both fixed.

## Stores
- New columns on payout_accounts: address1, address2, city, region, postal_code, country (default US)
- Backfill script runs once to heal existing rows from their PandaDoc

## Verification
- 11/11 unit tests pass (3 new for address extraction)
- Build clean
- Backfill ran successfully against prod (N rows updated)

## Test plan
- [ ] /admin/affiliates Re-verify shows mailing-address card in drawer
- [ ] execute-batch refuses when account is missing address fields
- [ ] New Mercury recipient created via execute-batch has affiliate's address (verify in Mercury console)
- [ ] Cron check-mercury-payouts updates Airtable Commission Status to Paid when flipping to completed
EOF
)"
```

---

## Decisions to keep top-of-mind during execution

- **One commit per task.** Frequent commits make rollback easy.
- **No new DB triggers.** Convention: app-side updates only.
- **`text-brand-400`, not `text-gray-500`** (CLAUDE.md §2 banned classes).
- **Redact full account numbers in logs** (Task 6 fixes a pre-existing PII leak).
- **Address fields are nullable** so existing rows aren't broken; backfill heals; execute-batch refuses to proceed without a valid address.
- **State normalization** maps full names ("Colorado") and abbreviations ("CO") to the 2-letter USPS code. Unknown values pass through untouched (for international or typos).
