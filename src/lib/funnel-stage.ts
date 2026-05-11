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
