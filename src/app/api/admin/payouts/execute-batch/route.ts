/**
 * POST /api/admin/payouts/execute-batch
 *
 * Admin-only: for each 'requested' payout, call Mercury API to send ACH transfer,
 * then update status to 'processing'.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";
import { sendACHTransfer } from "@/lib/mercury";
import type { Payout, PayoutAccount } from "@/types/database";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // Get all requested payouts
  const { data: requestedPayouts, error: fetchError } = await svc
    .from("payouts")
    .select("*")
    .eq("status", "requested");

  if (fetchError) {
    console.error("[admin/payouts/execute-batch] Fetch failed:", fetchError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const payouts: Payout[] = requestedPayouts ?? [];

  if (payouts.length === 0) {
    return NextResponse.json({ success: true, executed_count: 0, message: "No requested payouts to execute." });
  }

  // Get payout accounts for affiliates
  const affiliateIds = [...new Set(payouts.map((p) => p.affiliate_id))];
  const { data: accounts } = await svc
    .from("payout_accounts")
    .select("*")
    .in("affiliate_id", affiliateIds)
    .eq("is_default", true)
    .eq("is_verified", true);

  const accountsByAffiliate = new Map<string, PayoutAccount>();
  for (const acc of (accounts ?? []) as PayoutAccount[]) {
    accountsByAffiliate.set(acc.affiliate_id, acc);
  }

  let executedCount = 0;
  const errors: string[] = [];

  for (const payout of payouts) {
    const account = accountsByAffiliate.get(payout.affiliate_id);

    if (!account || !account.provider_id) {
      // Mark as failed if no valid payout account
      await svc
        .from("payouts")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", payout.id);
      errors.push(`Payout ${payout.id}: No verified payout account for affiliate`);
      continue;
    }

    try {
      const result = await sendACHTransfer({
        recipientId: account.provider_id,
        amount: payout.amount,
        idempotencyKey: `payout-${payout.id}`,
        note: `Affiliate commission payout - ${payout.period ?? "manual"}`,
        externalMemo: "Kashu Wallet Affiliate Commission",
      });

      // Update payout with Mercury reference
      await svc
        .from("payouts")
        .update({
          status: "processing",
          provider_reference_id: result.id,
          payout_account_id: account.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", payout.id);

      executedCount++;
    } catch (err) {
      console.error(`[admin/payouts/execute-batch] Mercury transfer failed for payout ${payout.id}:`, err instanceof Error ? err.message : "unknown");
      await svc
        .from("payouts")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", payout.id);
      errors.push(`Payout ${payout.id}: Transfer failed`);
    }
  }

  // Audit log
  logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: "admin.payout_batch_executed",
    resourceType: "payouts",
    metadata: {
      total: payouts.length,
      executed: executedCount,
      failed: errors.length,
    },
  });

  return NextResponse.json({
    success: true,
    executed_count: executedCount,
    failed_count: errors.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
