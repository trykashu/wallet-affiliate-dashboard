import { NextRequest, NextResponse } from "next/server";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";
import { StatementDocument } from "@/lib/statement/StatementDocument";
import {
  buildStatementNumber,
  commissionRatePct,
  formatPeriodLabel,
} from "@/lib/statement/builders";
import type { StatementData } from "@/lib/statement/types";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: payoutId } = await params;

  const supa = await createClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // 1. Fetch payout
  const { data: payout, error: payoutErr } = await svc
    .from("payouts")
    .select(
      "id, affiliate_id, payout_account_id, amount, period, status, created_at",
    )
    .eq("id", payoutId)
    .maybeSingle();
  if (payoutErr) {
    console.error("[statement] payout fetch failed:", payoutErr);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  if (!payout) {
    return NextResponse.json({ error: "Payout not found" }, { status: 404 });
  }
  if (!payout.period) {
    return NextResponse.json(
      { error: "Payout has no period set" },
      { status: 422 },
    );
  }

  // 2. Fetch affiliate, account, earnings in parallel
  const [affResp, acctResp, earningsResp] = await Promise.all([
    svc
      .from("affiliates")
      .select(
        "id, agent_name, tier, email, phone, custom_commission_rate, attribution_id",
      )
      .eq("id", payout.affiliate_id)
      .maybeSingle(),
    svc
      .from("payout_accounts")
      .select(
        "account_number_last4, address1, address2, city, region, postal_code, country",
      )
      .eq("id", payout.payout_account_id)
      .maybeSingle(),
    svc
      .from("earnings")
      .select(
        "id, amount, transaction_fee_amount, transaction_ref, referred_user_id",
      )
      .eq("payout_id", payoutId),
  ]);

  if (affResp.error || acctResp.error || earningsResp.error) {
    console.error("[statement] secondary fetch failed", {
      aff: affResp.error,
      acct: acctResp.error,
      earnings: earningsResp.error,
    });
    return NextResponse.json({ error: "Database error" }, { status: 500 });
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

  if (!affiliate)
    return NextResponse.json({ error: "Affiliate not found" }, { status: 404 });
  if (!account)
    return NextResponse.json(
      { error: "Payout account not found" },
      { status: 404 },
    );

  if (
    !account.address1 ||
    !account.city ||
    !account.region ||
    !account.postal_code
  ) {
    return NextResponse.json(
      {
        error: "Affiliate is missing address — Re-verify bank from PandaDoc",
        reason: "missing_address",
      },
      { status: 422 },
    );
  }

  // 3. Resolve referred-user names + transaction dates
  const referredUserIds = Array.from(
    new Set(earnings.map((e) => e.referred_user_id)),
  );
  const txnRefs = earnings
    .map((e) => e.transaction_ref)
    .filter((r): r is string => !!r);

  const [usersResp, txnsResp] = await Promise.all([
    referredUserIds.length > 0
      ? svc
          .from("referred_users")
          .select("id, full_name")
          .in("id", referredUserIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }> }),
    txnRefs.length > 0
      ? svc
          .from("transactions")
          .select("airtable_record_id, transaction_date")
          .in("airtable_record_id", txnRefs)
      : Promise.resolve({
          data: [] as Array<{
            airtable_record_id: string;
            transaction_date: string | null;
          }>,
        }),
  ]);

  type UserRow = { id: string; full_name: string };
  type TxnRow = {
    airtable_record_id: string;
    transaction_date: string | null;
  };
  const userMap = new Map<string, string>();
  for (const u of (usersResp.data ?? []) as UserRow[])
    userMap.set(u.id, u.full_name);
  const txnDateMap = new Map<string, string | null>();
  for (const t of (txnsResp.data ?? []) as TxnRow[])
    txnDateMap.set(t.airtable_record_id, t.transaction_date);

  // 4. Build StatementData
  const ratePct = commissionRatePct(
    affiliate.tier,
    affiliate.custom_commission_rate,
  );

  // StatementDocument only renders gold/platinum visually. Custom tier maps to gold.
  const displayTier: "gold" | "platinum" =
    affiliate.tier === "platinum" ? "platinum" : "gold";

  const rowsWithSortKey = earnings.map((e) => {
    const dateRaw = e.transaction_ref
      ? txnDateMap.get(e.transaction_ref) ?? null
      : null;
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

  // 6. Upload to Supabase Storage (canonical)
  const storagePath = `statements/${payout.period}/${payout.affiliate_id}.pdf`;
  const { error: uploadErr } = await svc.storage
    .from("affiliate-statements")
    .upload(storagePath, pdfBuffer, {
      upsert: true,
      contentType: "application/pdf",
    });
  if (uploadErr) {
    console.error("[statement] Supabase upload failed:", uploadErr);
    return NextResponse.json(
      { error: `Supabase upload failed: ${uploadErr.message}` },
      { status: 500 },
    );
  }

  const { data: publicUrlData } = svc.storage
    .from("affiliate-statements")
    .getPublicUrl(storagePath);
  const supabaseUrl: string = publicUrlData.publicUrl;

  // 7. Mirror to Airtable "Affiliate Statements" — best-effort
  let airtableRecordId: string | null = null;
  let airtableError: string | null = null;
  const airtableBaseId = process.env.AIRTABLE_AFFILIATE_BASE?.replace(
    /\\n|"|\s/g,
    "",
  );
  const statementsTableId = process.env.AIRTABLE_STATEMENTS_TABLE?.replace(
    /\\n|"|\s/g,
    "",
  );
  const airtablePat = process.env.AIRTABLE_PAT?.replace(/\\n|"|\s/g, "");

  const affiliateTableId = process.env.AIRTABLE_AFFILIATE_TABLE?.replace(
    /\\n|"|\s/g,
    "",
  );

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
      const listJson = (await listRes.json()) as {
        records?: Array<{ id: string }>;
      };
      const existingId = listJson.records?.[0]?.id ?? null;

      // Best-effort: resolve the Kashu Affiliates record ID for the link field
      let affiliateRecordId: string | null = null;
      if (affiliateTableId) {
        try {
          const affFilter = encodeURIComponent(
            `{Attribution ID}='${attributionId}'`,
          );
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
      };
      if (affiliateRecordId) {
        fields.Affiliate = [affiliateRecordId];
      }

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
        throw new Error(
          `Airtable write ${writeRes.status}: ${txt.slice(0, 200)}`,
        );
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

  // 8. Audit log
  await logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: "admin.statement_generated",
    resourceType: "payouts",
    resourceId: payoutId,
    metadata: {
      period: payout.period,
      affiliate_id: payout.affiliate_id,
      supabase_url: supabaseUrl,
      airtable_record_id: airtableRecordId,
      airtable_error: airtableError,
      eligible_count: totals.eligible_count,
      commission_due: totals.commission_due,
    },
  });

  return NextResponse.json({
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
  });
}

export async function GET() {
  return NextResponse.json(
    { error: "Method not allowed" },
    { status: 405 },
  );
}
