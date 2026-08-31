import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStatementAirtableFields } from "./airtable-fields";

const base = {
  statementNumber: "KS-2026-07-DEEA8F",
  attributionId: "7HegNT4yhncnz5",
  period: "2026-07",
  statementUrl: "https://example.com/s.pdf",
  totalFees: 1875,
  commissionDue: 93.75,
  affiliateRecordId: "recABC",
  generatedAt: new Date("2026-08-31T21:05:53.123Z"),
};

// "Generated At" is a DATE field in Airtable, not dateTime. Sending a full ISO
// timestamp is rejected with 422 INVALID_VALUE_FOR_COLUMN, which silently cost
// every statement its Airtable row — and therefore its delivery email.
test("Generated At is date-only, never a timestamp", () => {
  const f = buildStatementAirtableFields({ ...base, isNew: true });
  assert.equal(f["Generated At"], "2026-08-31");
  assert.doesNotMatch(String(f["Generated At"]), /T|Z|:/);
});

// The delivery workflow selects on {Statement Delivery Status} = 'Pending'.
// Leaving it unset means a row can never be picked up.
test("a new statement is marked Pending so delivery can find it", () => {
  assert.equal(buildStatementAirtableFields({ ...base, isNew: true })["Statement Delivery Status"], "Pending");
});

// Re-generating must not reset an already-sent statement back to Pending and
// cause a duplicate email.
test("regenerating an existing statement leaves delivery status alone", () => {
  const f = buildStatementAirtableFields({ ...base, isNew: false });
  assert.equal("Statement Delivery Status" in f, false);
});

test("core fields are carried through", () => {
  const f = buildStatementAirtableFields({ ...base, isNew: true });
  assert.equal(f.Name, "KS-2026-07-DEEA8F");
  assert.equal(f.Period, "2026-07");
  assert.equal(f["Commission Due"], 93.75);
  assert.equal(f["Total Fees Collected"], 1875);
  assert.equal(f["Commission Status"], "Paid");
  assert.deepEqual(f.Affiliate, ["recABC"]);
});

test("the affiliate link is omitted when unresolved", () => {
  const f = buildStatementAirtableFields({ ...base, affiliateRecordId: null, isNew: true });
  assert.equal("Affiliate" in f, false);
});
