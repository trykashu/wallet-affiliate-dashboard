/**
 * Parse the optional scope on POST /api/admin/payouts/execute-batch.
 *
 * Scope narrows which `requested` payouts get sent:
 *   - no body        -> every requested payout
 *   - batch_id       -> one batch
 *   - payout_ids     -> exactly those payouts (used by Retry, which must send
 *                       only the payout that was retried, not everything else
 *                       queued in the same batch)
 *
 * A malformed scope THROWS rather than falling back to "no scope". Silently
 * widening would send real ACH transfers the operator never asked for.
 */
export interface ExecuteScope {
  batchId: string | null;
  payoutIds: string[] | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PAYOUT_IDS = 500;

export function parseExecuteScope(body: unknown): ExecuteScope {
  if (body === undefined || body === null) return { batchId: null, payoutIds: null };
  if (typeof body !== "object") return { batchId: null, payoutIds: null };

  const raw = body as Record<string, unknown>;
  let batchId: string | null = null;
  let payoutIds: string[] | null = null;

  if (raw.batch_id !== undefined) {
    if (typeof raw.batch_id !== "string") throw new Error("batch_id must be a string");
    batchId = raw.batch_id;
  }

  if (raw.payout_ids !== undefined) {
    if (!Array.isArray(raw.payout_ids)) throw new Error("payout_ids must be an array");
    if (raw.payout_ids.length === 0) throw new Error("payout_ids must not be empty");
    if (raw.payout_ids.length > MAX_PAYOUT_IDS) throw new Error("too many payout_ids");
    for (const id of raw.payout_ids) {
      if (typeof id !== "string" || !UUID_RE.test(id)) throw new Error("payout_ids must be uuids");
    }
    payoutIds = raw.payout_ids as string[];
  }

  return { batchId, payoutIds };
}
