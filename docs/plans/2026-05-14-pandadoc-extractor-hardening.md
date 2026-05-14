# PandaDoc Bank-Detail Extractor Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop the PandaDoc bank-detail extractor from picking up phone numbers as account numbers (and radio-option labels as holder names). Lock down behavior with unit tests so this regression cannot happen silently again.

**Architecture:** Replace the current value-only heuristic with title-first extraction: prefer fields whose `title`/`name` explicitly identifies them (e.g. contains "account number", "routing", "phone"). Fall back to value-shape matching only for fields whose role is ambiguous. Add explicit anti-patterns (phone-shaped 10-digit numbers with dash formatting, "Option N" labels, etc.) that produce a hard-refuse on extraction. Surface structured `warnings` in the result so the preview drawer can highlight suspicious extractions even when validation technically passes.

**Tech Stack:** TypeScript pure function (`src/lib/pandadoc.ts`). Tests via `node:test` runner invoked through `tsx` (zero new package deps). No DB / network in tests; we use fabricated PandaDocField fixtures.

**Reference:** root cause traced in chat — `extractBankDetails` in `src/lib/pandadoc.ts` accepts any 4-17 digit string as an account number and "longest wins" gives the phone field priority. Holder-name selection is positional (`partnerFields[routingFieldIndex - 1]`), so radio-button option labels appearing before the routing field get captured. Real symptoms in prod (2026-05-14):

- John Maybin: `account_name = "Option 1"` (radio option leaked into name slot)
- David Warren-Mitchell: account number extracted matched a phone number on the form

---

## Phase 0 — Test infrastructure (one-shot)

### Task 1: Add test runner script

**Files:**
- Modify: `package.json` (one line added to `scripts`)

**Step 1: Inspect current scripts block**

```bash
grep -n '"scripts":' -A 8 package.json | head -12
```

**Step 2: Add a `test` script using node's built-in runner via tsx**

In the `scripts` block, add:
```json
"test": "tsx --test 'src/**/*.test.ts'"
```

`tsx` is already a project dep (used by `scripts/upload-affiliate-content.ts` and `scripts/seed-share-templates.ts`). `node:test` ships with Node 18+. Zero new dependencies.

**Step 3: Verify runner picks up nothing yet (no tests yet)**

```bash
npm test 2>&1 | tail -10
```
Expected: exits cleanly with `ok 0` or "no test files matched". Either is fine.

**Step 4: Commit**

```bash
git add package.json
git commit -m "chore(test): wire tsx --test runner via node:test"
```

---

## Phase 1 — Lock the bug down with failing tests

### Task 2: Create test file with fixtures + failing tests for the live bugs

**Files:**
- Create: `src/lib/pandadoc.test.ts`

**Step 1: Write the test file**

```ts
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { extractBankDetails, type PandaDocField } from "./pandadoc";

// Helper to build a PandaDoc field with sensible defaults.
function f(value: string, opts: Partial<PandaDocField> = {}): PandaDocField {
  return {
    uuid: opts.uuid ?? Math.random().toString(36).slice(2),
    name: opts.name ?? "Text",
    title: opts.title,
    value,
    type: opts.type ?? "text",
    assigned_to: opts.assigned_to ?? { role: "Partner" },
    ...opts,
  };
}

describe("extractBankDetails — regressions from 2026-05-14", () => {
  it("does NOT pick a phone number as the account number (David's bug)", () => {
    // Fixture mirrors what David's PandaDoc looked like: a phone field appearing
    // before the actual account number field. Phone is 10 digits and passes the
    // old length-only check.
    const fields: PandaDocField[] = [
      f("David Warren-Mitchell", { title: "Account Holder Name" }),
      f("111000614", { title: "Routing Number" }),
      f("(212) 555-0143", { title: "Phone Number" }),
      f("6122695954", { title: "Account Number" }),
      f("savings", { type: "radio_buttons", title: "Account Type" }),
    ];

    const result = extractBankDetails(fields);

    assert.equal(
      result.account_number,
      "6122695954",
      "should pick the field titled 'Account Number', not the phone",
    );
    assert.equal(result.routing_number, "111000614");
    assert.equal(result.account_holder_name, "David Warren-Mitchell");
    assert.equal(result.account_type, "savings");
  });

  it("does NOT use a radio option label as the holder name (John's bug)", () => {
    // John's PandaDoc has the radio-button field for account type appearing
    // before the routing field, AND its rendered value is "Option 1". The old
    // extractor took partnerFields[routingFieldIndex - 1].value verbatim.
    const fields: PandaDocField[] = [
      f("John Maybin", { title: "Account Holder Name" }),
      f("Option 1", { type: "radio_buttons", title: "Account Type" }),
      f("063100277", { title: "Routing Number" }),
      f("229032616049", { title: "Account Number" }),
    ];

    const result = extractBankDetails(fields);

    assert.equal(
      result.account_holder_name,
      "John Maybin",
      "should pick the field titled 'Account Holder Name', not the radio label",
    );
    assert.notEqual(result.account_holder_name, "Option 1");
    assert.equal(result.account_number, "229032616049");
    assert.equal(result.account_type, "checking");
  });

  it("rejects a value that looks like a US phone even when it's the only candidate", () => {
    // Pure-phone fixture: no other digit field. We'd rather return account_valid=false
    // than save a phone as the account number.
    const fields: PandaDocField[] = [
      f("Jane Test", { title: "Account Holder Name" }),
      f("111000614", { title: "Routing Number" }),
      f("(212) 555-0143", { title: "Phone Number" }),
    ];

    const result = extractBankDetails(fields);

    assert.equal(result.account_number, null);
    assert.equal(result.account_valid, false);
    assert.ok(result.warnings && result.warnings.length > 0, "should warn that no valid account number was found");
  });
});

describe("extractBankDetails — happy path", () => {
  it("extracts cleanly when all titles are present", () => {
    const fields: PandaDocField[] = [
      f("alex@example.com", { title: "Email" }),
      f("Alex Rivera", { title: "Account Holder Name" }),
      f("121000358", { title: "Routing Number" }),
      f("000123456789", { title: "Account Number" }),
      f("checking", { type: "radio_buttons", title: "Account Type" }),
    ];

    const result = extractBankDetails(fields);

    assert.equal(result.email, "alex@example.com");
    assert.equal(result.account_holder_name, "Alex Rivera");
    assert.equal(result.routing_number, "121000358");
    assert.equal(result.account_number, "000123456789");
    assert.equal(result.account_type, "checking");
    assert.equal(result.routing_valid, true);
    assert.equal(result.account_valid, true);
  });

  it("falls back to value-shape when titles are missing", () => {
    // Older PandaDoc templates may not have title set on fields. We still want
    // to extract correctly, just with a warning attached.
    const fields: PandaDocField[] = [
      f("alex@example.com"),
      f("Alex Rivera"),
      f("121000358"),
      f("000123456789"),
    ];

    const result = extractBankDetails(fields);

    assert.equal(result.routing_number, "121000358");
    assert.equal(result.account_number, "000123456789");
    assert.ok(
      result.warnings && result.warnings.some((w) => w.toLowerCase().includes("title")),
      "should warn about extracting via value-shape fallback",
    );
  });

  it("warns when account holder name looks suspicious (Option N pattern)", () => {
    const fields: PandaDocField[] = [
      f("Option 2", { title: "Account Holder Name" }),
      f("121000358", { title: "Routing Number" }),
      f("000123456789", { title: "Account Number" }),
    ];

    const result = extractBankDetails(fields);

    // Even if the title is "Account Holder Name", an Option-N value should
    // trigger a warning (likely the form was filled with the wrong widget).
    assert.ok(
      result.warnings && result.warnings.some((w) => w.toLowerCase().includes("name")),
      "should warn when holder name matches Option N pattern",
    );
  });
});
```

**Step 2: Run the tests — expect ALL to fail except possibly the first happy-path test, since `warnings` isn't on the result type yet**

```bash
npm test 2>&1 | tail -40
```
Expected: multiple failures with messages like "Cannot read property 'warnings' of undefined" or assertion mismatches on account_number / account_holder_name.

**Step 3: Commit the failing tests**

```bash
git add src/lib/pandadoc.test.ts
git commit -m "test(pandadoc): failing tests capturing extractor regressions

Two production bugs reproduced as fixtures:
- David: a US phone field bled into account number slot
- John: a radio-option label landed as holder name

These tests fail today. Phase 2 makes them pass."
```

---

## Phase 2 — Title-first extraction with anti-patterns

### Task 3: Add `warnings` to the result type

**Files:**
- Modify: `src/lib/pandadoc.ts` (extend `ExtractedBankDetails` interface)

**Step 1: Find the interface**

```bash
grep -n "ExtractedBankDetails" src/lib/pandadoc.ts | head -5
```

**Step 2: Add `warnings: string[]` to the interface**

Find:
```ts
export interface ExtractedBankDetails {
  email: string | null;
  account_holder_name: string | null;
  routing_number: string | null;
  account_number: string | null;
  account_type: "checking" | "savings" | null;
  routing_valid: boolean;
  account_valid: boolean;
}
```
Add `warnings: string[];` as a new required field:
```ts
export interface ExtractedBankDetails {
  email: string | null;
  account_holder_name: string | null;
  routing_number: string | null;
  account_number: string | null;
  account_type: "checking" | "savings" | null;
  routing_valid: boolean;
  account_valid: boolean;
  warnings: string[];
}
```

**Step 3: Update the existing `return` in `extractBankDetails` to include `warnings: []`** (temporary placeholder; Phase 2 fills it in)

```ts
return {
  email,
  account_holder_name: accountHolderName,
  routing_number: routingNumber,
  account_number: accountNumber,
  account_type: accountType,
  routing_valid: routingNumber !== null,
  account_valid: accountNumber !== null,
  warnings: [],
};
```

**Step 4: Verify the type change compiles + a few tests are now able to RUN (they still fail on assertions)**

```bash
npx tsc --noEmit
npm test 2>&1 | tail -10
```
Expected: tsc clean. Some test failures shift from "Cannot read property" to assertion mismatches.

**Step 5: Commit**

```bash
git add src/lib/pandadoc.ts
git commit -m "feat(pandadoc): add warnings[] to ExtractedBankDetails"
```

---

### Task 4: Title-based extraction helpers

**Files:**
- Modify: `src/lib/pandadoc.ts` (add helpers near the top of the Extraction section)

**Step 1: Add helpers below `extractBankDetails` declaration line, BEFORE the existing function body**

Insert these helpers (they're pure; no state):

```ts
// ---------------------------------------------------------------------------
// Field-matching helpers — prefer fields whose title/name explicitly identifies
// what they are. Title matching is much more reliable than value-shape because
// PandaDoc templates can have multiple digit fields (phone, SSN, account, etc).
// ---------------------------------------------------------------------------

function titleMatches(field: PandaDocField, ...needles: string[]): boolean {
  const hay = `${field.title ?? ""} ${field.name ?? ""}`.toLowerCase();
  return needles.some((n) => hay.includes(n.toLowerCase()));
}

function findByTitle(
  fields: PandaDocField[],
  ...needles: string[]
): PandaDocField | undefined {
  return fields.find((f) => titleMatches(f, ...needles));
}

/**
 * Reject 10/11-digit strings that "smell like a US phone". Heuristic — a
 * routing number can also be 9 digits, so this is account-number specific.
 *
 * Phone-shaped if the ORIGINAL value contains common phone formatting OR if
 * after stripping it's 10 digits long (length 11 with leading 1 also counts).
 */
function looksLikeUsPhone(originalValue: string, cleanedDigits: string): boolean {
  const trimmed = originalValue.trim();

  // Strong signals from formatting
  if (/^\+?1?\s*\(\d{3}\)\s*\d{3}[\s-]?\d{4}$/.test(trimmed)) return true; // (212) 555-0143
  if (/^\+?1[\s-]\d{3}[\s-]\d{3}[\s-]\d{4}$/.test(trimmed)) return true;   // +1 212-555-0143
  if (/^\d{3}[\s-]\d{3}[\s-]\d{4}$/.test(trimmed)) return true;            // 212-555-0143

  // Weaker: bare 10 digits, or 11 digits with leading 1
  if (cleanedDigits.length === 10) return true;
  if (cleanedDigits.length === 11 && cleanedDigits.startsWith("1")) return true;

  return false;
}

/**
 * Reject values that are clearly form-widget artefacts rather than human names.
 */
function looksLikeWidgetLabel(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (/^option\s*\d+$/i.test(v)) return true;       // "Option 1"
  if (/^choice\s*\d+$/i.test(v)) return true;       // "Choice 2"
  if (/^(yes|no|n\/a|na)$/i.test(v)) return true;   // boolean labels
  if (/^\d+$/.test(v)) return true;                 // purely numeric
  return false;
}

/**
 * Person-name heuristic: at least 2 alphabetic tokens, total ≥ 4 chars,
 * mostly letters (allow apostrophes, hyphens, periods, spaces).
 */
function looksLikePersonName(value: string): boolean {
  const v = value.trim();
  if (v.length < 4) return false;
  if (looksLikeWidgetLabel(v)) return false;
  const alphaTokens = v.split(/[\s.]+/).filter((t) => /^[a-zA-Z'\-]+$/.test(t));
  return alphaTokens.length >= 2;
}
```

**Step 2: Verify compile**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/lib/pandadoc.ts
git commit -m "feat(pandadoc): title-matching + anti-pattern helpers"
```

---

### Task 5: Rewrite `extractBankDetails` to use title-first matching

**Files:**
- Modify: `src/lib/pandadoc.ts` (rewrite the function body)

**Step 1: Replace the function body**

Locate the existing `extractBankDetails` function. Replace its body (everything between `{` after the parameter list and the matching `}`) with this:

```ts
  const warnings: string[] = [];

  // 1. Filter to Partner-role fields with non-empty values
  const partnerFields = fields.filter((f) => {
    const hasValue = typeof f.value === "string" && f.value.trim() !== "";
    const isPartnerRole =
      !f.assigned_to?.role ||
      f.assigned_to.role.toLowerCase().includes("partner") ||
      f.assigned_to.role.toLowerCase().includes("affiliate");
    return hasValue && isPartnerRole;
  });

  // 2. ROUTING NUMBER — try title first ("routing"), then value-shape fallback.
  let routingNumber: string | null = null;
  const routingFromTitle = findByTitle(partnerFields, "routing");
  if (routingFromTitle) {
    const cleaned = cleanRoutingNumber(routingFromTitle.value);
    if (/^\d{9}$/.test(cleaned) && validateRoutingNumber(cleaned).valid) {
      routingNumber = cleaned;
    } else {
      warnings.push("Field titled 'routing' did not pass ABA validation");
    }
  }
  if (!routingNumber) {
    for (const f of partnerFields) {
      const cleaned = cleanRoutingNumber(f.value);
      if (/^\d{9}$/.test(cleaned) && validateRoutingNumber(cleaned).valid) {
        routingNumber = cleaned;
        if (!routingFromTitle) {
          warnings.push("Routing number extracted by value-shape (no titled field found)");
        }
        break;
      }
    }
  }

  // 3. ACCOUNT NUMBER — title first ("account number" but NOT containing "routing"),
  //    explicitly reject phone-shaped values. Value-shape fallback excludes phones.
  let accountNumber: string | null = null;
  const accountFromTitle = partnerFields.find(
    (f) =>
      titleMatches(f, "account number", "acct number", "acct no") &&
      !titleMatches(f, "routing"),
  );
  if (accountFromTitle) {
    const cleaned = cleanAccountNumber(accountFromTitle.value);
    if (looksLikeUsPhone(accountFromTitle.value, cleaned)) {
      warnings.push("Field titled 'account number' contains a phone-shaped value — refusing");
    } else if (
      /^\d{4,17}$/.test(cleaned) &&
      cleaned !== routingNumber &&
      validateAccountNumber(cleaned).valid
    ) {
      accountNumber = cleaned;
    } else {
      warnings.push("Field titled 'account number' failed format validation");
    }
  }
  if (!accountNumber) {
    // Value-shape fallback: digit fields that are NOT routing, NOT in a field
    // titled 'phone'/'cell'/'tel'/'ssn', NOT phone-shaped.
    const candidates: { value: string; length: number; field: PandaDocField }[] = [];
    for (const f of partnerFields) {
      if (titleMatches(f, "phone", "telephone", "cell", "mobile", "ssn", "social security")) continue;
      const cleaned = cleanAccountNumber(f.value);
      if (!/^\d{4,17}$/.test(cleaned)) continue;
      if (cleaned === routingNumber) continue;
      if (!validateAccountNumber(cleaned).valid) continue;
      if (looksLikeUsPhone(f.value, cleaned)) continue;
      candidates.push({ value: cleaned, length: cleaned.length, field: f });
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.length - a.length);
      accountNumber = candidates[0].value;
      if (!accountFromTitle) {
        warnings.push("Account number extracted by value-shape (no titled field found)");
      }
    } else if (!accountFromTitle) {
      warnings.push("No valid account number could be extracted");
    }
  }

  // 4. EMAIL — first text value containing "@", prefer titled fields
  let email: string | null = null;
  const emailFromTitle = findByTitle(partnerFields, "email", "e-mail");
  if (emailFromTitle && emailFromTitle.value.includes("@")) {
    email = emailFromTitle.value.trim();
  } else {
    for (const f of partnerFields) {
      if (f.value.includes("@")) {
        email = f.value.trim();
        break;
      }
    }
  }

  // 5. ACCOUNT HOLDER NAME — title first ("name" / "account holder" / "payee"),
  //    validate person-name shape, warn on widget labels.
  let accountHolderName: string | null = null;
  const nameFromTitle = partnerFields.find(
    (f) =>
      (titleMatches(f, "account holder", "account name", "payee", "beneficiary") ||
        (titleMatches(f, "name") && !titleMatches(f, "company", "business", "doing business"))),
  );
  if (nameFromTitle) {
    const candidate = nameFromTitle.value.trim();
    if (looksLikeWidgetLabel(candidate)) {
      warnings.push(`Field titled '${nameFromTitle.title ?? "name"}' contains a widget label ('${candidate}'); skipping`);
    } else {
      accountHolderName = candidate;
      if (!looksLikePersonName(candidate)) {
        warnings.push(`Account holder name '${candidate}' may not be a person's name`);
      }
    }
  }
  if (!accountHolderName) {
    // Fallback: scan all partner fields for the first person-name-shaped value.
    for (const f of partnerFields) {
      if (looksLikePersonName(f.value)) {
        accountHolderName = f.value.trim();
        if (!nameFromTitle) {
          warnings.push("Account holder name extracted by value-shape (no titled field found)");
        }
        break;
      }
    }
  }

  // 6. ACCOUNT TYPE — prefer radio with title matching "type" / "account type".
  //    Fall back to any radio that maps cleanly to checking/savings.
  let accountType: "checking" | "savings" | null = null;
  const typeRadios = fields.filter((f) => {
    const t = (f.type ?? "").toLowerCase();
    return t === "radio_buttons" || t === "radio";
  });
  const typedRadio = typeRadios.find((f) =>
    titleMatches(f, "account type", "checking or savings", "deposit type"),
  );
  const radioToCheck = typedRadio ?? typeRadios[0];
  if (radioToCheck) {
    const val = (radioToCheck.value ?? "").trim().toLowerCase();
    if (val === "checking" || val.includes("checking")) {
      accountType = "checking";
    } else if (val === "savings" || val.includes("savings")) {
      accountType = "savings";
    } else if (val.includes("option 1")) {
      accountType = "checking";
      if (!typedRadio) {
        warnings.push("Account type mapped from generic 'option 1' (no titled type radio found)");
      }
    } else if (val.includes("option 2")) {
      accountType = "savings";
      if (!typedRadio) {
        warnings.push("Account type mapped from generic 'option 2' (no titled type radio found)");
      }
    }
  }

  return {
    email,
    account_holder_name: accountHolderName,
    routing_number: routingNumber,
    account_number: accountNumber,
    account_type: accountType,
    routing_valid: routingNumber !== null,
    account_valid: accountNumber !== null,
    warnings,
  };
```

**Step 2: Run tests — all should pass now**

```bash
npm test 2>&1 | tail -25
```
Expected: all 7 tests pass.

If any fail:
- Read the assertion to understand what the new code returned vs expected
- Verify the helper logic — most likely a titleMatches() boundary
- Adjust helper, re-run

**Step 3: Verify nothing else regressed**

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -5
```
Expected: tsc clean, build clean.

**Step 4: Commit**

```bash
git add src/lib/pandadoc.ts
git commit -m "feat(pandadoc): title-first extraction with phone exclusion

Stops two production bugs (2026-05-14):
1. Account number extractor was picking up phone numbers (10-digit strings
   passed validateAccountNumber unchanged). New version prefers fields
   titled 'account number', explicitly excludes phone-titled fields,
   and rejects values matching phone formatting.
2. Holder name was taken from the field positionally before routing, so
   radio-option labels ('Option 1') landed in the name slot. New version
   prefers fields titled 'account holder name', validates person-name
   shape, and warns when a widget label appears.

Result type now includes warnings: string[] so the preview drawer can
surface 'extracted via fallback' / 'looks suspicious' signals to AMs
even when validation technically passes."
```

---

## Phase 3 — Surface warnings in the preview drawer

### Task 6: Display `warnings[]` in `BankPreviewDrawer`

**Files:**
- Modify: `src/components/admin/BankPreviewDrawer.tsx`
- Modify: `src/app/api/admin/affiliates/refetch-bank/route.ts`

**Step 1: Pass warnings through the API response**

Find the preview-builder block in `refetch-bank/route.ts`:

```ts
const preview = {
  account_holder_name: bankDetails.account_holder_name,
  routing_number: bankDetails.routing_number,
  account_number_last4: bankDetails.account_number ? bankDetails.account_number.slice(-4) : null,
  account_type: bankDetails.account_type,
  routing_valid: bankDetails.routing_valid,
  account_valid: bankDetails.account_valid,
};
```

Add `warnings`:

```ts
const preview = {
  account_holder_name: bankDetails.account_holder_name,
  routing_number: bankDetails.routing_number,
  account_number_last4: bankDetails.account_number ? bankDetails.account_number.slice(-4) : null,
  account_type: bankDetails.account_type,
  routing_valid: bankDetails.routing_valid,
  account_valid: bankDetails.account_valid,
  warnings: bankDetails.warnings,
};
```

**Step 2: Extend the BankPreview type in the drawer**

In `src/components/admin/BankPreviewDrawer.tsx`, find the `BankPreview` interface and add:

```ts
export interface BankPreview {
  account_holder_name: string | null;
  routing_number: string | null;
  account_number_last4: string | null;
  account_type: "checking" | "savings" | null;
  routing_valid: boolean;
  account_valid: boolean;
  warnings: string[];
}
```

**Step 3: Render warnings panel in the drawer JSX**

Find the `<div className="card p-4 bg-surface-50 space-y-3">…</div>` block (the preview-fields card). Right after it (before the "Open in PandaDoc" link), add a conditional warnings panel:

```tsx
{preview.warnings.length > 0 && (
  <div className="card p-3 bg-amber-50 border-amber-200">
    <p className="text-[10px] font-bold text-amber-900 uppercase tracking-wider mb-2">
      Extraction warnings
    </p>
    <ul className="space-y-1">
      {preview.warnings.map((w, i) => (
        <li key={i} className="text-xs text-amber-900 leading-snug flex gap-2">
          <span aria-hidden>⚠</span>
          <span>{w}</span>
        </li>
      ))}
    </ul>
    <p className="text-[10px] text-amber-700 mt-2 italic leading-snug">
      Compare against the source PandaDoc carefully before confirming.
    </p>
  </div>
)}
```

**Step 4: Verify the AffiliateTable + BatchBuilderSection callers pass-through the new field**

`BankPreview` was already imported from the drawer module in both places. As long as the route returns the new field, the drawer renders it — no changes needed in the caller files.

**Step 5: Verify everything builds**

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -5
npm test 2>&1 | tail -5
```
Expected: all clean, tests still pass.

**Step 6: Commit**

```bash
git add src/components/admin/BankPreviewDrawer.tsx src/app/api/admin/affiliates/refetch-bank/route.ts
git commit -m "feat(admin): surface PandaDoc extraction warnings in preview drawer

Warnings array from extractBankDetails is now plumbed through the
refetch-bank route into BankPreviewDrawer. When the extractor used a
value-shape fallback or detected a widget-label / phone-shaped value,
the AM sees an amber callout in the drawer above the Confirm button."
```

---

## Phase 4 — Backfill audit (verify nothing already wrong is invisible)

### Task 7: Add a one-shot audit script for existing payout_accounts

**Files:**
- Create: `scripts/audit-payout-accounts.ts`

**Step 1: Write the script**

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
// Flags existing payout_accounts whose stored full_account_number (in metadata)
// looks like a phone number or other obviously-bad shape. Read-only — does NOT
// modify rows. Prints rows the AM should re-verify via the drawer.
//
// Run: npx tsx scripts/audit-payout-accounts.ts
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\\n|"|\s/g, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/\\n|"|\s/g, "");
if (!URL || !KEY) { console.error("Missing env"); process.exit(1); }
const supa = createClient(URL, KEY, { auth: { persistSession: false } });

function looksLikeUsPhone(value: string, cleaned: string): boolean {
  const trimmed = value.trim();
  if (/^\+?1?\s*\(\d{3}\)\s*\d{3}[\s-]?\d{4}$/.test(trimmed)) return true;
  if (/^\+?1[\s-]\d{3}[\s-]\d{3}[\s-]\d{4}$/.test(trimmed)) return true;
  if (/^\d{3}[\s-]\d{3}[\s-]\d{4}$/.test(trimmed)) return true;
  if (cleaned.length === 10) return true;
  if (cleaned.length === 11 && cleaned.startsWith("1")) return true;
  return false;
}

function looksLikeWidgetLabel(v: string): boolean {
  return /^option\s*\d+$/i.test(v.trim()) || /^choice\s*\d+$/i.test(v.trim());
}

(async () => {
  const { data, error } = await (supa as any)
    .from("payout_accounts")
    .select("id, affiliate_id, account_name, account_number_last4, routing_number, metadata, created_at")
    .order("created_at", { ascending: false });
  if (error) { console.error(error); process.exit(1); }

  type Row = {
    id: string; affiliate_id: string; account_name: string | null;
    account_number_last4: string | null; routing_number: string | null;
    metadata: { full_account_number?: string } | null; created_at: string;
  };

  const flagged: { row: Row; reasons: string[] }[] = [];
  for (const row of (data ?? []) as Row[]) {
    const reasons: string[] = [];
    const full = row.metadata?.full_account_number ?? "";
    const cleaned = full.replace(/[\s\-]/g, "");
    if (full && looksLikeUsPhone(full, cleaned)) {
      reasons.push("full_account_number looks phone-shaped");
    }
    if (row.account_name && looksLikeWidgetLabel(row.account_name)) {
      reasons.push(`account_name is a widget label ('${row.account_name}')`);
    }
    if (reasons.length > 0) flagged.push({ row, reasons });
  }

  console.log(`Audited ${(data ?? []).length} payout_accounts. ${flagged.length} flagged.`);
  for (const f of flagged) {
    console.log("---");
    console.log(`  id:          ${f.row.id}`);
    console.log(`  affiliate:   ${f.row.affiliate_id}`);
    console.log(`  name:        ${f.row.account_name}`);
    console.log(`  last4:       ${f.row.account_number_last4}`);
    console.log(`  routing:     ${f.row.routing_number}`);
    console.log(`  created:     ${f.row.created_at}`);
    console.log(`  reasons:     ${f.reasons.join("; ")}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
```

**Step 2: Compile + commit (don't run yet)**

```bash
npx tsc --noEmit
git add scripts/audit-payout-accounts.ts
git commit -m "feat(scripts): audit-payout-accounts read-only flag check"
```

---

### Task 8: Run the audit + recover David/John

**Step 1: Run**

```bash
set -a; source .env.local; set +a
npx tsx scripts/audit-payout-accounts.ts
```
Expected: At least David's row flagged (phone-shaped full_account_number), and John's row flagged (`account_name = "Option 1"`).

**Step 2: For each flagged row, the AM uses the Re-verify button**

This is operational, not code. Go to `/admin/affiliates`, click Re-verify next to each flagged row. The drawer now shows extraction warnings if the underlying PandaDoc still pulls bad fields; AM compares to source contract via the "Open in PandaDoc" link.

If the new extractor returns valid data (no phone, real name): Confirm. The row updates.

If the new extractor still returns bad/incomplete data (rare — usually means the PandaDoc template is genuinely malformed for that affiliate): Cancel. We'll need a manual-entry fallback for those — out of scope for this plan, queued as a follow-up.

(No commit — operational verification.)

---

## Phase 5 — Push + PR

### Task 9: Push branch + open PR

```bash
git push -u origin feat/pandadoc-extractor-hardening
gh pr create --title "fix(pandadoc): title-first extractor + phone exclusion + warnings" --body "$(cat <<'EOF'
## Summary
Two real production bugs (2026-05-14):

- **David Warren-Mitchell**: the extractor took his **phone number** as the account number. Old code accepted any 4-17 digit string and "longest wins" — a 10-digit phone (after dash stripping) beat the actual account.
- **John Maybin**: his `account_name` saved as **"Option 1"** because the radio-button option label appeared positionally before the routing number, and the old extractor took `partnerFields[routingFieldIndex - 1].value` verbatim.

## Fix
- **Title-first extraction**: prefer fields whose PandaDoc `title`/`name` explicitly identifies them (e.g. contains "account number", "routing", "account holder"). Value-shape is the fallback only.
- **Phone exclusion**: dedicated `looksLikeUsPhone()` rejects values with phone formatting OR bare 10-digit / leading-1 11-digit strings, AND skips fields titled "phone"/"cell"/"telephone"/"mobile"/"ssn".
- **Widget-label rejection**: holder name must look like a person name (≥2 alphabetic tokens). "Option N" / "Choice N" / pure-numeric values get rejected with a warning.
- **Structured warnings**: `ExtractedBankDetails.warnings: string[]` surfaces "extracted via fallback" / "looks suspicious" signals. New amber panel in `BankPreviewDrawer` displays them above Confirm.
- **Tests**: `src/lib/pandadoc.test.ts` locks David's + John's scenarios as fixtures so this regression cannot return silently. Runner: `npm test` via `tsx --test`.
- **Audit script**: `scripts/audit-payout-accounts.ts` flags existing rows with phone-shaped numbers or widget-label names (read-only).

## Test plan
- [ ] `npm test` — all extractor tests pass
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run build` clean
- [ ] AM clicks Re-verify on David → drawer shows correct account number (not phone) + maybe a "warnings" panel if the PandaDoc is unusual
- [ ] AM clicks Re-verify on John → drawer shows real name, not "Option 1"
- [ ] Run `scripts/audit-payout-accounts.ts` — should flag both rows pre-fix
- [ ] After re-verify, run audit again — flagged count should drop

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Decisions to keep top-of-mind during execution

- **Tests are the lock** — if the extractor changes in the future, the fixtures fail and we know immediately. Don't relax any test to make the implementation simpler.
- **Title-first, value-shape as fallback** — the moment a PandaDoc template has clear titles, we should be using them. Only legacy templates without titles fall back to shape.
- **Warnings, not errors** — when extraction is ambiguous, we warn and let the AM decide via the preview drawer. We don't auto-reject the whole flow because that strands the AM with no path forward.
- **Don't auto-overwrite existing payout_accounts in this PR** — the audit script is read-only and flags rows, but the AM uses the existing Re-verify button to correct them with a human in the loop.
