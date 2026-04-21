import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchDocumentFields, extractBankDetails, type PandaDocField } from "@/lib/pandadoc";
import { logSecurityEvent } from "@/lib/audit-log";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/** Verify PandaDoc shared key signature */
function verifySharedKey(request: Request, rawBody: string): boolean {
  const secret = process.env.PANDADOC_WEBHOOK_SECRET;
  if (!secret) return true; // Skip verification if not configured

  const signature = request.headers.get("x-pandadoc-signature");
  if (!signature) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  // Read raw body for signature verification
  const rawBody = await request.text();

  // Verify shared key
  if (!verifySharedKey(request, rawBody)) {
    console.warn("[pandadoc-webhook] Signature verification failed");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // PandaDoc may send as object or array
  const payload = Array.isArray(body) ? (body[0] as Record<string, unknown>) : body;
  const event = payload.event as string | undefined;
  const data = (payload.data ?? payload) as Record<string, unknown>;
  const status = data.status as string | undefined;

  console.log(
    `[pandadoc-webhook] Received event: ${event}, status: ${status}, keys: ${Object.keys(payload).join(",")}`
  );

  // Accept multiple event types for document completion
  const isCompletedEvent =
    (event === "document_state_changed" && status === "document.completed") ||
    event === "recipient_completed" ||
    event === "document_completed" ||
    status === "document.completed";

  if (!isCompletedEvent) {
    return NextResponse.json({ ok: true, skipped: "not_completed", event, status });
  }

  const documentId = data.id as string;
  const documentName = (data.name as string) ?? "";

  console.log(
    `[pandadoc-webhook] Processing completed document: ${documentId} "${documentName}"`
  );

  // Only process Affiliate Agreement documents — skip MRP, W9, Pay Request, etc.
  if (!documentName.toLowerCase().includes("affiliate agreement")) {
    console.log(`[pandadoc-webhook] Skipping non-affiliate document: "${documentName}"`);
    return NextResponse.json({ ok: true, skipped: "not_affiliate_agreement" });
  }

  // Try to use fields from the webhook payload first (PandaDoc sends them when "fields" is checked)
  // Fall back to API call if not present
  let fields: PandaDocField[];
  const inlineFields = data.fields as PandaDocField[] | undefined;

  if (inlineFields && inlineFields.length > 0) {
    console.log(`[pandadoc-webhook] Using ${inlineFields.length} inline fields from payload`);
    fields = inlineFields;
  } else {
    // Fetch from PandaDoc API
    try {
      fields = await fetchDocumentFields(documentId);
      console.log(`[pandadoc-webhook] Fetched ${fields.length} fields from API`);
    } catch (err) {
      console.error(
        "[pandadoc-webhook] Failed to fetch document fields:",
        err instanceof Error ? err.message : "unknown"
      );
      return NextResponse.json({ ok: false, error: "fetch_fields_failed" });
    }
  }

  // Extract bank details by pattern matching
  const bankDetails = extractBankDetails(fields);

  console.log("[pandadoc-webhook] Extracted bank details:", {
    email: bankDetails.email,
    account_holder_name: bankDetails.account_holder_name,
    routing_valid: bankDetails.routing_valid,
    account_valid: bankDetails.account_valid,
    account_type: bankDetails.account_type,
  });

  // Match affiliate
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  let affiliate: { id: string; email: string; agent_name: string } | null = null;

  // Try email match first
  if (bankDetails.email) {
    const { data: emailMatch } = await svc
      .from("affiliates")
      .select("id, email, agent_name")
      .ilike("email", bankDetails.email)
      .limit(1)
      .single();
    if (emailMatch) affiliate = emailMatch;
  }

  // Fallback: extract name from document name "Affiliate Agreement - {Name}"
  if (!affiliate && documentName) {
    const nameMatch = documentName.match(/Affiliate\s+Agreement\s*[-–—]\s*(.+)/i);
    if (nameMatch) {
      const agentName = nameMatch[1].trim();
      const { data: nameMatchResult } = await svc
        .from("affiliates")
        .select("id, email, agent_name")
        .ilike("agent_name", agentName)
        .limit(1)
        .single();
      if (nameMatchResult) affiliate = nameMatchResult;
    }
  }

  // Also try matching by tokens/metadata email if present
  if (!affiliate) {
    const tokens = data.tokens as Array<Record<string, unknown>> | undefined;
    if (tokens) {
      for (const t of tokens) {
        const val = (t.value as string) ?? "";
        if (val.includes("@")) {
          const { data: tokenMatch } = await svc
            .from("affiliates")
            .select("id, email, agent_name")
            .ilike("email", val.trim())
            .limit(1)
            .single();
          if (tokenMatch) { affiliate = tokenMatch; break; }
        }
      }
    }
  }

  if (!affiliate) {
    console.warn(
      `[pandadoc-webhook] No affiliate match for email=${bankDetails.email}, doc="${documentName}"`
    );
    await logSecurityEvent({
      action: "pandadoc.no_affiliate_match",
      resourceType: "document",
      resourceId: documentId,
      metadata: { email: bankDetails.email, document_name: documentName },
    }).catch(() => {});
    return NextResponse.json({ ok: true, skipped: "no_affiliate_match" });
  }

  // Process based on validation results
  if (bankDetails.routing_valid && bankDetails.account_valid) {
    // Valid — upsert payout account
    const accountNumberLast4 = bankDetails.account_number!.slice(-4);

    await svc.from("payout_accounts").upsert(
      {
        affiliate_id: affiliate.id,
        provider: "mercury",
        account_name: bankDetails.account_holder_name ?? affiliate.agent_name,
        routing_number: bankDetails.routing_number,
        account_number_last4: accountNumberLast4,
        is_default: true,
        is_verified: true,
        metadata: {
          full_account_number: bankDetails.account_number,
          routing_number: bankDetails.routing_number,
          account_type: bankDetails.account_type,
          source: "pandadoc",
        },
      },
      { onConflict: "affiliate_id,provider" }
    );

    await svc
      .from("affiliates")
      .update({ bank_details_needed: false, agreement_status: "signed" })
      .eq("id", affiliate.id);

    console.log(
      `[pandadoc-webhook] ✓ Bank details saved for ${affiliate.agent_name} (${affiliate.email})`
    );
  } else {
    // Invalid — flag for manual entry
    await svc
      .from("affiliates")
      .update({ bank_details_needed: true, agreement_status: "signed" })
      .eq("id", affiliate.id);

    console.warn(
      `[pandadoc-webhook] ✗ Invalid bank details for ${affiliate.agent_name}:`,
      { routing_valid: bankDetails.routing_valid, account_valid: bankDetails.account_valid }
    );
  }

  // Audit log
  await logSecurityEvent({
    userEmail: affiliate.email,
    action: "pandadoc.document_completed",
    resourceType: "document",
    resourceId: documentId,
    metadata: {
      affiliate_id: affiliate.id,
      document_name: documentName,
      routing_valid: bankDetails.routing_valid,
      account_valid: bankDetails.account_valid,
      bank_details_saved: bankDetails.routing_valid && bankDetails.account_valid,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
