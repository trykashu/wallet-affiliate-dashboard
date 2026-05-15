/**
 * Flip linked earnings from 'approved' → 'paid' and mirror the
 * "Paid" Commission Status into the Airtable Partner Transaction Log.
 *
 * Idempotent: the .eq("status","approved") guard prevents double-flips
 * and protects 'pending'/'reversed' rows. Safe to call multiple times.
 */
import { patchRecords } from "@/lib/airtable";

const AIRTABLE_TRANSACTIONS_TABLE_ID = "tblyWtDBeiZAqDm8P";
const COMMISSION_STATUS_FIELD = "Commission Status";
const COMMISSION_STATUS_PAID_VALUE = "Paid";

export interface MarkPaidResult {
  earningsMarkedPaid: number;
  airtableUpdated: number;
  airtableErrors: Array<{ record_id: string; error: string }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function markEarningsPaidForPayout(svc: any, payoutId: string): Promise<MarkPaidResult> {
  const result: MarkPaidResult = {
    earningsMarkedPaid: 0,
    airtableUpdated: 0,
    airtableErrors: [],
  };

  const nowIso = new Date().toISOString();
  const { data: paidRows, error: paidError } = await svc
    .from("earnings")
    .update({ status: "paid", updated_at: nowIso })
    .eq("payout_id", payoutId)
    .eq("status", "approved")
    .select("id, transaction_ref");

  if (paidError) {
    console.error("[mark-paid] Mark-paid failed:", paidError);
    return result;
  }

  type PaidRow = { id: string; transaction_ref: string | null };
  const rows = (paidRows ?? []) as PaidRow[];
  result.earningsMarkedPaid = rows.length;

  const baseId = process.env.AIRTABLE_LAUNCH_BASE;
  const recordIds = rows
    .map((r) => r.transaction_ref)
    .filter((r): r is string => !!r);

  if (baseId && recordIds.length > 0) {
    try {
      const patch = await patchRecords(
        baseId,
        AIRTABLE_TRANSACTIONS_TABLE_ID,
        recordIds.map((id) => ({
          id,
          fields: { [COMMISSION_STATUS_FIELD]: COMMISSION_STATUS_PAID_VALUE },
        })),
      );
      result.airtableUpdated = patch.updated;
      result.airtableErrors.push(...patch.failed);
    } catch (e) {
      result.airtableErrors.push({
        record_id: "(setup)",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  } else if (!baseId && recordIds.length > 0) {
    console.warn("[mark-paid] AIRTABLE_LAUNCH_BASE not set; skipping Airtable mirror");
  }

  return result;
}
