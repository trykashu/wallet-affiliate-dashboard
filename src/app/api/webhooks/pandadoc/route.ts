import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchDocumentFields, extractBankDetails } from "@/lib/pandadoc";
import { logSecurityEvent } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 1. Only process document_state_changed events
  const event = body.event as string | undefined;
  if (event !== "document_state_changed") {
    return NextResponse.json({ ok: true, skipped: "event_type" });
  }

  // 2. Only process document.completed status
  const data = (body.data ?? {}) as Record<string, unknown>;
  const status = data.status as string | undefined;
  if (status !== "document.completed") {
    return NextResponse.json({ ok: true, skipped: "status" });
  }

  const documentId = data.id as string;
  const documentName = (data.name as string) ?? "";

  console.log(
    `[pandadoc-webhook] Processing completed document: ${documentId} "${documentName}"`
  );

  // 3. Fetch fields from PandaDoc API
  let fields;
  try {
    fields = await fetchDocumentFields(documentId);
  } catch (err) {
    console.error(
      "[pandadoc-webhook] Failed to fetch document fields:",
      err instanceof Error ? err.message : "unknown"
    );
    // Return 200 so PandaDoc doesn't retry — we'll investigate manually
    return NextResponse.json({ ok: false, error: "fetch_fields_failed" });
  }

  // 4. Extract bank details by pattern matching
  const bankDetails = extractBankDetails(fields);

  console.log("[pandadoc-webhook] Extracted bank details:", {
    email: bankDetails.email,
    account_holder_name: bankDetails.account_holder_name,
    routing_valid: bankDetails.routing_valid,
    account_valid: bankDetails.account_valid,
    account_type: bankDetails.account_type,
  });

  // 5. Match affiliate
  const svc = createServiceClient() as any;
  let affiliate: { id: string; email: string; agent_name: string } | null =
    null;

  // Try email match first (case-insensitive)
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
    const nameMatch = documentName.match(
      /Affiliate\s+Agreement\s*[-–—]\s*(.+)/i
    );
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

  if (!affiliate) {
    console.warn(
      `[pandadoc-webhook] No affiliate match for email=${bankDetails.email}, doc="${documentName}"`
    );
    await logSecurityEvent({
      action: "pandadoc.no_affiliate_match",
      resourceType: "document",
      resourceId: documentId,
      metadata: {
        email: bankDetails.email,
        document_name: documentName,
      },
    }).catch(() => {});
    return NextResponse.json({ ok: true, skipped: "no_affiliate_match" });
  }

  // 6. Process based on validation results
  if (bankDetails.routing_valid && bankDetails.account_valid) {
    // Valid bank details — upsert payout account
    const accountNumberLast4 = bankDetails.account_number!.slice(-4);

    const { error: upsertError } = await svc
      .from("payout_accounts")
      .upsert(
        {
          affiliate_id: affiliate.id,
          provider: "mercury" as const,
          account_name:
            bankDetails.account_holder_name ?? affiliate.agent_name,
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

    if (upsertError) {
      console.error(
        "[pandadoc-webhook] Payout account upsert failed:",
        upsertError.message
      );
    }

    // Update affiliate flags
    const { error: updateError } = await svc
      .from("affiliates")
      .update({
        bank_details_needed: false,
        agreement_status: "signed",
      })
      .eq("id", affiliate.id);

    if (updateError) {
      console.error(
        "[pandadoc-webhook] Affiliate update failed:",
        updateError.message
      );
    }

    console.log(
      `[pandadoc-webhook] Bank details saved for affiliate ${affiliate.id} (${affiliate.email})`
    );
  } else {
    // Invalid bank details — mark as needing manual entry
    const { error: updateError } = await svc
      .from("affiliates")
      .update({
        bank_details_needed: true,
        agreement_status: "signed",
      })
      .eq("id", affiliate.id);

    if (updateError) {
      console.error(
        "[pandadoc-webhook] Affiliate update failed:",
        updateError.message
      );
    }

    console.warn(
      `[pandadoc-webhook] Invalid bank details for affiliate ${affiliate.id}:`,
      {
        routing_valid: bankDetails.routing_valid,
        account_valid: bankDetails.account_valid,
      }
    );
  }

  // 7. Audit log
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
      account_type: bankDetails.account_type,
      bank_details_saved: bankDetails.routing_valid && bankDetails.account_valid,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
