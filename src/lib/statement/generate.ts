/**
 * Core statement-generation logic, callable from both the admin route
 * (manual "Generate" button) and execute-batch (auto-generate on wire send).
 *
 * Renders the PDF, uploads to Supabase Storage, mirrors to Airtable
 * (best-effort). Returns a structured result.
 */
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { StatementDocument } from "@/lib/statement/StatementDocument";
import {
  buildStatementNumber,
  commissionRatePct,
  formatPeriodLabel,
} from "@/lib/statement/builders";
import type { StatementData } from "@/lib/statement/types";
import { markEarningsPaidForPayout } from "@/lib/payouts/mark-paid";

export type StatementResult =
  | {
      ok: true;
      statement_number: string;
      pdf_byte_length: number;
      period: string;
      eligible_count: number;
      commission_due: number;
      url: string;
      storage_path: string;
      airtable_record_id: string | null;
      airtable_error: string | null;
      earnings_marked_paid: number;
      airtable_txn_updated: number;
      airtable_txn_failed: number;
    }
  | {
      ok: false;
      status: number;
      error: string;
      reason?: string;
    };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateStatement(svc: any, payoutId: string): Promise<StatementResult> {
  // 1. Fetch payout
  const { data: payout, error: payoutErr } = await svc
    .from("payouts")
    .select("id, affiliate_id, payout_account_id, amount, period, status, created_at")
    .eq("id", payoutId)
    .maybeSingle();
  if (payoutErr) {
    console.error("[statement] payout fetch failed:", payoutErr);
    return { ok: false, status: 500, error: "Database error" };
  }
  if (!payout) return { ok: false, status: 404, error: "Payout not found" };
  if (!payout.period) return { ok: false, status: 422, error: "Payout has no period set" };

  // 2. Fetch affiliate, account, earnings in parallel
  const [affResp, acctResp, earningsResp] = await Promise.all([
    svc
      .from("affiliates")
      .select("id, agent_name, tier, email, phone, custom_commission_rate, attribution_id")
      .eq("id", payout.affiliate_id)
      .maybeSingle(),
    svc
      .from("payout_accounts")
      .select("account_number_last4, address1, address2, city, region, postal_code, country")
      .eq("id", payout.payout_account_id)
      .maybeSingle(),
    svc
      .from("earnings")
      .select("id, amount, transaction_fee_amount, transaction_ref, referred_user_id")
      .eq("payout_id", payoutId),
  ]);

  if (affResp.error || acctResp.error || earningsResp.error) {
    console.error("[statement] secondary fetch failed", {
      aff: affResp.error,
      acct: acctResp.error,
      earnings: earningsResp.error,
    });
    return { ok: false, status: 500, error: "Database error" };
  }

  const affiliate = affResp.data;
  const account = acctResp.data;
  const earnings = (earningsResp.data ?? []) as Array<{
    id: string;
    amount: number;
    transaction_fee_amount: number;
    transaction_ref: string | null;
    referred_user_id: string;
  }>;

  if (!affiliate) return { ok: false, status: 404, error: "Affiliate not found" };
  if (!account) return { ok: false, status: 404, error: "Payout account not found" };

  if (!account.address1 || !account.city || !account.region || !account.postal_code) {
    return {
      ok: false,
      status: 422,
      error: "Affiliate is missing address — Re-verify bank from PandaDoc",
      reason: "missing_address",
    };
  }

  // 3. Resolve referred-user names + transaction dates + amounts
  const referredUserIds = Array.from(new Set(earnings.map((e) => e.referred_user_id)));
  const txnRefs = earnings.map((e) => e.transaction_ref).filter((r): r is string => !!r);

  const [usersResp, txnsResp] = await Promise.all([
    referredUserIds.length > 0
      ? svc.from("referred_users").select("id, full_name").in("id", referredUserIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }> }),
    txnRefs.length > 0
      ? svc
          .from("transactions")
          .select("airtable_record_id, transaction_date, amount")
          .in("airtable_record_id", txnRefs)
      : Promise.resolve({
          data: [] as Array<{
            airtable_record_id: string;
            transaction_date: string | null;
            amount: number | null;
          }>,
        }),
  ]);

  type UserRow = { id: string; full_name: string };
  type TxnRow = {
    airtable_record_id: string;
    transaction_date: string | null;
    amount: number | null;
  };
  const userMap = new Map<string, string>();
  for (const u of (usersResp.data ?? []) as UserRow[]) userMap.set(u.id, u.full_name);
  const txnDateMap = new Map<string, string | null>();
  const txnAmountMap = new Map<string, number>();
  for (const t of (txnsResp.data ?? []) as TxnRow[]) {
    txnDateMap.set(t.airtable_record_id, t.transaction_date);
    txnAmountMap.set(t.airtable_record_id, Number(t.amount) || 0);
  }

  // 4. Build StatementData
  const ratePct = commissionRatePct(affiliate.tier, affiliate.custom_commission_rate);
  const displayTier: "gold" | "platinum" =
    affiliate.tier === "platinum" ? "platinum" : "gold";

  const rowsWithSortKey = earnings.map((e) => {
    const dateRaw = e.transaction_ref ? txnDateMap.get(e.transaction_ref) ?? null : null;
    const dateLabel = dateRaw
      ? new Date(dateRaw).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "—";
    return {
      sortKey: dateRaw ?? "",
      date: dateLabel,
      client: userMap.get(e.referred_user_id) ?? "Unknown",
      transaction_amount: e.transaction_ref ? txnAmountMap.get(e.transaction_ref) ?? 0 : 0,
      fee_collected: Number(e.transaction_fee_amount) || 0,
      commission: Number(e.amount) || 0,
    };
  });
  rowsWithSortKey.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const rows = rowsWithSortKey.map(({ sortKey: _sortKey, ...rest }) => rest);

  const totals = {
    eligible_count: rows.length,
    total_fees: rows.reduce((s, r) => s + r.fee_collected, 0),
    commission_due: rows.reduce((s, r) => s + r.commission, 0),
    commission_rate_pct: ratePct,
  };

  const data: StatementData = {
    statement_number: buildStatementNumber(payout.period, payout.affiliate_id),
    statement_date: new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    period_label: formatPeriodLabel(payout.period),
    affiliate: {
      name: affiliate.agent_name,
      tier: displayTier,
      address1: account.address1,
      address2: account.address2,
      city: account.city,
      region: account.region,
      postal_code: account.postal_code,
      phone: affiliate.phone,
      email: affiliate.email,
      account_last4: account.account_number_last4 ?? "????",
    },
    transactions: rows,
    totals,
  };

  // 5. Render PDF buffer
  const pdfBuffer = await renderToBuffer(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(StatementDocument, { data }) as any,
  );

  // 6. Upload to Supabase Storage
  const storagePath = `statements/${payout.period}/${payout.affiliate_id}.pdf`;
  const { error: uploadErr } = await svc.storage
    .from("affiliate-statements")
    .upload(storagePath, pdfBuffer, {
      upsert: true,
      contentType: "application/pdf",
    });
  if (uploadErr) {
    console.error("[statement] Supabase upload failed:", uploadErr);
    return { ok: false, status: 500, error: `Supabase upload failed: ${uploadErr.message}` };
  }

  const { data: publicUrlData } = svc.storage.from("affiliate-statements").getPublicUrl(storagePath);
  const supabaseUrl: string = (publicUrlData.publicUrl as string).replace(/\s/g, "");

  // 7. Mirror to Airtable — best-effort
  let airtableRecordId: string | null = null;
  let airtableError: string | null = null;
  const airtableBaseId = process.env.AIRTABLE_AFFILIATE_BASE?.replace(/\\n|"|\s/g, "");
  const statementsTableId = process.env.AIRTABLE_STATEMENTS_TABLE?.replace(/\\n|"|\s/g, "");
  const airtablePat = process.env.AIRTABLE_PAT?.replace(/\\n|"|\s/g, "");
  const affiliateTableId = process.env.AIRTABLE_AFFILIATE_TABLE?.replace(/\\n|"|\s/g, "");

  if (airtableBaseId && statementsTableId && airtablePat) {
    try {
      const attributionId = affiliate.attribution_id as string;
      const filter = encodeURIComponent(
        `AND({Period}='${payout.period}', {Attribution ID}='${attributionId}')`,
      );
      const listUrl = `https://api.airtable.com/v0/${airtableBaseId}/${statementsTableId}?filterByFormula=${filter}&maxRecords=1`;
      const listRes = await fetch(listUrl, {
        headers: { Authorization: `Bearer ${airtablePat}` },
        cache: "no-store",
      });
      if (!listRes.ok) throw new Error(`Airtable list ${listRes.status}`);
      const listJson = (await listRes.json()) as { records?: Array<{ id: string }> };
      const existingId = listJson.records?.[0]?.id ?? null;

      let affiliateRecordId: string | null = null;
      if (affiliateTableId) {
        try {
          const affFilter = encodeURIComponent(`{Attribution ID}='${attributionId}'`);
          const affRes = await fetch(
            `https://api.airtable.com/v0/${airtableBaseId}/${affiliateTableId}?filterByFormula=${affFilter}&maxRecords=1`,
            {
              headers: { Authorization: `Bearer ${airtablePat}` },
              cache: "no-store",
            },
          );
          if (affRes.ok) {
            const j = (await affRes.json()) as { records?: Array<{ id: string }> };
            affiliateRecordId = j.records?.[0]?.id ?? null;
          }
        } catch {
          // ignore — link is best-effort
        }
      }

      const fields: Record<string, unknown> = {
        Name: data.statement_number,
        "Attribution ID": attributionId,
        Period: payout.period,
        "Generated At": new Date().toISOString(),
        PDF: [{ url: supabaseUrl, filename: `${data.statement_number}.pdf` }],
        "Statement URL": supabaseUrl,
        "Total Fees Collected": totals.total_fees,
        "Commission Due": totals.commission_due,
        "Statement Number": data.statement_number,
        // Statements are generated post-wire (either auto on execute-batch
        // success, or manually by an AM after the wire fires), so the
        // commission is already paid by the time this row exists.
        "Commission Status": "Paid",
      };
      if (affiliateRecordId) fields.Affiliate = [affiliateRecordId];

      let writeRes: Response;
      if (existingId) {
        writeRes = await fetch(
          `https://api.airtable.com/v0/${airtableBaseId}/${statementsTableId}/${existingId}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${airtablePat}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ fields }),
          },
        );
      } else {
        writeRes = await fetch(
          `https://api.airtable.com/v0/${airtableBaseId}/${statementsTableId}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${airtablePat}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ fields }),
          },
        );
      }
      if (!writeRes.ok) {
        const txt = await writeRes.text().catch(() => "");
        throw new Error(`Airtable write ${writeRes.status}: ${txt.slice(0, 200)}`);
      }
      const writeJson = (await writeRes.json()) as { id: string };
      airtableRecordId = writeJson.id;
    } catch (e) {
      airtableError = e instanceof Error ? e.message : String(e);
      console.error("[statement] Airtable mirror failed:", airtableError);
    }
  } else {
    airtableError = "Airtable env vars not configured";
  }

  // 8. Flip linked earnings → 'paid' and mirror Commission Status in
  // the Airtable Partner Transaction Log. Idempotent.
  const markResult = await markEarningsPaidForPayout(svc, payoutId);

  return {
    ok: true,
    statement_number: data.statement_number,
    pdf_byte_length: pdfBuffer.length,
    period: payout.period,
    eligible_count: totals.eligible_count,
    commission_due: totals.commission_due,
    url: supabaseUrl,
    storage_path: storagePath,
    airtable_record_id: airtableRecordId,
    airtable_error: airtableError,
    earnings_marked_paid: markResult.earningsMarkedPaid,
    airtable_txn_updated: markResult.airtableUpdated,
    airtable_txn_failed: markResult.airtableErrors.length,
  };
}
