/**
 * POST /api/admin/affiliates/refetch-bank
 *
 * Admin-only. Re-fetches a signed PandaDoc document for an affiliate and
 * upserts the extracted bank details into payout_accounts.
 *
 * Two extraction passes are tried, then merged per-field:
 *   1) Structured PandaDoc form fields via /documents/{id}/details
 *   2) Rendered-PDF text via /documents/{id}/download → unpdf → the same
 *      extractor that powers the admin PDF-upload flow
 *
 * Pass 2 catches the case where the agreement was signed without
 * structured form fields (free-text PDFs) — which was failing previously
 * with "Bank fields could not be extracted from the PandaDoc".
 *
 * Returns { saved: boolean, ... }. Body: { affiliate_id: string, confirm?: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";
import { fetchDocumentFields, downloadDocumentPdf, extractBankDetails } from "@/lib/pandadoc";
import { extractTextFromPdf, extractBankFromText, type PdfExtractedBank } from "@/lib/pdf-bank-extract";

export const runtime = "nodejs";

const BodySchema = z.object({
  affiliate_id: z.string().uuid(),
  confirm: z.boolean().optional(),
});

interface MergedExtraction {
  routing_number: string | null;
  account_number: string | null;
  routing_valid: boolean;
  account_valid: boolean;
  account_holder_name: string | null;
  account_type: "checking" | "savings" | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string;
  warnings: string[];
  /** Per-field source for debugging — "fields" or "pdf". */
  source: { bank: "fields" | "pdf" | "none"; address: "fields" | "pdf" | "none" };
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let rawBody: unknown;
  try { rawBody = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { affiliate_id, confirm = false } = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  const { data: affiliate, error: affErr } = await svc
    .from("affiliates")
    .select("id, agent_name, email, pandadoc_id")
    .eq("id", affiliate_id)
    .maybeSingle();
  if (affErr) {
    console.error("[refetch-bank] Affiliate lookup failed:", affErr);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  if (!affiliate) {
    return NextResponse.json({ error: "Affiliate not found" }, { status: 404 });
  }
  if (!affiliate.pandadoc_id) {
    return NextResponse.json({
      saved: false,
      reason: "no_pandadoc_id",
      message: "This affiliate has no PandaDoc document linked. Sync affiliates first.",
    }, { status: 422 });
  }

  // PASS 1: structured fields. Errors here don't abort — we still try PDF.
  let fieldsResult: Awaited<ReturnType<typeof extractBankDetails>> | null = null;
  let fieldsError: string | null = null;
  try {
    const fields = await fetchDocumentFields(affiliate.pandadoc_id);
    fieldsResult = extractBankDetails(fields);
  } catch (e) {
    fieldsError = e instanceof Error ? e.message : String(e);
    console.warn("[refetch-bank] Structured-fields path failed:", fieldsError);
  }

  // PASS 2: PDF text extraction — run if structured fields didn't give us
  // complete bank+address. Cheap relative to a manual hop.
  const needsPdfFallback =
    !fieldsResult ||
    !fieldsResult.routing_valid ||
    !fieldsResult.account_valid ||
    !fieldsResult.address1 ||
    !fieldsResult.city ||
    !fieldsResult.region ||
    !fieldsResult.postal_code;

  let pdfResult: PdfExtractedBank | null = null;
  let pdfError: string | null = null;
  if (needsPdfFallback) {
    try {
      const buf = await downloadDocumentPdf(affiliate.pandadoc_id);
      const text = await extractTextFromPdf(buf);
      pdfResult = extractBankFromText(text);
    } catch (e) {
      pdfError = e instanceof Error ? e.message : String(e);
      console.warn("[refetch-bank] PDF fallback failed:", pdfError);
    }
  }

  // MERGE: prefer structured fields where valid; fall back to PDF per-field.
  const merged: MergedExtraction = {
    routing_number:
      fieldsResult?.routing_valid && fieldsResult.routing_number
        ? fieldsResult.routing_number
        : pdfResult?.routing_valid && pdfResult.routing_number
        ? pdfResult.routing_number
        : null,
    account_number:
      fieldsResult?.account_valid && fieldsResult.account_number
        ? fieldsResult.account_number
        : pdfResult?.account_valid && pdfResult.account_number
        ? pdfResult.account_number
        : null,
    routing_valid: (fieldsResult?.routing_valid ?? false) || (pdfResult?.routing_valid ?? false),
    account_valid: (fieldsResult?.account_valid ?? false) || (pdfResult?.account_valid ?? false),
    account_holder_name:
      fieldsResult?.account_holder_name || pdfResult?.account_holder_name || null,
    account_type:
      fieldsResult?.account_type || pdfResult?.account_type || "checking",
    address1: fieldsResult?.address1 || pdfResult?.address.address1 || null,
    address2: fieldsResult?.address2 || pdfResult?.address.address2 || null,
    city: fieldsResult?.city || pdfResult?.address.city || null,
    region: fieldsResult?.region || pdfResult?.address.region || null,
    postal_code: fieldsResult?.postal_code || pdfResult?.address.postal_code || null,
    country: fieldsResult?.country || pdfResult?.address.country || "US",
    warnings: [
      ...(fieldsResult?.warnings ?? []),
      ...(pdfResult?.warnings.map((w) => `(pdf fallback) ${w}`) ?? []),
      ...(fieldsError ? [`structured fields failed: ${fieldsError}`] : []),
      ...(pdfError ? [`pdf fallback failed: ${pdfError}`] : []),
    ],
    source: {
      bank:
        fieldsResult?.routing_valid && fieldsResult.account_valid
          ? "fields"
          : pdfResult?.routing_valid && pdfResult.account_valid
          ? "pdf"
          : "none",
      address:
        fieldsResult?.address1 && fieldsResult?.city && fieldsResult?.region && fieldsResult?.postal_code
          ? "fields"
          : pdfResult?.address.address1 && pdfResult?.address.city && pdfResult?.address.region && pdfResult?.address.postal_code
          ? "pdf"
          : "none",
    },
  };

  const preview = {
    account_holder_name: merged.account_holder_name,
    routing_number: merged.routing_number,
    account_number_last4: merged.account_number ? merged.account_number.slice(-4) : null,
    account_type: merged.account_type,
    routing_valid: merged.routing_valid,
    account_valid: merged.account_valid,
    warnings: merged.warnings,
    address1: merged.address1,
    address2: merged.address2,
    city: merged.city,
    region: merged.region,
    postal_code: merged.postal_code,
    country: merged.country,
    source: merged.source,
  };

  if (!merged.routing_valid || !merged.account_valid) {
    return NextResponse.json({
      saved: false,
      reason: "invalid_bank_fields",
      message:
        "Bank fields could not be extracted from either the structured PandaDoc fields or the rendered PDF. They may be missing or malformed.",
      preview,
    }, { status: 422 });
  }

  if (!confirm) {
    return NextResponse.json({ saved: false, preview });
  }

  const accountNumberLast4 = merged.account_number!.slice(-4);
  const bankPayload = {
    affiliate_id: affiliate.id,
    provider: "mercury" as const,
    account_name: merged.account_holder_name ?? affiliate.agent_name,
    routing_number: merged.routing_number,
    account_number_last4: accountNumberLast4,
    is_default: true,
    is_verified: true,
    address1: merged.address1,
    address2: merged.address2,
    city: merged.city,
    region: merged.region,
    postal_code: merged.postal_code,
    country: merged.country,
    metadata: {
      full_account_number: merged.account_number,
      routing_number: merged.routing_number,
      account_type: merged.account_type,
      source: `pandadoc-refetch:${merged.source.bank}/${merged.source.address}`,
      refetched_by: user.email,
      refetched_at: new Date().toISOString(),
    },
  };

  const { data: existingAccount } = await svc
    .from("payout_accounts")
    .select("id")
    .eq("affiliate_id", affiliate.id)
    .eq("provider", "mercury")
    .limit(1)
    .maybeSingle();

  let action: "updated" | "created";
  if (existingAccount) {
    const { error: updErr } = await svc
      .from("payout_accounts")
      .update(bankPayload)
      .eq("id", existingAccount.id);
    if (updErr) {
      console.error("[refetch-bank] Update failed:", updErr);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
    action = "updated";
  } else {
    const { error: insErr } = await svc.from("payout_accounts").insert(bankPayload);
    if (insErr) {
      console.error("[refetch-bank] Insert failed:", insErr);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
    action = "created";
  }

  await svc
    .from("affiliates")
    .update({ bank_details_needed: false })
    .eq("id", affiliate.id);

  await logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: "admin.bank_refetched",
    resourceType: "payout_accounts",
    resourceId: affiliate.id,
    metadata: {
      affiliate_email: affiliate.email,
      pandadoc_id: affiliate.pandadoc_id,
      action,
      confirm: true,
      source: merged.source,
      account_holder_name: merged.account_holder_name,
      account_number_last4: accountNumberLast4,
    },
  });

  return NextResponse.json({ saved: true, action, preview });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
