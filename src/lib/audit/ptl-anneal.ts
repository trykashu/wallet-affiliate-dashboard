import type { ATRecord } from "./ptl-audit";

/**
 * Build the Partner Transaction Log field object from a User Transactions row,
 * mirroring the upstream automation's template. Pure — no I/O.
 * Caller supplies the resolved Kashu Affiliates record id for `Partner Match`.
 */
export function buildPtlFieldsFromUt(
  ut: ATRecord,
  affiliateRecordId: string,
): Record<string, unknown> {
  const txnId = String(ut.fields["Transaction ID"] ?? "").trim();
  const referrer = (ut.fields["Referrer"] as string[] | undefined)?.[0]?.trim() ?? "";
  const emailArr = ut.fields["Email"] as string[] | undefined;
  const last4Raw = ut.fields["Last 4"];

  const fields: Record<string, unknown> = {
    "Transaction ID": txnId,
    "Amount": Number(ut.fields["Amount"]) || 0,
    // Exact string Airtable stores — note the space before % (matches upstream automation).
    "Funnel %": "8.5 %",
    // Airtable returns linked-record values as string[]; the attribution ID is always [0].
    "Referrer": referrer,
    "Commission Status": "Owed",
    "Transaction Type": (ut.fields["Transaction Type"] as string | undefined) ?? "Transfer In",
    "Transaction Date": (ut.fields["Date Txn Started"] as string | undefined) ?? null,
    "Partner Match": [affiliateRecordId],
    "User Email": emailArr?.[0] ?? null,
  };
  const last4Num = Number(last4Raw);
  if (last4Raw !== undefined && last4Raw !== null && last4Raw !== "" && !Number.isNaN(last4Num)) {
    fields["Last 4 of Card"] = last4Num;
  }
  if (ut.fields["Card Issuer"]) fields["Card Issuer"] = ut.fields["Card Issuer"];

  // Strip nulls/empties — Airtable rejects null on some types.
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== ""));
}
