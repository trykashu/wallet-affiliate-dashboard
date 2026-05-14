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

  it("rejects a dash-formatted phone number as account number", () => {
    // Real production failure: phone written as 212-555-0143, no parens, no title.
    // Current cleanAccountNumber strips dashes → 2125550143 → passes 4-17 digit check.
    // Old extractor would pick this as the account number.
    const fields: PandaDocField[] = [
      f("David Warren-Mitchell", { title: "Account Holder Name" }),
      f("111000614", { title: "Routing Number" }),
      f("212-555-0143", { title: "Phone Number" }),
      f("6122695954", { title: "Account Number" }),
    ];

    const result = extractBankDetails(fields);

    assert.equal(result.account_number, "6122695954");
    assert.notEqual(result.account_number, "2125550143");
  });

  it("rejects a bare 10-digit phone number as account number (no formatting, no title)", () => {
    // Worst case: phone appears without formatting AND without title hint.
    // Only the phone-shape heuristic + value-context can save us.
    const fields: PandaDocField[] = [
      f("David Warren-Mitchell"),
      f("111000614"),
      f("2125550143"),   // a bare 10-digit number that's actually a phone
      f("6122695954"),   // a 10-digit number that's actually an account
    ];

    const result = extractBankDetails(fields);

    // Both values clean to 10 digits. The phone-shape heuristic should reject
    // BOTH as phone-shaped... but we still want an account number when one
    // exists. Acceptable outcomes:
    //   (a) account_number = "6122695954" (the second one, somehow disambiguated)
    //   (b) account_number = null with a warning (no clear winner; AM must verify)
    // We do NOT want the phone to win silently.
    if (result.account_number !== null) {
      assert.notEqual(result.account_number, "2125550143", "must not pick the phone");
    } else {
      assert.equal(result.account_valid, false);
      assert.ok(result.warnings.length > 0);
    }
  });

  it("rejects a value that looks like a US phone even when it's the only candidate", () => {
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

    assert.ok(
      result.warnings && result.warnings.some((w) => w.toLowerCase().includes("name")),
      "should warn when holder name matches Option N pattern",
    );
  });
});

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

describe("extractBankDetails — field_id-based address extraction (2026-05-15)", () => {
  // Helper to build a field with a specific field_id
  function withId(field_id: string, value: string, opts: Partial<PandaDocField> = {}): PandaDocField {
    return f(value, { ...opts, field_id });
  }

  it("extracts address from Text2 + Text2_1 (comma-state-zip)", () => {
    const fields: PandaDocField[] = [
      f("121000358", { title: "Routing Number" }),
      f("000123456789", { title: "Account Number" }),
      withId("Text1", "Jane Smith"),
      withId("Text2", "1288 Polk St S"),
      withId("Text2_1", "Shakopee, MN, 55379"),
    ];
    const result = extractBankDetails(fields);
    assert.equal(result.address1, "1288 Polk St S");
    assert.equal(result.city, "Shakopee");
    assert.equal(result.region, "MN");
    assert.equal(result.postal_code, "55379");
  });

  it("extracts address from Text2 + Text2_1 (full state name, no comma before zip)", () => {
    const fields: PandaDocField[] = [
      f("121000358", { title: "Routing Number" }),
      f("000123456789", { title: "Account Number" }),
      withId("Text2", "3977 NW 9th Ave"),
      withId("Text2_1", "Deerfield Beach, Florida 33064"),
    ];
    const result = extractBankDetails(fields);
    assert.equal(result.address1, "3977 NW 9th Ave");
    assert.equal(result.city, "Deerfield Beach");
    assert.equal(result.region, "FL"); // normalized from "Florida"
    assert.equal(result.postal_code, "33064");
  });

  it("falls back to value-shape when no field_ids match", () => {
    // Untitled fields with no Text2/Text2_1 — extractor scans by value pattern.
    const fields: PandaDocField[] = [
      f("121000358", { title: "Routing Number" }),
      f("000123456789", { title: "Account Number" }),
      f("999 Elm St"),
      f("Boulder, CO 80301"),
    ];
    const result = extractBankDetails(fields);
    assert.equal(result.address1, "999 Elm St");
    assert.equal(result.city, "Boulder");
    assert.equal(result.region, "CO");
    assert.equal(result.postal_code, "80301");
  });

  it("picks the LATEST address-shaped pair when multiple appear", () => {
    // Document has two addresses (business + personal). We want the latest one
    // (closer to the bank section, which is the account-holder's address).
    const fields: PandaDocField[] = [
      f("Acme Corp HQ"),
      f("123 Business Pkwy"),
      f("Houston, TX 77001"),
      f("121000358", { title: "Routing Number" }),
      f("000123456789", { title: "Account Number" }),
      f("Personal Holder"),
      f("999 Home St"),
      f("Boulder, CO 80301"),
    ];
    const result = extractBankDetails(fields);
    assert.equal(result.address1, "999 Home St");
    assert.equal(result.city, "Boulder");
    assert.equal(result.region, "CO");
    assert.equal(result.postal_code, "80301");
  });
});
