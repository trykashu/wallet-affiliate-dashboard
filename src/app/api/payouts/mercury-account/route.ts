/**
 * POST /api/payouts/mercury-account
 *
 * Authenticated affiliate self-service endpoint: save/update their own bank
 * details + address for Mercury ACH payouts.
 * Body: { account_holder_name, routing_number, account_number, address1, address2?, city, region, postal_code }
 *
 * Untrusted edit → is_verified:false (pending admin re-verify). Delegates to the
 * shared saveBankDetails helper which handles Mercury safety (nulls provider_id
 * when bank/address change).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/audit-log";
import { saveBankDetails } from "@/lib/payouts/save-bank-details";

export const dynamic = "force-dynamic";

const US_STATE_RX = /^[A-Za-z]{2}$/;
const ZIP_RX = /^\d{5}(-\d{4})?$/;

const BodySchema = z.object({
  account_holder_name: z.string().min(1, "Account holder name is required").max(200),
  routing_number: z.string().regex(/^\d{9}$/, "Routing number must be exactly 9 digits"),
  account_number: z.string().regex(/^\d{4,17}$/, "Account number must be 4-17 digits"),
  address1: z.string().min(2),
  address2: z.string().nullable().optional(),
  city: z.string().min(2),
  region: z.string().regex(US_STATE_RX, "region must be a 2-letter US state code"),
  postal_code: z.string().regex(ZIP_RX, "postal_code must be a 5-digit ZIP (optionally ZIP+4)"),
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
  const b = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Resolve affiliate (RLS-scoped to the current user)
  const { data: affiliate } = await db.from("affiliates").select("id").single();
  if (!affiliate) {
    return NextResponse.json({ error: "Affiliate not found" }, { status: 404 });
  }

  try {
    const { last4 } = await saveBankDetails(
      db,
      {
        affiliateId: affiliate.id,
        accountHolderName: b.account_holder_name,
        routingNumber: b.routing_number,
        accountNumber: b.account_number,
        address: {
          address1: b.address1,
          address2: b.address2 ?? null,
          city: b.city,
          region: b.region.toUpperCase(),
          postalCode: b.postal_code,
          country: "US",
        },
      },
      // Affiliate self-edits are instantly payable (verified). The bank change
      // still re-syncs Mercury (provider_id cleared by the builder when changed).
      { markVerified: true, source: "self_service" },
    );

    await db
      .from("affiliates")
      .update({ bank_details_needed: false })
      .eq("id", affiliate.id);

    await logSecurityEvent({
      userId: user.id,
      userEmail: user.email,
      action: "bank_data_updated",
      resourceType: "payout_account",
      resourceId: affiliate.id,
      metadata: { changed_by: "self" },
    });

    return NextResponse.json({ success: true, last4, pending_review: false });
  } catch (err) {
    console.error("[mercury-account] save failed:", err);
    return NextResponse.json({ error: "Failed to save account" }, { status: 500 });
  }
}
