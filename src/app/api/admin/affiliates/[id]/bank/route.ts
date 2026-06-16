/**
 * POST /api/admin/affiliates/[id]/bank
 * Body: { account_holder_name, routing_number, account_number?, address1, address2?, city, region, postal_code }
 *
 * Admin-only manual edit of any affiliate's Mercury bank details + address.
 * Trusted edit → is_verified:true. Delegates to the shared saveBankDetails
 * helper which handles Mercury safety (nulls provider_id when bank/address change).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";
import { saveBankDetails } from "@/lib/payouts/save-bank-details";

export const dynamic = "force-dynamic";

const US_STATE_RX = /^[A-Za-z]{2}$/;
const ZIP_RX = /^\d{5}(-\d{4})?$/;

const Body = z.object({
  account_holder_name: z.string().min(1, "Account holder name is required").max(200),
  routing_number: z.string().regex(/^\d{9}$/, "Routing number must be exactly 9 digits"),
  account_number: z
    .union([z.string().regex(/^\d{4,17}$/, "Account number must be 4-17 digits"), z.literal("")])
    .optional(),
  address1: z.string().min(2),
  address2: z.string().nullable().optional(),
  city: z.string().min(2),
  region: z.string().regex(US_STATE_RX, "region must be a 2-letter US state code"),
  postal_code: z.string().regex(ZIP_RX, "postal_code must be a 5-digit ZIP (optionally ZIP+4)"),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: affiliateId } = await params;

  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const b = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  try {
    const { last4, bankChanged } = await saveBankDetails(
      svc,
      {
        affiliateId,
        accountHolderName: b.account_holder_name,
        routingNumber: b.routing_number,
        accountNumber: b.account_number || undefined,
        address: {
          address1: b.address1,
          address2: b.address2 ?? null,
          city: b.city,
          region: b.region.toUpperCase(),
          postalCode: b.postal_code,
          country: "US",
        },
      },
      { markVerified: true, source: "admin_manual" },
    );

    await svc
      .from("affiliates")
      .update({ bank_details_needed: false })
      .eq("id", affiliateId);

    await logSecurityEvent({
      userId: user.id,
      userEmail: user.email,
      action: "bank_data_updated",
      resourceType: "payout_account",
      resourceId: affiliateId,
      metadata: { changed_by: `admin:${user.email}`, bank_changed: bankChanged },
    });

    return NextResponse.json({ success: true, last4, bankChanged });
  } catch (err) {
    console.error("[admin/bank] save failed:", err);
    return NextResponse.json({ error: "Failed to save bank details" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
