/**
 * GET /api/cron/check-mercury-payouts
 *
 * Cron job: poll Mercury for status updates on 'processing' payouts.
 * Run via Vercel Cron or external scheduler.
 * Protected by CRON_SECRET header.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { getTransactionStatus } from "@/lib/mercury";
import { patchRecords } from "@/lib/airtable";
import type { Payout } from "@/types/database";

const AIRTABLE_TRANSACTIONS_TABLE_ID = "tblyWtDBeiZAqDm8P";
const COMMISSION_STATUS_FIELD = "Commission Status";
const COMMISSION_STATUS_PAID_VALUE = "Paid";

export async function GET(request: NextRequest) {
  // Auth: cron secret OR admin session
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const hasCronSecret = cronSecret && authHeader === `Bearer ${cronSecret}`;

  let isAdmin = false;
  if (!hasCronSecret) {
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      isAdmin = !!user && isAdminEmail(user.email);
    } catch { /* no session */ }
  }

  if (!hasCronSecret && !isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // Get all processing payouts with Mercury references
  const { data: processingPayouts, error: fetchError } = await svc
    .from("payouts")
    .select("*")
    .eq("status", "processing")
    .not("provider_reference_id", "is", null);

  if (fetchError) {
    console.error("[cron/check-mercury-payouts] Fetch failed:", fetchError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const payouts: Payout[] = processingPayouts ?? [];

  if (payouts.length === 0) {
    return NextResponse.json({ success: true, checked: 0, message: "No processing payouts to check." });
  }

  let updatedCount = 0;
  const errors: string[] = [];

  for (const payout of payouts) {
    if (!payout.provider_reference_id) continue;

    try {
      const mercuryStatus = await getTransactionStatus(payout.provider_reference_id);

      let newStatus: string | null = null;
      if (mercuryStatus.status === "sent") {
        newStatus = "completed";
      } else if (mercuryStatus.status === "cancelled" || mercuryStatus.status === "failed") {
        newStatus = "failed";
      }
      // "pending" means still processing, no update needed

      if (newStatus) {
        const nowIso = new Date().toISOString();

        await svc
          .from("payouts")
          .update({ status: newStatus, updated_at: nowIso })
          .eq("id", payout.id);

        let earningsMarkedPaid = 0;
        let airtableUpdated = 0;
        let airtableFailed = 0;

        if (newStatus === "completed") {
          // Mark linked earnings as paid. Guard with status='approved' so we never
          // double-flip or accidentally regress a 'pending'/'reversed' earning.
          // Filter by payout_id (NOT affiliate_id) so we only touch earnings
          // actually attached to this payout's batch.
          const { data: paidRows, error: paidError } = await svc
            .from("earnings")
            .update({ status: "paid", updated_at: nowIso })
            .eq("payout_id", payout.id)
            .eq("status", "approved")
            .select("id, transaction_ref");

          if (paidError) {
            console.error(`[cron/check-mercury-payouts] Mark-paid failed for ${payout.id}:`, paidError);
          } else {
            type PaidRow = { id: string; transaction_ref: string | null };
            const rows = (paidRows ?? []) as PaidRow[];
            earningsMarkedPaid = rows.length;

            // Mirror Commission Status = Paid to Airtable Partner Transaction Log.
            // Best-effort: failures are logged but don't block the DB update.
            const baseId = process.env.AIRTABLE_LAUNCH_BASE;
            const recordIds = rows.map((r) => r.transaction_ref).filter((r): r is string => !!r);
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
                airtableFailed = patch.failed.length;
                if (patch.failed.length > 0) {
                  console.error(`[cron/check-mercury-payouts] Airtable PATCH partial failure for ${payout.id}:`, patch.failed.slice(0, 3));
                }
              } catch (e) {
                console.error(`[cron/check-mercury-payouts] Airtable PATCH threw for ${payout.id}:`, e);
                airtableFailed = recordIds.length;
              }
            }
          }
        }

        // Notify affiliate
        const notifTitle = newStatus === "completed" ? "Payout completed" : "Payout failed";
        const notifBody = newStatus === "completed"
          ? `Your payout of $${payout.amount.toFixed(2)} has been deposited.`
          : `Your payout of $${payout.amount.toFixed(2)} failed. Please contact support.`;

        await svc.from("notifications").insert({
          affiliate_id: payout.affiliate_id,
          type: "payout_processed",
          title: notifTitle,
          body: notifBody,
          is_read: false,
        });

        updatedCount++;
      }
    } catch (err) {
      console.error(`[cron/check-mercury-payouts] Failed to check payout ${payout.id}:`, err instanceof Error ? err.message : "unknown");
      errors.push(`Payout ${payout.id}: Check failed`);
    }
  }

  return NextResponse.json({
    success: true,
    checked: payouts.length,
    updated: updatedCount,
    errors: errors.length > 0 ? errors : undefined,
  });
}
