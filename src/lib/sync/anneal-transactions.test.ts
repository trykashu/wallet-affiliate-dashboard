import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupAirtableTransactions, decideEarningAction } from "./anneal-transactions";

test("dedup: empty input", () => {
  const r = dedupAirtableTransactions([]);
  assert.deepEqual(r.canonical, []);
  assert.equal(r.loserToCanonical.size, 0);
  assert.deepEqual(r.duplicates, []);
});

test("dedup: pass-through when no Transaction ID dupes", () => {
  const r = dedupAirtableTransactions([
    { id: "recA", createdTime: "2026-06-01T10:00:00.000Z", fields: { "Transaction ID": "111" } },
    { id: "recB", createdTime: "2026-06-01T11:00:00.000Z", fields: { "Transaction ID": "222" } },
  ]);
  assert.equal(r.canonical.length, 2);
  assert.equal(r.loserToCanonical.size, 0);
});

test("dedup: oldest createdTime wins for duplicate Transaction ID", () => {
  const r = dedupAirtableTransactions([
    { id: "recNewer", createdTime: "2026-06-01T22:03:28.799Z", fields: { "Transaction ID": "98729881" } },
    { id: "recOlder", createdTime: "2026-06-01T22:03:28.554Z", fields: { "Transaction ID": "98729881" } },
  ]);
  assert.equal(r.canonical.length, 1);
  assert.equal(r.canonical[0].id, "recOlder");
  assert.equal(r.loserToCanonical.get("recNewer"), "recOlder");
  assert.deepEqual(r.duplicates, [
    { transaction_id: "98729881", canonical_id: "recOlder", loser_ids: ["recNewer"] },
  ]);
});

test("dedup: records missing Transaction ID pass through unchanged", () => {
  const r = dedupAirtableTransactions([
    { id: "recA", createdTime: "2026-06-01T10:00:00.000Z", fields: {} },
    { id: "recB", createdTime: "2026-06-01T11:00:00.000Z", fields: { "Transaction ID": "" } },
    { id: "recC", createdTime: "2026-06-01T12:00:00.000Z", fields: { "Transaction ID": "111" } },
  ]);
  // Two no-id records + one keyed; all kept
  assert.equal(r.canonical.length, 3);
  assert.equal(r.loserToCanonical.size, 0);
});

test("dedup: numeric Transaction ID coerces to string", () => {
  const r = dedupAirtableTransactions([
    { id: "recA", createdTime: "2026-06-01T10:00:00.000Z", fields: { "Transaction ID": 98729881 } },
    { id: "recB", createdTime: "2026-06-01T11:00:00.000Z", fields: { "Transaction ID": "98729881" } },
  ]);
  assert.equal(r.canonical.length, 1);
  assert.equal(r.canonical[0].id, "recA");
  assert.equal(r.loserToCanonical.get("recB"), "recA");
});

test("dedup: triple-duplicate keeps oldest, both others map to canonical", () => {
  const r = dedupAirtableTransactions([
    { id: "recMid",    createdTime: "2026-06-01T11:00:00Z", fields: { "Transaction ID": "X" } },
    { id: "recNew",    createdTime: "2026-06-01T12:00:00Z", fields: { "Transaction ID": "X" } },
    { id: "recOldest", createdTime: "2026-06-01T10:00:00Z", fields: { "Transaction ID": "X" } },
  ]);
  assert.equal(r.canonical.length, 1);
  assert.equal(r.canonical[0].id, "recOldest");
  assert.equal(r.loserToCanonical.get("recNew"), "recOldest");
  assert.equal(r.loserToCanonical.get("recMid"), "recOldest");
});

test("decideEarningAction: pending earning with no canonical sibling → migrate", () => {
  const r = decideEarningAction(
    { status: "pending", transaction_ref: "recLoser" },
    "recCanonical",
    false,
  );
  assert.deepEqual(r, { action: "migrate", to: "recCanonical" });
});

test("decideEarningAction: pending earning with canonical sibling → delete", () => {
  const r = decideEarningAction(
    { status: "pending", transaction_ref: "recLoser" },
    "recCanonical",
    true,
  );
  assert.deepEqual(r, { action: "delete" });
});

test("decideEarningAction: paid earning → warn (preserve payout history)", () => {
  const r = decideEarningAction(
    { status: "paid", transaction_ref: "recLoser" },
    "recCanonical",
    false,
  );
  assert.equal(r.action, "warn");
});

test("decideEarningAction: reversed earning → warn", () => {
  const r = decideEarningAction(
    { status: "reversed", transaction_ref: "recLoser" },
    "recCanonical",
    true,
  );
  assert.equal(r.action, "warn");
});

test("decideEarningAction: approved earning behaves like pending", () => {
  const migrate = decideEarningAction(
    { status: "approved", transaction_ref: "recLoser" },
    "recCanonical",
    false,
  );
  assert.deepEqual(migrate, { action: "migrate", to: "recCanonical" });
  const del = decideEarningAction(
    { status: "approved", transaction_ref: "recLoser" },
    "recCanonical",
    true,
  );
  assert.deepEqual(del, { action: "delete" });
});
