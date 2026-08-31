import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretExecuteResponse } from "./execute-result";

test("a real send is a success", () => {
  const r = interpretExecuteResponse(true, 200, { success: true, executed_count: 1 });
  assert.equal(r.ok, true);
});

// execute-batch answers 200 {executed_count: 0, message: "No requested payouts
// to execute."} when its scope matches nothing. Treating that as success is how
// a retry can appear to work while sending nothing at all.
test("executed_count 0 is a failure, not a success", () => {
  const r = interpretExecuteResponse(true, 200, {
    success: true, executed_count: 0, message: "No requested payouts to execute.",
  });
  assert.equal(r.ok, false);
  assert.match(r.message, /nothing was sent/i);
  assert.match(r.message, /No requested payouts to execute/);
});

test("a missing executed_count is treated as nothing sent", () => {
  assert.equal(interpretExecuteResponse(true, 200, { success: true }).ok, false);
});

test("per-payout errors surface even on a 200", () => {
  const r = interpretExecuteResponse(true, 200, { executed_count: 0, errors: ["Payout x: Transfer failed"] });
  assert.equal(r.ok, false);
  assert.match(r.message, /Transfer failed/);
});

test("http failures report the server's error and detail", () => {
  const r = interpretExecuteResponse(false, 403, {
    error: "Finance access required", detail: "Your account isn't in the FINANCE_EMAILS allowlist.",
  });
  assert.equal(r.ok, false);
  assert.match(r.message, /Finance access required/);
  assert.match(r.message, /FINANCE_EMAILS/);
});

test("http failure with no body still names the status code", () => {
  assert.match(interpretExecuteResponse(false, 500, {}).message, /500/);
});
