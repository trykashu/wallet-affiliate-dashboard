/**
 * POST /api/admin/affiliates/refetch-bank
 *
 * Admin-only. Re-fetches a signed PandaDoc document for an affiliate and upserts
 * the extracted bank details into payout_accounts. Returns { saved: boolean, ... }.
 *
 * Body: { affiliate_id: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";
import { fetchDocumentFields, extractBankDetails } from "@/lib/pandadoc";

const BodySchema = z.object({
  affiliate_id: z.string().uuid(),
  confirm: z.boolean().optional(),
});

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

  // Look up affiliate + pandadoc_id
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

  // Fetch fields from PandaDoc
  let fields;
  try {
    fields = await fetchDocumentFields(affiliate.pandadoc_id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[refetch-bank] PandaDoc fetch failed:", msg);
    return NextResponse.json({
      saved: false,
      reason: "pandadoc_fetch_failed",
      message: msg.slice(0, 200),
    }, { status: 502 });
  }

  const bankDetails = extractBankDetails(fields);

  // Always compute the preview payload from the extraction
  const preview = {
    account_holder_name: bankDetails.account_holder_name,
    routing_number: bankDetails.routing_number,
    account_number_last4: bankDetails.account_number
      ? bankDetails.account_number.slice(-4)
      : null,
    account_type: bankDetails.account_type,
    routing_valid: bankDetails.routing_valid,
    account_valid: bankDetails.account_valid,
  };

  if (!bankDetails.routing_valid || !bankDetails.account_valid) {
    return NextResponse.json({
      saved: false,
      reason: "invalid_bank_fields",
      message: "Bank fields could not be extracted from the PandaDoc. They may be missing or malformed.",
      preview,
    }, { status: 422 });
  }

  if (!confirm) {
    // Preview mode: extracted valid but not saving yet.
    return NextResponse.json({
      saved: false,
      preview,
    });
  }

  // Upsert payout_accounts (same shape as the webhook)
  const accountNumberLast4 = bankDetails.account_number!.slice(-4);
  const bankPayload = {
    affiliate_id: affiliate.id,
    provider: "mercury" as const,
    account_name: bankDetails.account_holder_name ?? affiliate.agent_name,
    routing_number: bankDetails.routing_number,
    account_number_last4: accountNumberLast4,
    is_default: true,
    is_verified: true,
    metadata: {
      full_account_number: bankDetails.account_number,
      routing_number: bankDetails.routing_number,
      account_type: bankDetails.account_type,
      source: "pandadoc-refetch",
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

  // Clear bank_details_needed flag
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
      account_holder_name: bankDetails.account_holder_name,
      account_number_last4: accountNumberLast4,
    },
  });

  return NextResponse.json({
    saved: true,
    action,
    preview,
  });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
