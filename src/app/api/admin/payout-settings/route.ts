/**
 * POST /api/admin/payout-settings
 *
 * Admin-only: update the payout_settings singleton row.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";

const SettingsSchema = z.object({
  min_payout_amount: z.number().min(1).max(10000),
  default_provider: z.enum(["mercury", "stripe_connect", "manual"]),
  auto_approve_earnings: z.boolean(),
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

  const parsed = SettingsSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // Check if a settings row exists
  const { data: existing } = await svc
    .from("payout_settings")
    .select("id")
    .limit(1)
    .maybeSingle();

  const payload = {
    ...parsed.data,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error: updateError } = await svc
      .from("payout_settings")
      .update(payload)
      .eq("id", existing.id);

    if (updateError) {
      console.error("[admin/payout-settings] Update failed:", updateError);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
  } else {
    const { error: insertError } = await svc
      .from("payout_settings")
      .insert(payload);

    if (insertError) {
      console.error("[admin/payout-settings] Insert failed:", insertError);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
  }

  // Audit log
  logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: "admin.payout_settings_update",
    resourceType: "payout_settings",
    metadata: parsed.data,
  });

  return NextResponse.json({ success: true });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
