/**
 * POST multipart form:
 *   - file        (required, application/pdf)
 *   - affiliate_id (required, uuid)
 *   - confirm      (optional, "true" to write; otherwise preview only)
 *
 * Extracts bank details from a text-based PDF and either previews them or
 * upserts the affiliate's Mercury payout_account.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";
import { safeError } from "@/lib/safe-log";
import {
  extractTextFromPdf,
  extractBankFromText,
  type PdfExtractedBank,
} from "@/lib/pdf-bank-extract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Try to encrypt; fall back to plaintext if ENCRYPTION_KEY is not set. */
function tryEncrypt(value: string): { encrypted: boolean; value: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { encrypt } = require("@/lib/encryption");
    return { encrypted: true, value: encrypt(value) };
  } catch {
    return { encrypted: false, value };
  }
}

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request: NextRequest) {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 }); }

  const file = form.get("file");
  const affiliateId = form.get("affiliate_id");
  const confirm = form.get("confirm") === "true";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (typeof affiliateId !== "string" || !affiliateId) {
    return NextResponse.json({ error: "Missing affiliate_id" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 413 });
  }
  if (file.type && !file.type.includes("pdf") && !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "File must be a PDF" }, { status: 415 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  // Resolve affiliate
  const { data: affiliate, error: affErr } = await db
    .from("affiliates")
    .select("id, agent_name, email")
    .eq("id", affiliateId)
    .maybeSingle();
  if (affErr) {
    safeError("[bank-from-pdf]", "affiliate fetch failed", affErr);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  if (!affiliate) {
    return NextResponse.json({ error: "Affiliate not found" }, { status: 404 });
  }

  // Extract text + bank details
  let extracted: PdfExtractedBank;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const text = await extractTextFromPdf(buf);
    if (!text || text.trim().length < 20) {
      return NextResponse.json(
        {
          error: "PDF appears empty or image-only — text extraction returned no content. Scanned PDFs aren't supported on this flow.",
          reason: "no_text",
        },
        { status: 422 },
      );
    }
    extracted = extractBankFromText(text);
  } catch (e) {
    safeError("[bank-from-pdf]", "extraction failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Extraction failed" },
      { status: 500 },
    );
  }

  // Preview-only path
  if (!confirm) {
    return NextResponse.json({
      ok: true,
      affiliate: { id: affiliate.id, agent_name: affiliate.agent_name, email: affiliate.email },
      extracted,
      ready_to_save: extracted.routing_valid && extracted.account_valid,
    });
  }

  // Confirm path — refuse if validation didn't pass
  if (!extracted.routing_valid || !extracted.account_valid) {
    return NextResponse.json(
      {
        error: "Cannot save — routing or account number didn't pass validation",
        extracted,
      },
      { status: 422 },
    );
  }

  const routing = extracted.routing_number!;
  const account = extracted.account_number!;
  const last4 = account.slice(-4);
  const accountName = extracted.account_holder_name || affiliate.agent_name;

  const routingEnc = tryEncrypt(routing);
  const accountEnc = tryEncrypt(account);

  const metadata = routingEnc.encrypted
    ? {
        account_holder_name: accountName,
        routing_number_encrypted: routingEnc.value,
        account_number_encrypted: accountEnc.value,
        account_type: extracted.account_type ?? "checking",
        last4,
        encryption_version: 1,
        source: "pdf_upload",
      }
    : {
        account_holder_name: accountName,
        full_account_number: accountEnc.value,
        routing_number: routingEnc.value,
        account_type: extracted.account_type ?? "checking",
        last4,
        source: "pdf_upload",
      };

  const accountData = {
    affiliate_id: affiliate.id,
    provider: "mercury",
    provider_id: null,
    account_name: accountName,
    routing_number: routing,
    account_number_last4: last4,
    is_default: true,
    is_verified: true,
    metadata,
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await db
    .from("payout_accounts")
    .select("id")
    .eq("affiliate_id", affiliate.id)
    .eq("provider", "mercury")
    .limit(1)
    .maybeSingle();

  let action: "created" | "updated";
  if (existing) {
    const { error: upErr } = await db
      .from("payout_accounts")
      .update(accountData)
      .eq("id", existing.id);
    if (upErr) {
      safeError("[bank-from-pdf]", "update failed", upErr);
      return NextResponse.json({ error: "Database update failed" }, { status: 500 });
    }
    action = "updated";
  } else {
    const { error: insErr } = await db.from("payout_accounts").insert(accountData);
    if (insErr) {
      safeError("[bank-from-pdf]", "insert failed", insErr);
      return NextResponse.json({ error: "Database insert failed" }, { status: 500 });
    }
    action = "created";
  }

  // Clear bank_details_needed
  await db
    .from("affiliates")
    .update({ bank_details_needed: false })
    .eq("id", affiliate.id);

  await logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: "admin.bank_from_pdf",
    resourceType: "affiliates",
    resourceId: affiliate.id,
    metadata: {
      action,
      last4,
      filename: file.name,
      warnings: extracted.warnings,
    },
  });

  return NextResponse.json({
    ok: true,
    action,
    affiliate: { id: affiliate.id, agent_name: affiliate.agent_name },
    extracted,
  });
}
