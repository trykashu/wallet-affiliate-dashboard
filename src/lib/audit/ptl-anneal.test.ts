import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPtlFieldsFromUt, isSelfReferral } from "./ptl-anneal";

const utRow = {
  id: "utX",
  createdTime: "2026-05-01T00:00:00.000Z",
  fields: {
    "Transaction ID": " T1 ",
    "Amount": 250,
    "Referrer": ["R1"],
    "Transaction Type": "Transfer In",
    "Date Txn Started": "2026-05-01",
    "Email": ["user@x.com"],
    "Last 4": "1234",
    "Card Issuer": "Visa",
  },
};

test("buildPtlFieldsFromUt: maps core fields and template defaults", () => {
  const f = buildPtlFieldsFromUt(utRow, "recAff1");
  assert.equal(f["Transaction ID"], "T1");           // trimmed
  assert.equal(f["Amount"], 250);
  assert.equal(f["Funnel %"], "8.5 %");
  assert.equal(f["Referrer"], "R1");
  assert.equal(f["Commission Status"], "Owed");
  assert.equal(f["Transaction Type"], "Transfer In");
  assert.equal(f["Transaction Date"], "2026-05-01");
  assert.deepEqual(f["Partner Match"], ["recAff1"]);
  assert.equal(f["User Email"], "user@x.com");
  assert.equal(f["Last 4 of Card"], "1234"); // text, not Number — see regression test below
  assert.equal(f["Card Issuer"], "Visa");
});

test("buildPtlFieldsFromUt: strips empty/null optionals", () => {
  const f = buildPtlFieldsFromUt(
    { id: "u", createdTime: "", fields: { "Transaction ID": "T2", "Amount": 10, "Referrer": ["R2"] } },
    "recAff2",
  );
  assert.equal("Last 4 of Card" in f, false);
  assert.equal("Card Issuer" in f, false);
  assert.equal("User Email" in f, false);
  assert.equal(f["Transaction Type"], "Transfer In"); // default
  // No "Date Txn Started" in fields → "Transaction Date" should be stripped
  assert.equal("Transaction Date" in f, false);
});

test("buildPtlFieldsFromUt: drops non-numeric Last 4 (NaN guard)", () => {
  const f = buildPtlFieldsFromUt(
    { id: "u2", createdTime: "", fields: { "Transaction ID": "T3", "Amount": 10, "Referrer": ["R3"], "Last 4": "XXXX" } },
    "recAff3",
  );
  assert.equal("Last 4 of Card" in f, false);
});

// Regression: "Last 4 of Card" is singleLineText in the PTL, but the builder
// coerced it with Number(). That rejected every numeric value with a 422
// ("cannot accept the provided value"), destroyed leading zeros ("0318" -> 318),
// and silently dropped the 635 rows stored as "AMEX •••• 1009".
test("buildPtlFieldsFromUt: Last 4 is written as text, digits extracted", () => {
  const base = { id: "recX", createdTime: "", fields: {} as Record<string, unknown> };
  const f = (last4: unknown) =>
    buildPtlFieldsFromUt({ ...base, fields: { "Transaction ID": "T1", "Amount": 100, "Last 4": last4 } }, "recAff");

  assert.equal(f("8835")["Last 4 of Card"], "8835");
  assert.equal(f(8835)["Last 4 of Card"], "8835");
  assert.equal(f("0318")["Last 4 of Card"], "0318", "leading zero must survive");
  assert.equal(f("AMEX •••• 1009")["Last 4 of Card"], "1009");
  assert.equal(f("VISA •••• 3561")["Last 4 of Card"], "3561");
  assert.equal(f("MASTERCARD •••• 2279")["Last 4 of Card"], "2279");
});

test("buildPtlFieldsFromUt: omits Last 4 when there are no digits", () => {
  const base = { id: "recX", createdTime: "", fields: {} as Record<string, unknown> };
  const f = (last4: unknown) =>
    buildPtlFieldsFromUt({ ...base, fields: { "Transaction ID": "T1", "Amount": 100, "Last 4": last4 } }, "recAff");

  for (const v of ["", null, undefined, "N/A", "   "]) {
    assert.equal("Last 4 of Card" in f(v), false, `expected omission for ${JSON.stringify(v)}`);
  }
});

// A partner cannot earn commission on their own deposit. /api/sync/transactions
// already enforces this (self_referral flag, excluded from volume and earnings),
// but the PTL path had no equivalent guard, so self-funded transactions were
// booked as "Owed" — 44 rows, $719.12, before this was added.
test("isSelfReferral: matches on normalised email", () => {
  assert.equal(isSelfReferral("Agent@Kashu.com ", "agent@kashu.com"), true);
  assert.equal(isSelfReferral(["agent@kashu.com"], "agent@kashu.com"), true);
  assert.equal(isSelfReferral("agent@kashu.com", "someone@else.com"), false);
});

test("isSelfReferral: absent emails are never a self-referral", () => {
  assert.equal(isSelfReferral(undefined, "agent@kashu.com"), false);
  assert.equal(isSelfReferral("agent@kashu.com", undefined), false);
  assert.equal(isSelfReferral("", ""), false);
  assert.equal(isSelfReferral(null, null), false);
});
