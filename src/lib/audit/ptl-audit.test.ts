import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnnealPlan, type MonthAudit } from "./ptl-audit";

function month(over: Partial<MonthAudit> = {}): MonthAudit {
  return {
    month: "2026-05", ptl_count: 0, ptl_sum: 0, ut_match_sum: 0,
    orphans: [], drifts: [], missing: [], ...over,
  };
}

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
  const actionIds = [...plan.toCreate.map(() => ""), ...plan.toCorrect.map((d) => d.ptl_id)];
  assert.ok(!actionIds.includes("p3"));
  assert.ok(!actionIds.includes("o1"));
});
