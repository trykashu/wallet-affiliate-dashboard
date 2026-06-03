/**
 * POST /api/admin/affiliates/[id]/address
 * Body: { address1, address2?, city, region, postal_code }
 *
 * Updates the affiliate's default Mercury payout_account address fields.
 * Used when PandaDoc Re-verify can't supply an address (the agreement
 * lacks structured form fields) but the bank details are already saved.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

const US_STATE_RX = /^[A-Z]{2}$/;
const ZIP_RX = /^\d{5}(-\d{4})?$/;

const Body = z.object({
  address1: z.string().min(2).max(100),
  address2: z.string().max(100).nullable().optional(),
  city: z.string().min(2).max(60),
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const { data: account, error: fetchErr } = await db
    .from("payout_accounts")
    .select("id, affiliate_id")
    .eq("affiliate_id", affiliateId)
    .eq("provider", "mercury")
    .eq("is_default", true)
    .eq("is_verified", true)
    .maybeSingle();
  if (fetchErr) {
    console.error("[address] fetch failed:", fetchErr);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  if (!account) {
    return NextResponse.json(
      { error: "No default verified Mercury payout account found for this affiliate" },
      { status: 404 },
    );
  }

  // Postal stored as 5 digits only (Mercury expects either)
  const zip5 = parsed.data.postal_code.slice(0, 5);

  const { error: updateErr } = await db
    .from("payout_accounts")
    .update({
      address1: parsed.data.address1.trim(),
      address2: parsed.data.address2?.trim() || null,
      city: parsed.data.city.trim(),
      region: parsed.data.region.toUpperCase(),
      postal_code: zip5,
      country: "US",
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id);
  if (updateErr) {
    console.error("[address] update failed:", updateErr);
    return NextResponse.json({ error: "Database update failed" }, { status: 500 });
  }

  await logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: "admin.affiliate_address_manual",
    resourceType: "affiliates",
    resourceId: affiliateId,
    metadata: {
      payout_account_id: account.id,
      city: parsed.data.city,
      region: parsed.data.region.toUpperCase(),
      postal_code: zip5,
    },
  });

  return NextResponse.json({ ok: true });
}
