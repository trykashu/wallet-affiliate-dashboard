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

  // Gate by contract: only earnings whose affiliate has a signed contract are eligible.
  const { data: lookupRows, error: lookupErr } = await svc
    .from("earnings")
    .select("id, affiliate_id")
    .in("id", earning_ids);
  if (lookupErr) {
    console.error("[admin/earnings/approve] Lookup failed:", lookupErr);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  type EarningLookup = { id: string; affiliate_id: string };
  const earningRows = (lookupRows as EarningLookup[] | null) ?? [];
  const uniqueAffiliateIds = [...new Set(earningRows.map((r) => r.affiliate_id))];

  let agreementByAffiliate = new Map<string, string | null>();
  if (uniqueAffiliateIds.length > 0) {
    const { data: affRows, error: affErr } = await svc
      .from("affiliates")
      .select("id, agreement_status")
      .in("id", uniqueAffiliateIds);
    if (affErr) {
      console.error("[admin/earnings/approve] Affiliate lookup failed:", affErr);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
    type AffRow = { id: string; agreement_status: string | null };
    agreementByAffiliate = new Map<string, string | null>(
      ((affRows as AffRow[] | null) ?? []).map((a) => [a.id, a.agreement_status ?? null])
    );
  }

  const signedAffiliateIds = Array.from(agreementByAffiliate.entries())
    .filter(([, status]) => status === "Completed" || status === "signed")
    .map(([id]) => id);

  const eligibleIds = earningRows
    .filter((r) => {
      const s = agreementByAffiliate.get(r.affiliate_id) ?? null;
      return s === "Completed" || s === "signed";
    })
    .map((r) => r.id);
  const blockedCount = earning_ids.length - eligibleIds.length;

  if (eligibleIds.length === 0) {
    return NextResponse.json({
      approved: 0,
      blocked: blockedCount,
      message: "All requested earnings are blocked by unsigned contracts.",
    }, { status: 409 });
  }

  // Update earnings status to 'approved'
  const { data: updatedEarnings, error: updateError } = await svc
    .from("earnings")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .in("id", eligibleIds)
    .eq("status", "pending")
    .in("affiliate_id", signedAffiliateIds)
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
      requested: earning_ids.length,
      blocked: blockedCount,
      earning_ids: earning_ids.slice(0, 10), // log max 10 for brevity
    },
  });

  return NextResponse.json({
    approved: approved.length,
    blocked: blockedCount,
    notifications_created: notifications.length,
  });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
