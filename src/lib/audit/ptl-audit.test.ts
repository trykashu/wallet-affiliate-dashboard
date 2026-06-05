import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnnealPlan, isUnpaidStatus, type MonthAudit } from "./ptl-audit";

function month(over: Partial<MonthAudit> = {}): MonthAudit {
  return {
    month: "2026-05", ptl_count: 0, ptl_sum: 0, ut_match_sum: 0,
    orphans: [], drifts: [], missing: [], ...over,
  };
}

test("isUnpaidStatus: handles casing, whitespace, and missing", () => {
  assert.equal(isUnpaidStatus(""), true);
  assert.equal(isUnpaidStatus("Owed"), true);
  assert.equal(isUnpaidStatus("  OWED  "), true);
  assert.equal(isUnpaidStatus("Paid"), false);
  assert.equal(isUnpaidStatus("  Paid  "), false);
  assert.equal(isUnpaidStatus("Processing"), false);
  assert.equal(isUnpaidStatus(null as unknown as string), true);
  assert.equal(isUnpaidStatus(undefined as unknown as string), true);
});

test("buildAnnealPlan: empty input", () => {
  const plan = buildAnnealPlan([]);
  assert.deepEqual(plan.toCreate, []);
  assert.deepEqual(plan.toCorrect, []);
  assert.deepEqual(plan.skipped.orphans, []);
  assert.deepEqual(plan.skipped.paidDrifts, []);
});

test("buildAnnealPlan: missing -> toCreate, orphans -> skipped", () => {
  const plan = buildAnnealPlan([
    month({
      missing: [{ ut_id: "utA", user_email: "a@x.com", referrer: "R1", amount: 100, transaction_id: "T1", transaction_date: "2026-05-01" }],
      orphans: [{ ptl_id: "ptlO", user_email: "o@x.com", amount: 50, transaction_id: "T9", transaction_date: "2026-05-02" }],
    }),
  ]);
  assert.equal(plan.toCreate.length, 1);
  assert.equal(plan.toCreate[0].ut_id, "utA");
  assert.equal(plan.skipped.orphans.length, 1);
  assert.equal(plan.toCorrect.length, 0);
});

test("buildAnnealPlan: unpaid drift -> toCorrect, paid drift -> skipped", () => {
  const plan = buildAnnealPlan([
    month({
      drifts: [
        { ptl_id: "p1", transaction_id: "T1", ptl_amount: 90, ut_amount: 100, delta: 10, commission_status: "Owed" },
        { ptl_id: "p2", transaction_id: "T2", ptl_amount: 80, ut_amount: 100, delta: 20, commission_status: "" },
        { ptl_id: "p3", transaction_id: "T3", ptl_amount: 70, ut_amount: 100, delta: 30, commission_status: "Paid" },
      ],
    }),
  ]);
  assert.deepEqual(plan.toCorrect.map((d) => d.ptl_id), ["p1", "p2"]);
  assert.deepEqual(plan.skipped.paidDrifts.map((d) => d.ptl_id), ["p3"]);
});

test("buildAnnealPlan: paid drift/orphan never in action sets", () => {
  const plan = buildAnnealPlan([
    month({
      orphans: [{ ptl_id: "o1", user_email: "", amount: 1, transaction_id: "T", transaction_date: "" }],
      drifts: [{ ptl_id: "p3", transaction_id: "T3", ptl_amount: 70, ut_amount: 100, delta: 30, commission_status: "Paid" }],
    }),
  ]);
  assert.equal(plan.toCreate.length, 0);
  assert.equal(plan.toCorrect.length, 0);
  assert.equal(plan.skipped.orphans.length, 1);
  assert.equal(plan.skipped.paidDrifts.length, 1);
});
