/**
 * POST /api/admin/payouts/execute-batch
 *
 * Admin-only: for each 'requested' payout, call Mercury API to send ACH transfer,
 * then update status to 'processing'.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isFinanceEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";
import { sendACHTransfer, getOrCreateRecipient } from "@/lib/mercury";
import type { Payout, PayoutAccount } from "@/types/database";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !isFinanceEmail(user.email)) {
    return NextResponse.json({ error: "Finance access required" }, { status: 403 });
  }

  // Optional batch_id scope
  let batchId: string | null = null;
  try {
    const body = await request.json();
    if (typeof body?.batch_id === "string") batchId = body.batch_id;
  } catch { /* no body — execute all requested */ }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // Load safety limits
  const { data: settings } = await svc.from("payout_settings").select("*").single();
  const maxSingle = settings?.max_single_payout ?? 5000;
  const maxDaily = settings?.max_daily_aggregate ?? 25000;
  const maxBatch = settings?.max_batch_size ?? 10;

  // Get requested payouts (optionally scoped to one batch)
  let query = svc.from("payouts").select("*").eq("status", "requested");
  if (batchId) query = query.eq("batch_id", batchId);
  const { data: requestedPayouts, error: fetchError } = await query;

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

  // Affiliate emails — passed to Mercury so the recipient gets notified.
  const { data: affEmails } = await svc
    .from("affiliates")
    .select("id, email")
    .in("id", affiliateIds);
  type AffEmailRow = { id: string; email: string | null };
  const emailByAffiliate = new Map<string, string | null>();
  for (const a of (affEmails as AffEmailRow[] | null) ?? []) emailByAffiliate.set(a.id, a.email);

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

    if (!account) {
      await svc
        .from("payouts")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", payout.id);
      errors.push(`Payout ${payout.id}: No payout account for affiliate`);
      continue;
    }

    // Get bank details from metadata (where CSV upload and manual entry store them)
    const meta = (account.metadata ?? {}) as Record<string, string>;
    const routingNumber = meta.routing_number || account.routing_number;
    const accountNumber = meta.full_account_number;
    const accountName = account.account_name || "Affiliate";

    if (!routingNumber || !accountNumber) {
      await svc
        .from("payouts")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", payout.id);
      errors.push(`Payout ${payout.id}: Missing bank details (routing or account number)`);
      continue;
    }

    // Semantic idempotency key
    const period = payout.period || new Date().toISOString().slice(0, 7);
    const idempotencyKey = `payout_${payout.affiliate_id}_${period}_${payout.id}`;

    // Refuse to execute when address is missing — Mercury was previously created
    // with Kashu's address by default. Now we require the affiliate's address
    // from their PandaDoc contract. If missing, the AM must Re-verify first.
    if (!account.address1 || !account.city || !account.region || !account.postal_code) {
      errors.push(`Payout ${payout.id}: payout_account is missing address — affiliate must Re-verify bank from PandaDoc first`);
      continue;
    }

    const address = {
      address1: account.address1,
      address2: account.address2,
      city: account.city,
      region: account.region,
      postalCode: account.postal_code,
      country: account.country || "US",
    };

    try {
      // Create Mercury recipient if we don't have one yet
      let recipientId = account.provider_id;
      if (!recipientId) {
        const affiliateEmail = emailByAffiliate.get(payout.affiliate_id) ?? undefined;
        recipientId = await getOrCreateRecipient(accountName, routingNumber, accountNumber, address, affiliateEmail);
        // Save the recipient ID for future payouts
        await svc
          .from("payout_accounts")
          .update({ provider_id: recipientId, updated_at: new Date().toISOString() })
          .eq("id", account.id);
      }

      // Audit log: attempt
      await svc.from("payout_audit_log").insert({
        payout_id: payout.id,
        affiliate_id: payout.affiliate_id,
        action: "MERCURY_SEND_ATTEMPT",
        amount: payout.amount,
        initiated_by: user.id,
        request_payload: { recipientId, amount: payout.amount, idempotencyKey },
      });

      const result = await sendACHTransfer({
        recipientId,
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
      batch_id: batchId ?? null,
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
