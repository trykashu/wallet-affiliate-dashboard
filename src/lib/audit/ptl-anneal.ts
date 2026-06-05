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

const PTL_TABLE = "tbluxSVVoAuhEWLd7";
const UT_TABLE = "tblyWtDBeiZAqDm8P";
const AFFILIATES_TABLE = "tbl9OoVL64Z1GiNzU";
const AT = "https://api.airtable.com/v0";

export interface AnnealDeps {
  affiliateBase: string;
  launchBase: string;
  pat: string;
}

export class AnnealError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
  }
}

/**
 * Create a PTL row for the given User Transactions record id.
 * Resolves the referrer to a Kashu Affiliates record, refuses if a PTL row
 * already exists for the Transaction ID. Returns the new PTL record id.
 */
export async function createPtlRowFromUt(
  utRecordId: string,
  deps: AnnealDeps,
): Promise<{ ptl_id: string; transaction_id: string }> {
  const { affiliateBase, launchBase, pat } = deps;
  const auth = { Authorization: `Bearer ${pat}` };

  const utRes = await fetch(`${AT}/${launchBase}/${UT_TABLE}/${utRecordId}`, { headers: auth, cache: "no-store" });
  if (!utRes.ok) throw new AnnealError(`UT fetch ${utRes.status}`, 502);
  const ut = (await utRes.json()) as ATRecord;

  const txnId = String(ut.fields["Transaction ID"] ?? "").trim();
  if (!txnId) throw new AnnealError("UT row has no Transaction ID", 422);

  const dupeFilter = encodeURIComponent(`{Transaction ID}='${txnId}'`);
  const dupeRes = await fetch(`${AT}/${affiliateBase}/${PTL_TABLE}?filterByFormula=${dupeFilter}&maxRecords=1`, { headers: auth, cache: "no-store" });
  const dupeJ = (await dupeRes.json()) as { records?: Array<{ id: string }> };
  if (dupeJ.records && dupeJ.records.length > 0) {
    throw new AnnealError(`PTL row already exists for TxnID ${txnId}: ${dupeJ.records[0].id}`, 409);
  }

  const referrer = (ut.fields["Referrer"] as string[] | undefined)?.[0]?.trim();
  if (!referrer) throw new AnnealError("UT row has no Referrer", 422);
  const affFilter = encodeURIComponent(`{Attribution ID}='${referrer}'`);
  const affRes = await fetch(`${AT}/${affiliateBase}/${AFFILIATES_TABLE}?filterByFormula=${affFilter}&maxRecords=1`, { headers: auth, cache: "no-store" });
  const affJ = (await affRes.json()) as { records?: Array<{ id: string }> };
  const affiliateRecordId = affJ.records?.[0]?.id;
  if (!affiliateRecordId) throw new AnnealError(`No Kashu Affiliates row for referrer ${referrer}`, 404);

  const cleaned = buildPtlFieldsFromUt(ut, affiliateRecordId);
  const createRes = await fetch(`${AT}/${affiliateBase}/${PTL_TABLE}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ records: [{ fields: cleaned }], typecast: true }),
  });
  const createJ = await createRes.json();
  if (!createRes.ok) throw new AnnealError(`PTL create ${createRes.status}: ${JSON.stringify(createJ).slice(0, 300)}`, 502);
  const created = (createJ as { records: Array<{ id: string }> }).records[0];
  return { ptl_id: created.id, transaction_id: txnId };
}
