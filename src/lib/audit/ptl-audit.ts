/**
 * Pure audit helpers for Partner Transaction Log vs User Transactions.
 *
 * For each month we report:
 *   - orphans:  PTL rows whose Transaction ID has no matching UT row
 *               (these are commissions on transactions that don't exist —
 *                refunds, typos, or manual entries gone wrong)
 *   - drifts:   PTL rows whose Amount diverges from the matching UT row
 *   - missing:  UT Transfer In rows with a referrer that should be in PTL
 *               but aren't. Excludes Payova (whitelabel — separate flow)
 *               and 1ATEST (test attribution).
 */

export interface ATRecord {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
}

export interface OrphanRow {
  ptl_id: string;
  user_email: string;
  amount: number;
  transaction_id: string;
  transaction_date: string;
}
export interface DriftRow {
  ptl_id: string;
  transaction_id: string;
  ptl_amount: number;
  ut_amount: number;
  delta: number;
}
export interface MissingRow {
  ut_id: string;
  user_email: string;
  referrer: string;
  amount: number;
  transaction_id: string;
  transaction_date: string;
}

export interface MonthAudit {
  month: string;                 // "2026-05"
  ptl_count: number;
  ptl_sum: number;
  ut_match_sum: number;
  orphans: OrphanRow[];
  drifts: DriftRow[];
  missing: MissingRow[];
}

export interface AuditConfig {
  /** Attribution IDs to skip on the "missing from PTL" side. */
  excludedReferrers: Set<string>;
}

const DEFAULT_CONFIG: AuditConfig = {
  excludedReferrers: new Set([
    "j8cLWN1Z4HPh8Z", // Travis Marker / Payova — whitelabel; separate Payova Statements
    "1ATEST",          // test attribution
  ]),
};

function getMonth(iso: string | undefined): string | null {
  if (!iso) return null;
  return iso.slice(0, 7);
}

export function auditPtlVsUt(
  ptlRecords: ATRecord[],
  utRecords: ATRecord[],
  config: AuditConfig = DEFAULT_CONFIG,
): MonthAudit[] {
  // Index UT by Transaction ID
  const utByTxnId = new Map<string, ATRecord>();
  for (const r of utRecords) {
    const raw = r.fields["Transaction ID"];
    if (!raw) continue;
    const id = String(raw).trim();
    if (id) utByTxnId.set(id, r);
  }

  // Build per-month buckets keyed by PTL's Transaction Date OR UT's Date Txn Started
  const months = new Map<string, MonthAudit>();
  function getBucket(month: string): MonthAudit {
    let b = months.get(month);
    if (!b) {
      b = { month, ptl_count: 0, ptl_sum: 0, ut_match_sum: 0, orphans: [], drifts: [], missing: [] };
      months.set(month, b);
    }
    return b;
  }

  // PTL pass
  const ptlTxnIds = new Set<string>();
  for (const p of ptlRecords) {
    const txnId = ((p.fields["Transaction ID"] as string | undefined) ?? "").trim();
    if (txnId) ptlTxnIds.add(txnId);
    const month = getMonth((p.fields["Transaction Date"] as string | undefined) ?? "") ?? "unknown";
    const bucket = getBucket(month);
    const amt = Number(p.fields["Amount"]) || 0;
    bucket.ptl_count++;
    bucket.ptl_sum += amt;

    if (!txnId) {
      bucket.orphans.push({
        ptl_id: p.id,
        user_email: (p.fields["User Email"] as string | undefined) ?? "",
        amount: amt,
        transaction_id: "(none)",
        transaction_date: (p.fields["Transaction Date"] as string | undefined) ?? "",
      });
      continue;
    }
    const u = utByTxnId.get(txnId);
    if (!u) {
      bucket.orphans.push({
        ptl_id: p.id,
        user_email: (p.fields["User Email"] as string | undefined) ?? "",
        amount: amt,
        transaction_id: txnId,
        transaction_date: (p.fields["Transaction Date"] as string | undefined) ?? "",
      });
      continue;
    }
    const uAmt = Number(u.fields["Amount"]) || 0;
    bucket.ut_match_sum += uAmt;
    if (Math.abs(uAmt - amt) > 0.01) {
      bucket.drifts.push({
        ptl_id: p.id,
        transaction_id: txnId,
        ptl_amount: amt,
        ut_amount: uAmt,
        delta: uAmt - amt,
      });
    }
  }

  // UT pass — find Transfer Ins with referrer that aren't in PTL
  for (const u of utRecords) {
    const type = (u.fields["Transaction Type"] as string | undefined) ?? "";
    if (type !== "Transfer In") continue;
    const refArr = u.fields["Referrer"] as string[] | undefined;
    const ref = refArr?.[0]?.trim();
    if (!ref) continue;
    if (config.excludedReferrers.has(ref)) continue;
    const txnId = ((u.fields["Transaction ID"] as string | undefined) ?? "").trim();
    if (!txnId) continue;
    if (ptlTxnIds.has(txnId)) continue;

    const month = getMonth((u.fields["Date Txn Started"] as string | undefined) ?? "") ?? "unknown";
    const bucket = getBucket(month);
    const emailArr = u.fields["Email"] as string[] | undefined;
    bucket.missing.push({
      ut_id: u.id,
      user_email: emailArr?.[0] ?? "",
      referrer: ref,
      amount: Number(u.fields["Amount"]) || 0,
      transaction_id: txnId,
      transaction_date: (u.fields["Date Txn Started"] as string | undefined) ?? "",
    });
  }

  return Array.from(months.values()).sort((a, b) => b.month.localeCompare(a.month));
}
