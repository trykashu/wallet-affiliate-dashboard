/**
 * POST /api/admin/payouts/reject-batch
 *
 * Finance-only. Flips all payouts in a batch from pending_review → rejected
 * and clears earnings.payout_id so those earnings can be included in a future batch.
 *
 * Body: { batch_id: string, notes: string }  (notes required to document why)
 * Returns: { rejected_count, unlinked_earnings }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isFinanceEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";

const BodySchema = z.object({
  batch_id: z.string().uuid(),
  notes: z.string().min(1, "notes required for rejection").max(500),
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

  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }
  const { batch_id, notes } = parsed.data;
  const nowIso = new Date().toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // 1) Look up the payout IDs in this batch so we can unlink earnings.
  const { data: payoutsInBatch, error: fetchError } = await svc
    .from("payouts")
    .select("id")
    .eq("batch_id", batch_id)
    .eq("status", "pending_review");

  if (fetchError) {
    console.error("[reject-batch] Fetch failed:", fetchError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  type PayoutRow = { id: string };
  const payoutIds = ((payoutsInBatch as PayoutRow[] | null) ?? []).map((p) => p.id);

  if (payoutIds.length === 0) {
    return NextResponse.json({
      rejected_count: 0,
      unlinked_earnings: 0,
      message: "No pending_review payouts found for this batch_id.",
    }, { status: 409 });
  }

  // 2) Clear payout_id on linked earnings so they can be re-batched.
  //    Earnings retain status='approved'.
  const { data: unlinked, error: unlinkError } = await svc
    .from("earnings")
    .update({ payout_id: null, updated_at: nowIso })
    .in("payout_id", payoutIds)
    .select("id");

  if (unlinkError) {
    console.error("[reject-batch] Unlink failed:", unlinkError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  // 3) Flip payouts to rejected with reviewer + notes.
  const { error: rejectError } = await svc
    .from("payouts")
    .update({
      status: "rejected",
      reviewed_by: user.email ?? null,
      reviewed_at: nowIso,
      review_notes: notes,
      updated_at: nowIso,
    })
    .in("id", payoutIds);

  if (rejectError) {
    console.error("[reject-batch] Reject failed:", rejectError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const unlinkedCount = ((unlinked as { id: string }[] | null) ?? []).length;

  logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: "admin.batch_reject",
    resourceType: "payouts",
    metadata: { batch_id, count: payoutIds.length, notes, unlinked_earnings: unlinkedCount },
  });

  return NextResponse.json({
    rejected_count: payoutIds.length,
    unlinked_earnings: unlinkedCount,
  });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
