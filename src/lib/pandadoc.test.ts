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
