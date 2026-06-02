/**
 * POST { ut_record_id }
 * Reads the User Transactions row, resolves the referrer to a Kashu
 * Affiliates record id, and creates a Partner Transaction Log row mirroring
 * the template shape used by the upstream automation.
 *
 * Refuses if a PTL row already exists for that Transaction ID.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";

export const dynamic = "force-dynamic";

const Body = z.object({ ut_record_id: z.string().min(1) });

const PTL_TABLE = "tbluxSVVoAuhEWLd7";
const UT_TABLE = "tblyWtDBeiZAqDm8P";
const AFFILIATES_TABLE = "tbl9OoVL64Z1GiNzU";

export async function POST(req: Request) {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const affiliateBase = process.env.AIRTABLE_AFFILIATE_BASE?.replace(/\\n|"|\s/g, "");
  const launchBase = process.env.AIRTABLE_LAUNCH_BASE?.replace(/\\n|"|\s/g, "");
  const pat = process.env.AIRTABLE_PAT?.replace(/\\n|"|\s/g, "");
  if (!affiliateBase || !launchBase || !pat) {
    return NextResponse.json({ error: "Airtable not configured" }, { status: 500 });
  }

  try {
    // 1. Pull the UT row
    const utRes = await fetch(
      `https://api.airtable.com/v0/${launchBase}/${UT_TABLE}/${parsed.data.ut_record_id}`,
      { headers: { Authorization: `Bearer ${pat}` }, cache: "no-store" },
    );
    if (!utRes.ok) {
      return NextResponse.json({ error: `UT fetch ${utRes.status}` }, { status: 502 });
    }
    const ut = (await utRes.json()) as { id: string; fields: Record<string, unknown> };
    const txnId = (ut.fields["Transaction ID"] as string | undefined)?.trim() ?? "";
    if (!txnId) {
      return NextResponse.json({ error: "UT row has no Transaction ID" }, { status: 422 });
    }

    // 2. Refuse if PTL already has a row for this Transaction ID
    const dupeFilter = encodeURIComponent(`{Transaction ID}='${txnId}'`);
    const dupeRes = await fetch(
      `https://api.airtable.com/v0/${affiliateBase}/${PTL_TABLE}?filterByFormula=${dupeFilter}&maxRecords=1`,
      { headers: { Authorization: `Bearer ${pat}` }, cache: "no-store" },
    );
    const dupeJ = (await dupeRes.json()) as { records?: Array<{ id: string }> };
    if (dupeJ.records && dupeJ.records.length > 0) {
      return NextResponse.json(
        { error: `PTL row already exists for TxnID ${txnId}: ${dupeJ.records[0].id}` },
        { status: 409 },
      );
    }

    // 3. Resolve referrer (attribution_id) to a Kashu Affiliates record id
    const refArr = ut.fields["Referrer"] as string[] | undefined;
    const referrer = refArr?.[0]?.trim();
    if (!referrer) {
      return NextResponse.json({ error: "UT row has no Referrer" }, { status: 422 });
    }
    const affFilter = encodeURIComponent(`{Attribution ID}='${referrer}'`);
    const affRes = await fetch(
      `https://api.airtable.com/v0/${affiliateBase}/${AFFILIATES_TABLE}?filterByFormula=${affFilter}&maxRecords=1`,
      { headers: { Authorization: `Bearer ${pat}` }, cache: "no-store" },
    );
    const affJ = (await affRes.json()) as { records?: Array<{ id: string }> };
    const affiliateRecordId = affJ.records?.[0]?.id;
    if (!affiliateRecordId) {
      return NextResponse.json(
        { error: `No Kashu Affiliates row for referrer ${referrer}` },
        { status: 404 },
      );
    }

    // 4. Build the PTL row mirroring the upstream automation's template
    const emailArr = ut.fields["Email"] as string[] | undefined;
    const last4Raw = ut.fields["Last 4"];
    const fields: Record<string, unknown> = {
      "Transaction ID": txnId,
      "Amount": Number(ut.fields["Amount"]) || 0,
      "Funnel %": "8.5 %",
      "Referrer": referrer,
      "Commission Status": "Owed",
      "Transaction Type": (ut.fields["Transaction Type"] as string | undefined) ?? "Transfer In",
      "Transaction Date": (ut.fields["Date Txn Started"] as string | undefined) ?? null,
      "Partner Match": [affiliateRecordId],
      "User Email": emailArr?.[0] ?? null,
    };
    if (last4Raw !== undefined && last4Raw !== null && last4Raw !== "") {
      fields["Last 4 of Card"] = Number(last4Raw);
    }
    if (ut.fields["Card Issuer"]) fields["Card Issuer"] = ut.fields["Card Issuer"];
    // Strip nulls — Airtable rejects null on some types
    const cleaned = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== ""));

    const createRes = await fetch(`https://api.airtable.com/v0/${affiliateBase}/${PTL_TABLE}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: [{ fields: cleaned }], typecast: true }),
    });
    const createJ = await createRes.json();
    if (!createRes.ok) {
      return NextResponse.json(
        { error: `PTL create ${createRes.status}: ${JSON.stringify(createJ).slice(0, 300)}` },
        { status: 502 },
      );
    }
    const created = (createJ as { records: Array<{ id: string; fields: Record<string, unknown> }> }).records[0];
    return NextResponse.json({
      ok: true,
      ptl_id: created.id,
      transaction_id: txnId,
      commission_owed: created.fields["Commission Owed"] ?? null,
    });
  } catch (e) {
    console.error("[audit-ptl/create-row] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Create failed" },
      { status: 500 },
    );
  }
}
