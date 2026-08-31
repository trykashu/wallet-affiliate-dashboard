/**
 * POST /api/admin/payouts/update-status
 *
 * Finance-only: manually update a payout's status.
 * Accepts { payout_id: string, status: "completed" | "failed" | "requested" }
 *
 * "requested" is the Retry path for a failed payout — it re-queues the payout
 * for the next execute-batch run. It does NOT itself call Mercury.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isFinanceEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";
import { markEarningsPaidForPayout } from "@/lib/payouts/mark-paid";
import { canTransitionPayoutStatus } from "@/lib/payouts/status-transitions";

const UpdateSchema = z.object({
  payout_id: z.string().uuid(),
  status: z.enum(["completed", "failed", "requested"]),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !isFinanceEmail(user.email)) {
    return NextResponse.json({ error: "Finance access required" }, { status: 403 });
  }

  let rawBody: unknown;
  try { rawBody = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = UpdateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { payout_id, status } = parsed.data;

  // Guard the transition. Retry (-> requested) is only valid from `failed`;
  // permitting it from `completed` would reopen a settled payout and allow the
  // same earnings to be paid twice.
  const { data: current } = await svc
    .from("payouts")
    .select("status")
    .eq("id", payout_id)
    .maybeSingle();

  if (!current) {
    return NextResponse.json({ error: "Payout not found" }, { status: 404 });
  }
  if (!canTransitionPayoutStatus(current.status, status)) {
    return NextResponse.json(
      { error: `Cannot change a ${current.status} payout to ${status}` },
      { status: 409 },
    );
  }

  const { error: updateError } = await svc
    .from("payouts")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", payout_id);

  if (updateError) {
    console.error("[admin/payouts/update-status] Update failed:", updateError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  // If completed, notify affiliate and mark linked earnings as paid.
  // (mark-paid is idempotent, so re-running it here when the statement
  // path already flipped them is safe.)
  let earningsMarkedPaid = 0;
  let airtableUpdated = 0;
  let airtableFailed = 0;
  if (status === "completed") {
    const { data: payout } = await svc
      .from("payouts")
      .select("affiliate_id, amount")
      .eq("id", payout_id)
      .maybeSingle();

    if (payout) {
      await svc.from("notifications").insert({
        affiliate_id: payout.affiliate_id,
        type: "payout_processed",
        title: "Payout completed",
        body: `Your payout of $${payout.amount.toFixed(2)} has been processed.`,
        is_read: false,
      });

      const mark = await markEarningsPaidForPayout(svc, payout_id);
      earningsMarkedPaid = mark.earningsMarkedPaid;
      airtableUpdated = mark.airtableUpdated;
      airtableFailed = mark.airtableErrors.length;
    }
  }

  // Audit log
  logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: status === "completed" ? "admin.payout_complete" : "admin.payout_status_update",
    resourceType: "payouts",
    resourceId: payout_id,
    metadata: {
      new_status: status,
      earnings_marked_paid: earningsMarkedPaid,
      airtable_updated: airtableUpdated,
      airtable_failed: airtableFailed,
    },
  });

  return NextResponse.json({ success: true });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
