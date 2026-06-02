import { test } from "node:test";
import assert from "node:assert/strict";
import { extractBankFromText } from "./pdf-bank-extract";

/** Fixture text that mirrors the real PandaDoc-signed agreement layout:
 *  template page with underscore placeholders, then form values jammed at
 *  the end of the bank section in form-tab order, then the audit trail.
 */
function makeFixture(values: string): string {
  return (
    "Kashu Referral Partner Agreement page boilerplate. " +
    "Schedule A. Schedule B. ACH Payout Banking Information " +
    "Account Holder Name: ______ Account Type: ☐ Checking ☐ Savings " +
    "Routing Number (ACH): ______ Account Number: ______ " +
    "Authorization Date: ______ " +
    values +
    " REF. NUMBER ABC-XYZ-123 DOCUMENT COMPLETED BY ALL PARTIES " +
    "KASHU PAY EMAIL ADMIN@KASHUPAY.COM SIGNED 09 APR 2026 " +
    "PARTNER EMAIL PARTNER@EXAMPLE.COM VERIFIED 12 APR 2026"
  );
}

test("baseline: PandaDoc form-tab values block extracts routing → account adjacently", () => {
  const text = makeFixture(
    "12 amrit singh 37200 paseo padre pkwy fremont ca 94536 atm capital inc " +
    "americantranz01@gmail.com 4088062234 atm capital inc 121000358 325206299714 " +
    "amrit singh ceo 2026-04-12",
  );
  const r = extractBankFromText(text);
  assert.equal(r.routing_number, "121000358");
  assert.equal(r.account_number, "325206299714");
  assert.equal(r.routing_valid, true);
  assert.equal(r.account_valid, true);
  assert.equal(r.email, "americantranz01@gmail.com");
});

test("excludes kashupay sender + audit-trail emails", () => {
  const text = makeFixture(
    "Brandon Paraon Honolulu HI 96813 Bslick756@gmail.com 8083069737 " +
    "Brandon Paraon 321380315 53529 Brandon Paraon President 2026-04-09",
  );
  const r = extractBankFromText(text);
  assert.equal(r.email, "Bslick756@gmail.com");
  assert.notEqual(r.email?.toLowerCase(), "admin@kashupay.com");
});

test("does NOT misread date fragment as account when form skips the account field", () => {
  const text = makeFixture("Jennifer email@x.com 5551234567 031176110 2026-04-12");
  const r = extractBankFromText(text);
  assert.equal(r.routing_number, "031176110");
  assert.equal(r.account_number, null, "must refuse to invent an account number");
  assert.equal(r.account_valid, false);
});

test("accepts ABA-checksum-valid 9-digit number as ACCOUNT when it follows routing", () => {
  // Real case: C Billie Kramer's account 719113709 happens to be ABA-checksum-valid
  const text = makeFixture("Kramer billy@x.com 3215369090 267084131 719113709 Kramer CEO 2026-04-12");
  const r = extractBankFromText(text);
  assert.equal(r.routing_number, "267084131");
  assert.equal(r.account_number, "719113709");
});

test("accepts 10-digit standalone number as ACCOUNT when it follows routing", () => {
  // Real case: Joseph Marquez's 10-digit account would be mis-flagged as a phone
  const text = makeFixture("Joseph j@x.com 9499662097 121042882 7096759977 Joseph CEO 2026-04-15");
  const r = extractBankFromText(text);
  assert.equal(r.account_number, "7096759977");
});

test("accepts short 5-digit account when it follows routing", () => {
  // Real case: Brandon Paraon entered a 5-digit account number
  const text = makeFixture("Brandon b@x.com 8083069737 Brandon 321380315 53529 Brandon 2026-04-09");
  const r = extractBankFromText(text);
  assert.equal(r.account_number, "53529");
});

test("rejects when routing number fails ABA checksum", () => {
  // Tobi Rosario's case: real partner entered an invalid routing
  const text = makeFixture("Tobi t@x.com 8566766245 Tobi 121509022 360980484008 Tobi 2026-04-16");
  const r = extractBankFromText(text);
  assert.equal(r.routing_number, null);
  assert.equal(r.routing_valid, false);
});

test("strips PandaDoc audit trail — emails from KASHU PAY + audit-VERIFIED do not leak", () => {
  const text = makeFixture("partner@real.com 5551234567 Real Partner 121000358 1234567890 Real 2026-04-12");
  const r = extractBankFromText(text);
  assert.equal(r.email, "partner@real.com");
});

test("page-footer 'Document Ref' must NOT be treated as audit-trail anchor", () => {
  // Real PandaDoc PDFs have 'Document Ref:' in EVERY page footer, so stripping
  // there would lose all values. Use REF. NUMBER / DOCUMENT COMPLETED instead.
  const text =
    "Page 1 of 12 Document Ref: ABC-XYZ Page 2 of 12 Document Ref: ABC-XYZ " +
    "Schedule B values: partner@x.com 5551234567 Holder 121000358 1234567890 Holder 2026-04-12 " +
    "REF. NUMBER ABC-XYZ DOCUMENT COMPLETED BY ALL PARTIES ADMIN@KASHUPAY.COM";
  const r = extractBankFromText(text);
  assert.equal(r.routing_number, "121000358");
  assert.equal(r.account_number, "1234567890");
  assert.equal(r.email, "partner@x.com");
});

test("phone with explicit formatting does not get picked as routing/account", () => {
  const text = makeFixture("name@x.com (321) 536-9090 Acme Inc 121000358 9876543210 Holder 2026-04-12");
  const r = extractBankFromText(text);
  assert.equal(r.routing_number, "121000358");
  assert.equal(r.account_number, "9876543210");
});
