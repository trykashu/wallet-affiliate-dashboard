import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLATINUM_VOLUME_THRESHOLD,
  buildCumulativeVolumeIndex,
  calculateBandedEarning,
} from "./commission-bands";

const txn = (id: string, affiliateId: string, amount: number, date: string, over: Partial<{ transactionType: string; selfReferral: boolean }> = {}) => ({
  airtableRecordId: id, affiliateId, amount, transactionDate: date,
  transactionType: over.transactionType ?? "Transfer In",
  selfReferral: over.selfReferral ?? false,
});

test("threshold is $100k", () => {
  assert.equal(PLATINUM_VOLUME_THRESHOLD, 100_000);
});

test("cumulative index counts volume BEFORE each transaction, in date order", () => {
  const idx = buildCumulativeVolumeIndex([
    txn("c", "a1", 30_000, "2026-03-01"),
    txn("a", "a1", 10_000, "2026-01-01"),
    txn("b", "a1", 20_000, "2026-02-01"),
  ]);
  assert.equal(idx.get("a"), 0);
  assert.equal(idx.get("b"), 10_000);
  assert.equal(idx.get("c"), 30_000);
});

test("cumulative index is per affiliate", () => {
  const idx = buildCumulativeVolumeIndex([
    txn("a", "a1", 50_000, "2026-01-01"),
    txn("b", "a2", 70_000, "2026-01-02"),
    txn("c", "a1", 10_000, "2026-01-03"),
  ]);
  assert.equal(idx.get("c"), 50_000, "a2's volume must not leak into a1");
  assert.equal(idx.get("b"), 0);
});

// Self-referrals are excluded from referred_volume_total, so they must not
// push a partner toward the 10% band on their own deposits.
test("cumulative index excludes self-referrals and non-Transfer-In", () => {
  const idx = buildCumulativeVolumeIndex([
    txn("a", "a1", 90_000, "2026-01-01", { selfReferral: true }),
    txn("b", "a1", 5_000, "2026-01-02", { transactionType: "Refund" }),
    txn("c", "a1", 10_000, "2026-01-03"),
  ]);
  assert.equal(idx.get("c"), 0, "neither excluded row counts toward the band");
});

test("entirely below threshold earns 5%", () => {
  assert.equal(calculateBandedEarning(1000, 10_000, 0, "gold"), 50);
  assert.equal(calculateBandedEarning(1000, 10_000, 50_000, "platinum"), 50,
    "tier label does not override the band");
});

test("entirely above threshold earns 10%", () => {
  assert.equal(calculateBandedEarning(1000, 10_000, 150_000, "gold"), 100,
    "past $100k the rate is 10% regardless of stored tier");
});

// The transaction that crosses $100k splits proportionally by TPV.
test("a straddling transaction splits proportionally", () => {
  // cum 84,600 + 25,000 -> 15,400 below / 9,600 above; fee 2,125
  const earned = calculateBandedEarning(2125, 25_000, 84_600, "platinum");
  const expected = 2125 * (15_400 / 25_000) * 0.05 + 2125 * (9_600 / 25_000) * 0.10;
  assert.equal(earned, Math.round(expected * 100) / 100);
  assert.equal(earned, 147.05);
});

test("master is a flat 20% and is not banded", () => {
  assert.equal(calculateBandedEarning(1000, 10_000, 0, "master"), 200);
  assert.equal(calculateBandedEarning(1000, 10_000, 500_000, "master"), 200);
});

test("custom honours rate and basis, unbanded", () => {
  assert.equal(calculateBandedEarning(1000, 10_000, 0, "custom"), 0, "no config -> 0");
  assert.equal(calculateBandedEarning(1000, 10_000, 0, "custom", { rate: 0.5, basis: "kashu_fee" }), 500);
  assert.equal(calculateBandedEarning(1000, 10_000, 0, "custom", { rate: 0.0175, basis: "tpv" }), 175);
});

test("zero-TPV transaction cannot divide by zero", () => {
  assert.equal(calculateBandedEarning(0, 0, 0, "gold"), 0);
});
