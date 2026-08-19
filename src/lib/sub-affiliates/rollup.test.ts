import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSubAffiliateRollup, DIRECT_KEY } from "./rollup";

const users = [
  { id: "u1", sub_affiliate_id: "SUB-A", status_slug: "funds_in_bank",  first_transaction_amount: 100,  created_at: "2026-08-01T00:00:00Z" },
  { id: "u2", sub_affiliate_id: "SUB-A", status_slug: "signed_up",      first_transaction_amount: null, created_at: "2026-08-05T00:00:00Z" },
  { id: "u3", sub_affiliate_id: "SUB-B", status_slug: "transaction_run", first_transaction_amount: 50,  created_at: "2026-08-03T00:00:00Z" },
  { id: "u4", sub_affiliate_id: null,    status_slug: "signed_up",      first_transaction_amount: null, created_at: "2026-08-02T00:00:00Z" },
];
const transactions = [
  { referred_user_id: "u1", amount: 100 },
  { referred_user_id: "u1", amount: 400 },
  { referred_user_id: "u3", amount: 50 },
];
const earnings = [
  { referred_user_id: "u1", amount: 8.5,  status: "approved" },
  { referred_user_id: "u3", amount: 0.85, status: "pending" },
];
const labels = [{ sub_affiliate_id: "SUB-A", label: "Jake M." }];

test("groups users by sub id with direct bucket", () => {
  const rows = buildSubAffiliateRollup({ users, transactions, earnings, labels });
  const keys = rows.map((r) => r.subId);
  assert.deepEqual(keys, ["SUB-A", "SUB-B", DIRECT_KEY]); // volume DESC, direct last
  const a = rows[0];
  assert.equal(a.label, "Jake M.");
  assert.equal(a.userCount, 2);
  assert.equal(a.transactedCount, 1);
  assert.equal(a.conversionPct, 50);
  assert.equal(a.volume, 500);
  assert.equal(a.earningsTotal, 8.5);
});

test("direct bucket collects null sub ids and is unlabeled", () => {
  const rows = buildSubAffiliateRollup({ users, transactions, earnings, labels });
  const direct = rows[rows.length - 1];
  assert.equal(direct.subId, DIRECT_KEY);
  assert.equal(direct.label, null);
  assert.equal(direct.userCount, 1);
  assert.equal(direct.volume, 0);
});

test("aggregate splits direct vs sub-tagged", () => {
  const rows = buildSubAffiliateRollup({ users, transactions, earnings, labels });
  const subTagged = rows.filter((r) => r.subId !== DIRECT_KEY);
  assert.equal(subTagged.reduce((s, r) => s + r.userCount, 0), 3);
});

test("empty inputs return empty array", () => {
  assert.deepEqual(buildSubAffiliateRollup({ users: [], transactions: [], earnings: [], labels: [] }), []);
});
