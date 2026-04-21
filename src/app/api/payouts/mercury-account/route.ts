/**
 * POST /api/payouts/mercury-account
 *
 * Authenticated affiliate endpoint: save/update bank details for Mercury ACH payouts.
 * Body: { account_holder_name: string, routing_number: string, account_number: string }
 *
 * Upserts into payout_accounts with provider='mercury'.
 * Stores routing/account in metadata (same format as CSV upload and PandaDoc webhook).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  account_holder_name: z.string().min(1, "Account holder name is required").max(200),
  routing_number: z.string().regex(/^\d{9}$/, "Routing number must be exactly 9 digits"),
  account_number: z.string().regex(/^\d{4,17}$/, "Account number must be 4-17 digits"),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { account_holder_name, routing_number, account_number } = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Get affiliate ID
  const { data: affiliate } = await db.from("affiliates").select("id").single();
  if (!affiliate) {
    return NextResponse.json({ error: "Affiliate not found" }, { status: 404 });
  }

  const last4 = account_number.slice(-4);

  // Check for existing Mercury account
  const { data: existing } = await db
    .from("payout_accounts")
    .select("id")
    .eq("affiliate_id", affiliate.id)
    .eq("provider", "mercury")
    .limit(1)
    .maybeSingle();

  // Match the same storage format as CSV upload and PandaDoc webhook
  const accountData = {
    affiliate_id: affiliate.id,
    provider: "mercury",
    account_name: account_holder_name,
    routing_number: routing_number,
    account_number_last4: last4,
    is_verified: true,
    is_default: true,
    metadata: {
      full_account_number: account_number,
      routing_number: routing_number,
      source: "manual_entry",
    },
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error: updateErr } = await db
      .from("payout_accounts")
      .update(accountData)
      .eq("id", existing.id);

    if (updateErr) {
      console.error("[mercury-account] Update failed:", updateErr.message);
      return NextResponse.json({ error: "Failed to update account" }, { status: 500 });
    }
  } else {
    const { error: insertErr } = await db
      .from("payout_accounts")
      .insert(accountData);

    if (insertErr) {
      console.error("[mercury-account] Insert failed:", insertErr.message);
      return NextResponse.json({ error: "Failed to save account" }, { status: 500 });
    }
  }

  // Clear bank_details_needed flag
  await db
    .from("affiliates")
    .update({ bank_details_needed: false })
    .eq("id", affiliate.id);

  // Audit log
  await logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: "bank_data_updated",
    resourceType: "payout_account",
    resourceId: affiliate.id,
    metadata: { changed_by: "self" },
  });

  return NextResponse.json({ success: true, last4 });
}
