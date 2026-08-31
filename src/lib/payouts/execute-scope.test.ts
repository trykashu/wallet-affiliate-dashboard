import { test } from "node:test";
import assert from "node:assert/strict";
import { parseExecuteScope } from "./execute-scope";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

test("no body executes every requested payout", () => {
  assert.deepEqual(parseExecuteScope(undefined), { batchId: null, payoutIds: null });
  assert.deepEqual(parseExecuteScope({}), { batchId: null, payoutIds: null });
});

test("batch_id scopes to one batch", () => {
  assert.deepEqual(parseExecuteScope({ batch_id: "b77e243a" }), { batchId: "b77e243a", payoutIds: null });
});

// Retry must send exactly the payout that was retried. Scoping only by batch
// would fire every other queued payout in that batch too.
test("payout_ids scopes to specific payouts", () => {
  assert.deepEqual(parseExecuteScope({ payout_ids: [UUID_A] }), { batchId: null, payoutIds: [UUID_A] });
  assert.deepEqual(parseExecuteScope({ payout_ids: [UUID_A, UUID_B] }).payoutIds, [UUID_A, UUID_B]);
});

test("payout_ids and batch_id can combine", () => {
  const s = parseExecuteScope({ batch_id: "b1", payout_ids: [UUID_A] });
  assert.equal(s.batchId, "b1");
  assert.deepEqual(s.payoutIds, [UUID_A]);
});

// A malformed scope must never silently widen to "execute everything" — that
// would send real ACH transfers the operator did not ask for.
test("malformed payout_ids are rejected, never widened", () => {
  assert.throws(() => parseExecuteScope({ payout_ids: [] }), /empty/i);
  assert.throws(() => parseExecuteScope({ payout_ids: ["not-a-uuid"] }), /uuid/i);
  assert.throws(() => parseExecuteScope({ payout_ids: "abc" }), /array/i);
  assert.throws(() => parseExecuteScope({ batch_id: 42 }), /string/i);
});

test("oversized payout_ids list is refused", () => {
  const many = Array.from({ length: 501 }, () => UUID_A);
  assert.throws(() => parseExecuteScope({ payout_ids: many }), /too many/i);
});
