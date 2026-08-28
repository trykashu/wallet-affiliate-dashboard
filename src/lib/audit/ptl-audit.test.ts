import { test } from "node:test";
import assert from "node:assert/strict";
import { auditPtlVsUt, buildAnnealPlan, isUnpaidStatus, type ATRecord, type MonthAudit } from "./ptl-audit";

function month(over: Partial<MonthAudit> = {}): MonthAudit {
  return {
    month: "2026-05", ptl_count: 0, ptl_sum: 0, ut_match_sum: 0,
    orphans: [], drifts: [], missing: [], unattributed: [], ...over,
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

// Regression: a Transfer In whose Referrer lookup is blank used to be skipped
// outright by the UT pass, so the audit reported a clean bill of health while
// 835 transactions — and every commission on them — were invisible. Blank
// attribution is itself the finding.
test("auditPtlVsUt: blank-Referrer Transfer Ins are reported, not skipped", () => {
  const ut: ATRecord[] = [
    { id: "recBlank", createdTime: "", fields: {
      "Transaction Type": "Transfer In", "Amount": 10000,
      "Transaction ID": "TXN-BLANK", "Date Txn Started": "2026-07-04T00:00:00.000Z",
      "Email": ["user@example.com"],
    } },
    { id: "recOk", createdTime: "", fields: {
      "Transaction Type": "Transfer In", "Amount": 500, "Referrer": ["SrA330bKOH4FYf"],
      "Transaction ID": "TXN-OK", "Date Txn Started": "2026-07-05T00:00:00.000Z",
    } },
  ];
  const months = auditPtlVsUt([], ut);
  const jul = months.find((m) => m.month === "2026-07");
  assert.ok(jul, "expected a 2026-07 bucket");

  assert.equal(jul.unattributed.length, 1, "blank-Referrer row must surface");
  assert.equal(jul.unattributed[0].transaction_id, "TXN-BLANK");
  assert.equal(jul.unattributed[0].amount, 10000);

  // The attributed one is a normal "missing from PTL" finding, not unattributed.
  assert.equal(jul.missing.length, 1);
  assert.equal(jul.missing[0].transaction_id, "TXN-OK");
});

test("auditPtlVsUt: non-Transfer-In rows are not counted as unattributed", () => {
  const ut: ATRecord[] = [
    { id: "recRefund", createdTime: "", fields: {
      "Transaction Type": "Refund", "Amount": 100,
      "Transaction ID": "TXN-REF", "Date Txn Started": "2026-07-04T00:00:00.000Z",
    } },
  ];
  const months = auditPtlVsUt([], ut);
  const jul = months.find((m) => m.month === "2026-07");
  assert.equal(jul?.unattributed.length ?? 0, 0);
});
