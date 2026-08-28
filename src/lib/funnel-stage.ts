import type { FunnelStatusSlug } from "@/types/database";

/** Canonical funnel stage ordering. Indexed access yields "is more advanced than". */
export const STAGE_ORDER: FunnelStatusSlug[] = [
  "waitlist",
  "booked_call",
  "sent_onboarding",
  "signed_up",
  "transaction_run",
  "funds_in_wallet",
  "ach_initiated",
  "funds_in_bank",
];

/** Stages at or past transaction_run. Once a referred user is here, the CRM-pulled
 *  status must not regress them — they've proven they transacted regardless of CRM lifecycle. */
export const TRANSACTED_OR_PAST = new Set<FunnelStatusSlug>([
  "transaction_run",
  "funds_in_wallet",
  "ach_initiated",
  "funds_in_bank",
]);

/** Returns the slug to write to status_slug, given an incoming (CRM-derived) slug
 *  and the existing row state. Never regresses below transaction_run if the existing
 *  row has a recorded first transaction or is already past. */
export function preserveAdvancedStage(
  incoming: FunnelStatusSlug,
  existing: { status_slug: string; first_transaction_amount: number | null } | undefined,
): FunnelStatusSlug {
  if (!existing) return incoming;
  const hasTransaction =
    existing.first_transaction_amount != null && existing.first_transaction_amount > 0;
  const existingIsAdvanced = TRANSACTED_OR_PAST.has(existing.status_slug as FunnelStatusSlug);
  if (hasTransaction || existingIsAdvanced) {
    const existingSlug = existing.status_slug as FunnelStatusSlug;
    const existingIdx = STAGE_ORDER.indexOf(existingSlug);
    const incomingIdx = STAGE_ORDER.indexOf(incoming);
    if (existingIdx === -1) return incoming;
    if (incomingIdx === -1) return existingSlug;
    return incomingIdx > existingIdx ? incoming : existingSlug;
  }
  return incoming;
}

/**
 * Airtable Launch List "Status" → funnel slug.
 *
 * MUST cover every option on the Launch List `Status` single-select. Anything
 * missing silently falls back to `signed_up` in /api/sync/users, which is how
 * 309 "ACH Initiated" rows were collapsed into signed_up and the dashboard
 * funnel came to show zero users at ach_initiated.
 *
 * There is no `verified` funnel slug — "Verified" is post-signup and
 * pre-transaction, so it maps to `signed_up` deliberately, not by fallback.
 */
export const AIRTABLE_STATUS_MAP: Record<string, FunnelStatusSlug> = {
  Waitlist: "waitlist",
  "Booked Call": "booked_call",
  "Sent Onboarding": "sent_onboarding",
  "Signed Up": "signed_up",
  Verified: "signed_up",
  "Run Volume": "transaction_run",
  "Funds in Wallet": "funds_in_wallet",
  "ACH Initiated": "ach_initiated",
};

/**
 * HighLevel "User Pipeline" stage id → funnel slug.
 *
 * /api/sync/highlevel DROPS any opportunity whose stage is absent here
 * (`if (!stageSlug) continue`), so an unmapped stage silently discards
 * referrals. Keep in sync with the live pipeline (zNiCun5Y5koEsWmN9bDo) —
 * verify with GET /opportunities/pipelines whenever stages are added.
 *
 * "Verified" and "Decline Code" map below transaction_run on purpose: stages at
 * or past transaction_run mint earnings, and neither represents a completed
 * transaction.
 */
export const GHL_STAGE_MAP: Record<string, FunnelStatusSlug> = {
  "646161a6-5828-45fb-aa54-afe4a934ff01": "waitlist",         // Waitlist
  "f3c920bf-e4cf-484b-8668-78a5d4c32b98": "booked_call",      // AA Form Submitted
  "f00845d4-2f0b-4149-8bbd-271b2e6fadc7": "sent_onboarding",  // Resend Onboarding
  "e401618b-380a-4251-ad29-af83ca4763f1": "sent_onboarding",  // Sent Onboarding
  "4dfbdc90-34bf-4fda-98bf-bd132d3e6ccb": "signed_up",        // Signed Up
  "640e68f0-d9a9-42ae-a66d-9f9b72b53e17": "signed_up",        // Verified
  "ae3256ed-bba9-4b38-84e0-8436abd5588c": "signed_up",        // Decline Code
  "e6dbdff4-e956-4e9d-bf0e-ec6ac650021f": "transaction_run",  // TXN Run
  "0d45590d-a3ca-4007-b4c1-e0e5e0593db0": "funds_in_wallet",  // Funds in Wallet
  "c31b2be3-ae36-4ea1-b79c-bb4150dbe9f9": "ach_initiated",    // ACH Initiated
  "cbe0c9e9-52a2-4ce3-a5f2-f881812fd11b": "funds_in_bank",    // Completed
};

/** Every stage id on the live User Pipeline, for coverage assertions. */
export const GHL_PIPELINE_STAGE_IDS: string[] = Object.keys(GHL_STAGE_MAP);
