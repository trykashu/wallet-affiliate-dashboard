/**
 * POST /api/payouts/mercury-account
 *
 * Authenticated affiliate endpoint: save/update bank details for Mercury ACH payouts.
 * Body: { account_holder_name: string, routing_number: string, account_number: string }
 *
 * Upserts into payout_accounts with provider='mercury'.
 * Stores full routing/account numbers in RLS-protected metadata field.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/encryption";
import { logSecurityEvent } from "@/lib/audit-log";
import { safeError } from "@/lib/safe-log";

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

  // Last 4 digits for display purposes
  const last4 = account_number.slice(-4);

  // Check for existing Mercury account
  const { data: existing } = await db
    .from("payout_accounts")
    .select("id")
    .eq("affiliate_id", affiliate.id)
    .eq("provider", "mercury")
    .limit(1)
    .maybeSingle();

  const accountData = {
    affiliate_id: affiliate.id,
    provider: "mercury",
    provider_id: null,
    account_name: account_holder_name,
    is_verified: true,
    is_default: false,
    metadata: {
      account_holder_name,
      routing_number_encrypted: encrypt(routing_number),
      account_number_encrypted: encrypt(account_number),
      account_type: "checking",
      last4,
      encryption_version: 1,
    },
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    // Update existing
    const { error: updateErr } = await db
      .from("payout_accounts")
      .update(accountData)
      .eq("id", existing.id);

    if (updateErr) {
      safeError("[mercury-account]", "Update failed:", updateErr);
      return NextResponse.json(
        { error: "Failed to update account" },
        { status: 500 }
      );
    }
  } else {
    // Insert new
    const { error: insertErr } = await db
      .from("payout_accounts")
      .insert(accountData);

    if (insertErr) {
      safeError("[mercury-account]", "Insert failed:", insertErr);
      return NextResponse.json(
        { error: "Failed to save account" },
        { status: 500 }
      );
    }
  }

  // Clear bank_details_needed flag so the prompt goes away
  await db
    .from("affiliates")
    .update({ bank_details_needed: false })
    .eq("id", affiliate.id);

  // Audit log: bank data updated
  await logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: "bank_data_updated",
    resourceType: "payout_account",
    resourceId: affiliate.id,
    metadata: { changed_by: "self" },
  });

  return NextResponse.json({
    success: true,
    last4,
  });
}
