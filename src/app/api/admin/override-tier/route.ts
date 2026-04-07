/**
 * POST /api/admin/override-tier
 *
 * Admin-only: override an affiliate's tier (gold/platinum).
 * Sets tier + tier_override = true. Audit-logged.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";

const OverrideTierSchema = z.object({
  affiliate_id: z.string().uuid(),
  tier: z.enum(["gold", "platinum"]),
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

  const parsed = OverrideTierSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { affiliate_id, tier } = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // Verify affiliate exists
  const { data: existing } = await svc
    .from("affiliates")
    .select("id, tier, tier_override")
    .eq("id", affiliate_id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Affiliate not found" }, { status: 404 });
  }

  const previousTier = existing.tier;

  // Update tier + set override flag
  const { error: updateError } = await svc
    .from("affiliates")
    .update({
      tier,
      tier_override: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", affiliate_id);

  if (updateError) {
    console.error("[admin/override-tier] Update failed:", updateError);
    return NextResponse.json({ error: "Failed to override tier" }, { status: 500 });
  }

  // Audit log
  logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: "admin.override_tier",
    resourceType: "affiliate",
    resourceId: affiliate_id,
    metadata: { previous_tier: previousTier, new_tier: tier },
  });

  return NextResponse.json({ success: true });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
