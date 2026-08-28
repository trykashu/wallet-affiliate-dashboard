import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateEarningFromFee, resolveCollectedFee, calculateKashuFee } from "./tier";

// Since 2026-08-28 commissions ride the fee Kashu ACTUALLY collected, not the
// funnel list price. Point-of-sale discounts and per-deal pricing overrides mean
// a $25,000 deal listed at 8.5% ($2,125) may collect only 7.5% ($1,875).
// Recomputing from Amount x Funnel % overstates what the partner is owed.
test("resolveCollectedFee: prefers the actual fee when present", () => {
  assert.equal(resolveCollectedFee(1875, 25000, 8.5), 1875);
  assert.equal(resolveCollectedFee(750, 10000, 8.5), 750);
});

test("resolveCollectedFee: falls back to funnel % when no actual fee yet", () => {
  // Same-day transactions have no wallet match until that night's audit runs.
  assert.equal(resolveCollectedFee(null, 10000, 8.5), 850);
  assert.equal(resolveCollectedFee(0, 10000, 7.5), 750);
  assert.equal(resolveCollectedFee(undefined, 10000, null), 850, "defaults to 8.5%");
});

test("resolveCollectedFee: never returns a negative or NaN fee", () => {
  assert.equal(resolveCollectedFee(-5, 10000, 8.5), 850);
  assert.equal(resolveCollectedFee(NaN, 10000, 8.5), 850);
});

test("calculateEarningFromFee: tier rate applies to the collected fee", () => {
  assert.equal(calculateEarningFromFee(1875, 25000, "platinum"), 187.5);
  assert.equal(calculateEarningFromFee(1875, 25000, "gold"), 93.75);
  assert.equal(calculateEarningFromFee(1875, 25000, "master"), 375);
});

test("calculateEarningFromFee: overstatement vs list price is the bug being fixed", () => {
  const tpv = 25000;
  const listed = calculateKashuFee(tpv);            // 2125 @ 8.5%
  const collected = 1875;                            // actual, 7.5%
  assert.equal(calculateEarningFromFee(listed, tpv, "platinum"), 212.5);
  assert.equal(calculateEarningFromFee(collected, tpv, "platinum"), 187.5);
});

test("calculateEarningFromFee: custom tier honours rate and basis", () => {
  assert.equal(calculateEarningFromFee(1875, 25000, "custom"), 0, "no config -> 0");
  assert.equal(
    calculateEarningFromFee(1875, 25000, "custom", { rate: 0.5, basis: "kashu_fee" }),
    937.5,
  );
  assert.equal(
    calculateEarningFromFee(1875, 25000, "custom", { rate: 0.0175, basis: "tpv" }),
    437.5,
    "tpv basis ignores the collected fee",
  );
});
