/**
 * Which manual payout status changes an operator may make.
 *
 * /api/admin/payouts/update-status is a MANUAL flip — it never calls Mercury.
 * Moving a payout to `requested` only makes it eligible for the next
 * execute-batch run; moving it to `completed` marks its earnings paid without
 * any transfer occurring, which is why that path exists only to record a
 * payment made outside the system.
 *
 * `requested` is restricted to retrying a failed payout. Allowing it from
 * `completed` would silently reopen a settled payout and let the same earnings
 * be paid twice.
 */
export type ManualPayoutStatus = "completed" | "failed" | "requested";

export function canTransitionPayoutStatus(
  from: string | null | undefined,
  to: ManualPayoutStatus,
): boolean {
  if (to === "requested") return from === "failed";
  // completed / failed stay reachable from any state — finance uses them to
  // reconcile transfers made outside the app.
  return true;
}
