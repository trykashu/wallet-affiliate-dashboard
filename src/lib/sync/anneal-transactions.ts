/**
 * Pure annealing helpers for the User Transactions sync.
 *
 * Real-world problem: Airtable's "User Transactions" table sometimes ends up
 * with two records describing the same wallet transaction (same Kashu
 * `Transaction ID`). The upstream-side dedup is manual; meanwhile the local
 * sync upserts by `airtable_record_id`, so it happily writes both rows.
 *
 * Annealing rules:
 *  - Canonical Airtable record per wallet `Transaction ID` = the OLDEST
 *    `createdTime`. (User decision: the original is the source of truth;
 *    later "shadow" copies are treated as garbage.)
 *  - Records missing a `Transaction ID` are passed through 1:1 (they can't
 *    be deduped — we have no natural key).
 *  - Orphans = local transactions whose airtable_record_id is in neither the
 *    canonical set nor any of the loser sets. These were deleted upstream
 *    and should be hard-deleted locally.
 */

export interface AirtableInputRecord {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
}

export interface DedupResult {
  /** The records to upsert into the transactions table. */
  canonical: AirtableInputRecord[];
  /**
   * For each canonical record id, the list of OTHER Airtable record ids
   * that shared its wallet `Transaction ID`. Earnings pointing to any of
   * these losers should be migrated to the canonical id (or deleted if a
   * canonical earning already exists).
   */
  loserToCanonical: Map<string, string>;
  /** Logical-dedup info for observability. */
  duplicates: Array<{ transaction_id: string; canonical_id: string; loser_ids: string[] }>;
}

/**
 * Group Airtable records by wallet `Transaction ID`, pick canonical, return
 * structured result. The `Transaction ID` field on Airtable is typed as a
 * string or number; we coerce to string for grouping.
 */
export function dedupAirtableTransactions(records: AirtableInputRecord[]): DedupResult {
  const byTxnId = new Map<string, AirtableInputRecord[]>();
  const noTxnId: AirtableInputRecord[] = [];

  for (const r of records) {
    const raw = r.fields["Transaction ID"];
    const txnId = raw === undefined || raw === null || raw === "" ? null : String(raw).trim();
    if (!txnId) {
      noTxnId.push(r);
      continue;
    }
    const bucket = byTxnId.get(txnId) ?? [];
    bucket.push(r);
    byTxnId.set(txnId, bucket);
  }

  const canonical: AirtableInputRecord[] = [...noTxnId];
  const loserToCanonical = new Map<string, string>();
  const duplicates: DedupResult["duplicates"] = [];

  for (const [txnId, bucket] of byTxnId.entries()) {
    if (bucket.length === 1) {
      canonical.push(bucket[0]);
      continue;
    }
    // Oldest createdTime wins. Stable lex sort works because Airtable's
    // createdTime is ISO-8601 (e.g. "2026-06-01T22:03:12.000Z").
    const sorted = [...bucket].sort((a, b) => a.createdTime.localeCompare(b.createdTime));
    const winner = sorted[0];
    canonical.push(winner);
    const losers = sorted.slice(1);
    for (const l of losers) loserToCanonical.set(l.id, winner.id);
    duplicates.push({
      transaction_id: txnId,
      canonical_id: winner.id,
      loser_ids: losers.map((l) => l.id),
    });
  }

  return { canonical, loserToCanonical, duplicates };
}

/**
 * Decide what to do with an earning whose transaction_ref points to a loser
 * airtable_record_id. Returns either:
 *  - { action: "migrate", to: <canonical_airtable_record_id> }    — repoint it
 *  - { action: "delete" }                                          — duplicate of canonical earning
 *  - { action: "warn",  reason: string }                           — paid/reversed; needs manual review
 */
export type EarningReconcileAction =
  | { action: "migrate"; to: string }
  | { action: "delete" }
  | { action: "warn"; reason: string };

export function decideEarningAction(
  earning: { status: string; transaction_ref: string },
  canonicalAirtableId: string,
  canonicalHasEarning: boolean,
): EarningReconcileAction {
  if (earning.status === "paid" || earning.status === "reversed") {
    return {
      action: "warn",
      reason: `Earning is ${earning.status}; orphan transaction_ref ${earning.transaction_ref} → canonical ${canonicalAirtableId} would require manual reconciliation`,
    };
  }
  // pending | approved
  if (canonicalHasEarning) return { action: "delete" };
  return { action: "migrate", to: canonicalAirtableId };
}
