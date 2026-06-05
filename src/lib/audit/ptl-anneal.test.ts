import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPtlFieldsFromUt } from "./ptl-anneal";

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
  assert.equal(f["Last 4 of Card"], 1234);
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
});
