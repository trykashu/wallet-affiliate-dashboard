import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STAGE_ORDER,
  AIRTABLE_STATUS_MAP,
  GHL_STAGE_MAP,
  GHL_PIPELINE_STAGE_IDS,
  preserveAdvancedStage,
} from "./funnel-stage";

// Regression: Airtable "ACH Initiated" used to fall through to the
// DEFAULT_STATUS ("signed_up"), collapsing 309 rows to the wrong stage and
// leaving the dashboard funnel showing zero users at ach_initiated.
test("Airtable status map covers every status the Launch List emits", () => {
  assert.equal(AIRTABLE_STATUS_MAP["ACH Initiated"], "ach_initiated");
  assert.equal(AIRTABLE_STATUS_MAP["Funds in Wallet"], "funds_in_wallet");
  assert.equal(AIRTABLE_STATUS_MAP["Run Volume"], "transaction_run");
  // "Verified" is post-signup / pre-transaction — there is no `verified` slug.
  assert.equal(AIRTABLE_STATUS_MAP["Verified"], "signed_up");
  assert.equal(AIRTABLE_STATUS_MAP["Waitlist"], "waitlist");
  assert.equal(AIRTABLE_STATUS_MAP["Booked Call"], "booked_call");
  assert.equal(AIRTABLE_STATUS_MAP["Sent Onboarding"], "sent_onboarding");
  assert.equal(AIRTABLE_STATUS_MAP["Signed Up"], "signed_up");
});

// Regression: three live pipeline stages (Verified, Resend Onboarding,
// Decline Code) had no entry, and /api/sync/highlevel drops any opportunity
// whose stage is unmapped — silently discarding 49 attributed referrals.
test("GHL stage map covers every stage in the User Pipeline", () => {
  for (const id of GHL_PIPELINE_STAGE_IDS) {
    assert.ok(GHL_STAGE_MAP[id], `pipeline stage ${id} has no funnel mapping`);
  }
  assert.equal(GHL_STAGE_MAP["640e68f0-d9a9-42ae-a66d-9f9b72b53e17"], "signed_up");       // Verified
  assert.equal(GHL_STAGE_MAP["f00845d4-2f0b-4149-8bbd-271b2e6fadc7"], "sent_onboarding"); // Resend Onboarding
  assert.equal(GHL_STAGE_MAP["ae3256ed-bba9-4b38-84e0-8436abd5588c"], "signed_up");       // Decline Code
  assert.equal(GHL_STAGE_MAP["cbe0c9e9-52a2-4ce3-a5f2-f881812fd11b"], "funds_in_bank");   // Completed
});

test("every mapped value is a real funnel slug", () => {
  for (const slug of [...Object.values(AIRTABLE_STATUS_MAP), ...Object.values(GHL_STAGE_MAP)]) {
    assert.ok(STAGE_ORDER.includes(slug), `${slug} is not a funnel stage`);
  }
});

// Non-revenue stages must never be mapped into an earning-eligible slug —
// /api/sync/highlevel mints earnings for anything at transaction_run or later.
test("Verified and Decline Code stay below transaction_run", () => {
  const txnIdx = STAGE_ORDER.indexOf("transaction_run");
  for (const id of [
    "640e68f0-d9a9-42ae-a66d-9f9b72b53e17", // Verified
    "ae3256ed-bba9-4b38-84e0-8436abd5588c", // Decline Code
  ]) {
    assert.ok(STAGE_ORDER.indexOf(GHL_STAGE_MAP[id]) < txnIdx);
  }
  assert.ok(STAGE_ORDER.indexOf(AIRTABLE_STATUS_MAP["Verified"]) < txnIdx);
});

test("preserveAdvancedStage still guards against regression", () => {
  assert.equal(
    preserveAdvancedStage("signed_up", { status_slug: "ach_initiated", first_transaction_amount: 500 }),
    "ach_initiated",
  );
  assert.equal(
    preserveAdvancedStage("ach_initiated", { status_slug: "transaction_run", first_transaction_amount: 500 }),
    "ach_initiated",
  );
});
