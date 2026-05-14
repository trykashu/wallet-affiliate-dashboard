/**
 * POST /api/admin/payouts/approve-batch
 *
 * Finance-only. Flips all payouts in a batch from pending_review → requested.
 * Body: { batch_id: string, notes?: string }
 * Returns: { approved_count }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isFinanceEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";

const BodySchema = z.object({
  batch_id: z.string().uuid(),
  notes: z.string().max(500).optional(),
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
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { batch_id, notes } = parsed.data;
  const nowIso = new Date().toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // Flip pending_review payouts in this batch to requested.
  const { data: updated, error: updateError } = await svc
    .from("payouts")
    .update({
      status: "requested",
      reviewed_by: user.email ?? null,
      reviewed_at: nowIso,
      review_notes: notes ?? null,
      updated_at: nowIso,
    })
    .eq("batch_id", batch_id)
    .eq("status", "pending_review")
    .select("id, affiliate_id, amount");

  if (updateError) {
    console.error("[approve-batch] Update failed:", updateError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const approvedCount = (updated ?? []).length;
  if (approvedCount === 0) {
    return NextResponse.json({
      approved_count: 0,
      message: "No pending_review payouts found for this batch_id.",
    }, { status: 409 });
  }

  logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: "admin.batch_approve",
    resourceType: "payouts",
    metadata: { batch_id, count: approvedCount },
  });

  return NextResponse.json({ approved_count: approvedCount });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
