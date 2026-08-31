import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransitionPayoutStatus, needsRequeue } from "./status-transitions";

// The Retry button sends "requested", which the API enum rejected outright —
// so retry could never work. Reinstating it narrowly: retry is only meaningful
// from `failed`, and must not become a way to reopen a settled payout.
test("retry: failed -> requested is allowed", () => {
  assert.equal(canTransitionPayoutStatus("failed", "requested"), true);
});

test("retry from any other state is refused", () => {
  for (const from of ["completed", "processing", "requested", "pending_review"]) {
    assert.equal(canTransitionPayoutStatus(from, "requested"), false, `${from} -> requested`);
  }
});

// Pre-existing behaviour: marking completed/failed was permitted from any
// state, and finance relies on it to record payments made outside the system.
// Deliberately left permissive so this fix does not break an ops flow.
test("completed and failed remain reachable from any state", () => {
  for (const from of ["requested", "processing", "failed", "completed", "pending_review"]) {
    assert.equal(canTransitionPayoutStatus(from, "completed"), true);
    assert.equal(canTransitionPayoutStatus(from, "failed"), true);
  }
});

test("unknown current status still permits completed/failed but never requested", () => {
  assert.equal(canTransitionPayoutStatus(null, "completed"), true);
  assert.equal(canTransitionPayoutStatus(undefined, "failed"), true);
  assert.equal(canTransitionPayoutStatus(null, "requested"), false);
});

// A payout already sitting in `requested` is queued but unsent — the UI offers
// no way to send it, which is why an operator would otherwise have to bounce it
// through `failed` first. Sending it directly must skip the re-queue, since
// requested -> requested is not a legal transition.
test("needsRequeue: only a failed payout is re-queued before sending", () => {
  assert.equal(needsRequeue("failed"), true);
  assert.equal(needsRequeue("requested"), false);
});

test("needsRequeue: settled or in-flight payouts are never re-queued", () => {
  for (const s of ["completed", "processing", "pending_review", null, undefined]) {
    assert.equal(needsRequeue(s), false, `${s}`);
  }
});
