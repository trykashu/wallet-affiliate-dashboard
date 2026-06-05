import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReferralTrend, buildSegmentedReferralTrend } from "./referral-trend";

// Fixed "now" = Mon Jun 15 2026, local noon — deterministic buckets.
// Fixtures use T12:00:00 (no "Z") strings, which resolve to the same UTC calendar day
// for any offset within ±12h, so UTC bucketing keeps all assertions stable.
const NOW = new Date(2026, 5, 15, 12, 0, 0);

const tx = (over: Partial<{ transaction_type: string; self_referral: boolean; transaction_date: string | null; amount: number }>) => ({
  transaction_type: "Transfer In", self_referral: false, transaction_date: "2026-06-10T12:00:00", amount: 100, ...over,
});

test("monthly: users bucket by created_at, volume by transaction_date", () => {
  const { monthly } = buildReferralTrend(
    [{ created_at: "2026-06-10T12:00:00" }, { created_at: "2026-05-02T12:00:00" }],
    [tx({ amount: 500, transaction_date: "2026-06-03T12:00:00" }), tx({ amount: 250, transaction_date: "2026-05-20T12:00:00" })],
    NOW,
  );
  assert.equal(monthly.length, 12);
  const jun = monthly[11], may = monthly[10];
  assert.equal(jun.key, "2026-06");
  assert.equal(jun.users, 1);
  assert.equal(jun.volume, 500);
  assert.equal(may.key, "2026-05");
  assert.equal(may.users, 1);
  assert.equal(may.volume, 250);
});

test("volume filtering: non-Transfer-In, self-referral, null date excluded", () => {
  const { monthly } = buildReferralTrend(
    [],
    [
      tx({ transaction_type: "Transfer Out", amount: 999 }),
      tx({ self_referral: true, amount: 888 }),
      tx({ transaction_date: null, amount: 777 }),
      tx({ amount: 100 }),
    ],
    NOW,
  );
  const total = monthly.reduce((s, b) => s + b.volume, 0);
  assert.equal(total, 100);
});

test("out-of-window rows excluded (13 months ago, all-zero elsewhere)", () => {
  const { monthly } = buildReferralTrend(
    [{ created_at: "2025-05-01T12:00:00" }],            // 13 months before Jun 2026
    [tx({ transaction_date: "2025-05-01T12:00:00", amount: 500 })],
    NOW,
  );
  assert.equal(monthly.reduce((s, b) => s + b.users, 0), 0);
  assert.equal(monthly.reduce((s, b) => s + b.volume, 0), 0);
});

test("weekly: 12 Monday-started buckets; an event today lands in the last bucket", () => {
  const { weekly } = buildReferralTrend(
    [{ created_at: "2026-06-15T12:00:00" }],
    [tx({ transaction_date: "2026-06-15T12:00:00", amount: 300 })],
    NOW,
  );
  assert.equal(weekly.length, 12);
  assert.equal(weekly[11].users, 1);
  assert.equal(weekly[11].volume, 300);
  // total equals the single in-window event (not double counted)
  assert.equal(weekly.reduce((s, b) => s + b.users, 0), 1);
});

test("empty input: all buckets present and zero", () => {
  const { monthly, weekly } = buildReferralTrend([], [], NOW);
  assert.equal(monthly.length, 12);
  assert.equal(weekly.length, 12);
  assert.ok(monthly.every((b) => b.users === 0 && b.volume === 0));
  assert.ok(weekly.every((b) => b.users === 0 && b.volume === 0));
});

test("weekly: a Sunday created_at lands in the preceding Monday's bucket", () => {
  const { weekly } = buildReferralTrend(
    [{ created_at: "2026-06-14T12:00:00" }],  // Sunday — previous week
    [],
    NOW,
  );
  assert.equal(weekly[10].users, 1);   // week of Jun 8
  assert.equal(weekly[11].users, 0);   // week of Jun 15 untouched
});

test("segmented: payova rows only in payova, others only in main", () => {
  const users = [
    { created_at: "2026-06-10T12:00:00", affiliate_id: "affP" },
    { created_at: "2026-06-11T12:00:00", affiliate_id: "affX" },
  ];
  const txns = [
    { affiliate_id: "affP", transaction_type: "Transfer In", self_referral: false, transaction_date: "2026-06-10T12:00:00", amount: 500 },
    { affiliate_id: "affX", transaction_type: "Transfer In", self_referral: false, transaction_date: "2026-06-10T12:00:00", amount: 300 },
  ];
  const { main, payova } = buildSegmentedReferralTrend(users, txns, new Set(["affP"]), NOW);
  assert.equal(payova.monthly[11].users, 1);
  assert.equal(payova.monthly[11].volume, 500);
  assert.equal(main.monthly[11].users, 1);
  assert.equal(main.monthly[11].volume, 300);
});

test("segmented: null/unknown affiliate_id transaction counts in main", () => {
  const txns = [
    { affiliate_id: null, transaction_type: "Transfer In", self_referral: false, transaction_date: "2026-06-10T12:00:00", amount: 100 },
    { affiliate_id: "unknown", transaction_type: "Transfer In", self_referral: false, transaction_date: "2026-06-10T12:00:00", amount: 50 },
  ];
  const { main, payova } = buildSegmentedReferralTrend([], txns, new Set(["affP"]), NOW);
  assert.equal(main.monthly[11].volume, 150);
  assert.equal(payova.monthly[11].volume, 0);
});

test("segmented: main + payova reconcile to an unsegmented trend", () => {
  const users = [
    { created_at: "2026-06-10T12:00:00", affiliate_id: "affP" },
    { created_at: "2026-05-10T12:00:00", affiliate_id: "affX" },
  ];
  const txns = [
    { affiliate_id: "affP", transaction_type: "Transfer In", self_referral: false, transaction_date: "2026-06-10T12:00:00", amount: 500 },
    { affiliate_id: "affX", transaction_type: "Transfer In", self_referral: false, transaction_date: "2026-05-10T12:00:00", amount: 250 },
  ];
  const { main, payova } = buildSegmentedReferralTrend(users, txns, new Set(["affP"]), NOW);
  const whole = buildReferralTrend(users, txns, NOW);
  for (let i = 0; i < whole.monthly.length; i++) {
    assert.equal(main.monthly[i].users + payova.monthly[i].users, whole.monthly[i].users);
    assert.equal(main.monthly[i].volume + payova.monthly[i].volume, whole.monthly[i].volume);
  }
});

test("segmented: empty payova set puts everything in main", () => {
  const users = [{ created_at: "2026-06-10T12:00:00", affiliate_id: "affX" }];
  const { main, payova } = buildSegmentedReferralTrend(users, [], new Set<string>(), NOW);
  assert.equal(main.monthly[11].users, 1);
  assert.ok(payova.monthly.every((b) => b.users === 0 && b.volume === 0));
});
