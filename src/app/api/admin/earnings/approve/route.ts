/**
 * POST /api/admin/earnings/approve
 *
 * Admin-only: bulk approve pending earnings.
 * Accepts { earning_ids: string[] }
 * Updates status to 'approved' and creates a notification for each affiliate.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";

const ApproveSchema = z.object({
  earning_ids: z.array(z.string().uuid()).min(1).max(200),
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

  const parsed = ApproveSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { earning_ids } = parsed.data;

  // Update earnings status to 'approved'
  const { data: updatedEarnings, error: updateError } = await svc
    .from("earnings")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .in("id", earning_ids)
    .eq("status", "pending")
    .select("id, affiliate_id, amount");

  if (updateError) {
    console.error("[admin/earnings/approve] Update failed:", updateError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const approved = updatedEarnings ?? [];

  // Create notification for each unique affiliate
  const affiliateIds = [...new Set(approved.map((e: { affiliate_id: string }) => e.affiliate_id))];
  const notifications = affiliateIds.map((affId) => {
    const affEarnings = approved.filter((e: { affiliate_id: string }) => e.affiliate_id === affId);
    const totalAmount = affEarnings.reduce((s: number, e: { amount: number }) => s + e.amount, 0);
    return {
      affiliate_id: affId,
      type: "earning_credited" as const,
      title: `${affEarnings.length} earning(s) approved`,
      body: `$${totalAmount.toFixed(2)} in earnings have been approved and are ready for payout.`,
      is_read: false,
    };
  });

  if (notifications.length > 0) {
    await svc.from("notifications").insert(notifications);
  }

  // Audit log
  logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: "admin.earnings_approve",
    resourceType: "earnings",
    metadata: {
      count: approved.length,
      earning_ids: earning_ids.slice(0, 10), // log max 10 for brevity
    },
  });

  return NextResponse.json({
    success: true,
    approved_count: approved.length,
  });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
