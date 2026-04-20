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

  // Load safety limits
  const { data: settings } = await svc.from("payout_settings").select("*").single();
  const maxSingle = settings?.max_single_payout ?? 5000;
  const maxDaily = settings?.max_daily_aggregate ?? 25000;
  const maxBatch = settings?.max_batch_size ?? 10;

  // Get all requested payouts
  const { data: requestedPayouts, error: fetchError } = await svc
    .from("payouts")
    .select("*")
    .eq("status", "requested");

  if (fetchError) {
    console.error("[admin/payouts/execute-batch] Fetch failed:", fetchError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  let payoutsToExecute: Payout[] = requestedPayouts ?? [];

  if (payoutsToExecute.length === 0) {
    return NextResponse.json({ success: true, executed_count: 0, message: "No requested payouts to execute." });
  }

  // Enforce batch size limit
  if (payoutsToExecute.length > maxBatch) {
    payoutsToExecute = payoutsToExecute.slice(0, maxBatch);
  }

  // Daily aggregate check — reject entire batch if it would exceed
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentPayouts } = await svc
    .from("payouts")
    .select("amount")
    .in("status", ["processing", "completed"])
    .gte("updated_at", twentyFourHoursAgo);
  const dailyTotal = (recentPayouts ?? []).reduce((s: number, p: { amount: number }) => s + p.amount, 0);
  const batchTotal = payoutsToExecute.reduce((s, p) => s + p.amount, 0);

  if (dailyTotal + batchTotal > maxDaily) {
    return NextResponse.json({
      error: "Daily payout limit would be exceeded",
      daily_total: dailyTotal,
      batch_total: batchTotal,
      limit: maxDaily,
    }, { status: 403 });
  }

  // Get payout accounts for affiliates
  const affiliateIds = [...new Set(payoutsToExecute.map((p) => p.affiliate_id))];
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
  let blockedCount = 0;
  const errors: string[] = [];

  for (const payout of payoutsToExecute) {
    // Per-payout max check — skip payouts over the limit
    if (payout.amount > maxSingle) {
      await svc.from("payout_audit_log").insert({
        payout_id: payout.id,
        affiliate_id: payout.affiliate_id,
        action: "BLOCKED_OVER_SINGLE_LIMIT",
        amount: payout.amount,
        initiated_by: user.id,
      });
      blockedCount++;
      continue;
    }

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

    // Semantic idempotency key
    const period = payout.period || new Date().toISOString().slice(0, 7);
    const idempotencyKey = `payout_${payout.affiliate_id}_${period}_${payout.id}`;

    // Audit log: attempt
    await svc.from("payout_audit_log").insert({
      payout_id: payout.id,
      affiliate_id: payout.affiliate_id,
      action: "MERCURY_SEND_ATTEMPT",
      amount: payout.amount,
      initiated_by: user.id,
      request_payload: { recipientId: account.provider_id, amount: payout.amount, idempotencyKey },
    });

    try {
      const result = await sendACHTransfer({
        recipientId: account.provider_id,
        amount: payout.amount,
        idempotencyKey,
        note: `Affiliate commission payout - ${payout.period ?? "manual"}`,
        externalMemo: "Kashu Wallet Affiliate Commission",
      });

      // Audit log: success
      await svc.from("payout_audit_log").insert({
        payout_id: payout.id,
        affiliate_id: payout.affiliate_id,
        action: "MERCURY_SEND_SUCCESS",
        amount: payout.amount,
        mercury_transaction_id: result.id,
        mercury_status: result.status,
        initiated_by: user.id,
        response_payload: result as unknown as Record<string, unknown>,
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
      const errorMessage = err instanceof Error ? err.message : "unknown";
      console.error(`[admin/payouts/execute-batch] Mercury transfer failed for payout ${payout.id}:`, errorMessage);

      // Audit log: failure
      await svc.from("payout_audit_log").insert({
        payout_id: payout.id,
        affiliate_id: payout.affiliate_id,
        action: "MERCURY_SEND_FAILED",
        amount: payout.amount,
        initiated_by: user.id,
        error_message: errorMessage,
      });

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
      total: payoutsToExecute.length,
      executed: executedCount,
      blocked: blockedCount,
      failed: errors.length,
    },
  });

  return NextResponse.json({
    success: true,
    executed_count: executedCount,
    blocked_count: blockedCount,
    failed_count: errors.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
