/**
 * POST /api/admin/update-affiliate-status
 *
 * Admin-only: update an affiliate's status (active/suspended/pending).
 * Audit-logged.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";

const UpdateStatusSchema = z.object({
  affiliate_id: z.string().uuid(),
  status: z.enum(["active", "suspended", "pending"]),
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

  const parsed = UpdateStatusSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { affiliate_id, status } = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // Verify affiliate exists
  const { data: existing } = await svc
    .from("affiliates")
    .select("id, status")
    .eq("id", affiliate_id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Affiliate not found" }, { status: 404 });
  }

  const previousStatus = existing.status;

  // Update status
  const { error: updateError } = await svc
    .from("affiliates")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", affiliate_id);

  if (updateError) {
    console.error("[admin/update-affiliate-status] Update failed:", updateError);
    return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
  }

  // Audit log
  logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: "admin.update_affiliate_status",
    resourceType: "affiliate",
    resourceId: affiliate_id,
    metadata: { previous_status: previousStatus, new_status: status },
  });

  return NextResponse.json({ success: true });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
