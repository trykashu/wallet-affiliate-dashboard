/**
 * POST /api/admin/payouts/update-status
 *
 * Admin-only: manually update a payout's status.
 * Accepts { payout_id: string, status: "completed" | "failed" }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isFinanceEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";
import { patchRecords } from "@/lib/airtable";

// Airtable Partner Transaction Log table (same base/table used by the
// transactions sync — see src/app/api/sync/transactions/route.ts).
const AIRTABLE_TRANSACTIONS_TABLE_ID = "tblyWtDBeiZAqDm8P";
const COMMISSION_STATUS_FIELD = "Commission Status";
const COMMISSION_STATUS_PAID_VALUE = "Paid";

const UpdateSchema = z.object({
  payout_id: z.string().uuid(),
  status: z.enum(["completed", "failed"]),
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

  const { error: updateError } = await svc
    .from("payouts")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", payout_id);

  if (updateError) {
    console.error("[admin/payouts/update-status] Update failed:", updateError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  // If completed, notify affiliate and mark linked earnings as paid
  let earningsMarkedPaid = 0;
  let airtableUpdated = 0;
  const airtableErrors: Array<{ record_id: string; error: string }> = [];
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

      // Mark linked earnings as paid. Guard with status='approved' so we never
      // double-flip or accidentally regress a 'pending'/'reversed' earning.
      // Also return transaction_ref so we can mirror "Paid" into Airtable's
      // Partner Transaction Log (best-effort).
      const nowIso = new Date().toISOString();
      const { data: paidRows, error: paidError } = await svc
        .from("earnings")
        .update({ status: "paid", updated_at: nowIso })
        .eq("payout_id", payout_id)
        .eq("status", "approved")
        .select("id, transaction_ref");
      if (paidError) {
        console.error("[update-status] Mark-paid failed:", paidError);
        // Don't bail — the payout is already flipped to completed. Surface in audit.
      } else {
        type PaidRow = { id: string; transaction_ref: string | null };
        const rows = (paidRows ?? []) as PaidRow[];
        earningsMarkedPaid = rows.length;

        // Mirror "Paid" to Airtable Partner Transaction Log. Best-effort —
        // failure is logged in the audit metadata but doesn't fail the request.
        const baseId = process.env.AIRTABLE_LAUNCH_BASE;
        const recordIds = rows
          .map((r) => r.transaction_ref)
          .filter((r): r is string => !!r);
        if (baseId && recordIds.length > 0) {
          try {
            const patch = await patchRecords(
              baseId,
              AIRTABLE_TRANSACTIONS_TABLE_ID,
              recordIds.map((id) => ({
                id,
                fields: { [COMMISSION_STATUS_FIELD]: COMMISSION_STATUS_PAID_VALUE },
              })),
            );
            airtableUpdated = patch.updated;
            airtableErrors.push(...patch.failed);
            if (patch.failed.length > 0) {
              console.error("[update-status] Airtable PATCH partial failure:", patch.failed.slice(0, 5));
            }
          } catch (e) {
            console.error("[update-status] Airtable PATCH threw:", e);
            airtableErrors.push({
              record_id: "(setup)",
              error: e instanceof Error ? e.message : String(e),
            });
          }
        } else if (!baseId && recordIds.length > 0) {
          console.warn("[update-status] AIRTABLE_LAUNCH_BASE not set; skipping Airtable mirror");
        }
      }
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
      airtable_failed: airtableErrors.length,
    },
  });

  return NextResponse.json({ success: true });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
