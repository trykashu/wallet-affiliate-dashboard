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
import type { Payout } from "@/types/database";

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
        await svc
          .from("payouts")
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq("id", payout.id);

        // When Mercury confirms success, mark associated earnings as 'paid'
        if (newStatus === "completed") {
          await svc
            .from("earnings")
            .update({ status: "paid", updated_at: new Date().toISOString() })
            .eq("affiliate_id", payout.affiliate_id)
            .eq("status", "approved");
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
