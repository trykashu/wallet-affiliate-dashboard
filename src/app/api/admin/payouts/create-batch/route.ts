/**
 * POST /api/admin/payouts/create-batch
 *
 * Admin-only: find all affiliates with approved earnings above min_payout_amount,
 * and create a payout row for each.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";
import type { Earning, PayoutSettings } from "@/types/database";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Parse optional affiliate_ids filter from request body
  let selectedAffiliateIds: string[] | null = null;
  try {
    const body = await request.json();
    if (Array.isArray(body.affiliate_ids) && body.affiliate_ids.length > 0) {
      selectedAffiliateIds = body.affiliate_ids;
    }
  } catch {
    // No body or invalid JSON — process all affiliates
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // Get payout settings
  const { data: settings } = await svc
    .from("payout_settings")
    .select("*")
    .limit(1)
    .maybeSingle();

  const minPayout = (settings as PayoutSettings | null)?.min_payout_amount ?? 25;

  // Get all approved earnings
  const { data: approvedEarnings, error: earningsError } = await svc
    .from("earnings")
    .select("id, affiliate_id, amount")
    .eq("status", "approved");

  if (earningsError) {
    console.error("[admin/payouts/create-batch] Earnings query failed:", earningsError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const earnings: Earning[] = approvedEarnings ?? [];

  // Group by affiliate
  const balanceByAffiliate = new Map<string, number>();
  for (const e of earnings) {
    balanceByAffiliate.set(e.affiliate_id, (balanceByAffiliate.get(e.affiliate_id) ?? 0) + e.amount);
  }

  // Create payout rows for affiliates above min
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM
  const payoutInserts: {
    affiliate_id: string;
    amount: number;
    currency: string;
    status: string;
    period: string;
  }[] = [];

  for (const [affId, balance] of balanceByAffiliate) {
    // Skip if we have a selection and this affiliate isn't in it
    if (selectedAffiliateIds && !selectedAffiliateIds.includes(affId)) continue;
    if (balance >= minPayout) {
      payoutInserts.push({
        affiliate_id: affId,
        amount: balance,
        currency: "USD",
        status: "requested",
        period,
      });
    }
  }

  if (payoutInserts.length === 0) {
    return NextResponse.json({ success: true, created_count: 0, message: "No affiliates above minimum payout threshold." });
  }

  const { data: createdPayouts, error: insertError } = await svc
    .from("payouts")
    .insert(payoutInserts)
    .select("id");

  if (insertError) {
    console.error("[admin/payouts/create-batch] Insert failed:", insertError);
    return NextResponse.json({ error: "Failed to create payouts" }, { status: 500 });
  }

  // Mark the approved earnings as 'paid' (since they're now part of a payout batch)
  const affiliateIdsInBatch = payoutInserts.map((p) => p.affiliate_id);
  const earningIdsToUpdate = earnings
    .filter((e) => affiliateIdsInBatch.includes(e.affiliate_id))
    .map((e) => e.id);

  if (earningIdsToUpdate.length > 0) {
    await svc
      .from("earnings")
      .update({ status: "paid", updated_at: new Date().toISOString() })
      .in("id", earningIdsToUpdate);
  }

  // Audit log
  logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: "admin.payout_batch_created",
    resourceType: "payouts",
    metadata: {
      count: createdPayouts?.length ?? 0,
      total_amount: payoutInserts.reduce((s, p) => s + p.amount, 0),
      period,
    },
  });

  return NextResponse.json({
    success: true,
    created_count: createdPayouts?.length ?? 0,
  });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
