/**
 * POST /api/payouts/request
 * Creates a payout request for the authenticated affiliate.
 * Uses atomic RPC to prevent TOCTOU double-spend race conditions.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const RequestSchema = z.object({
  amount:     z.number().positive().finite().max(1_000_000),
  account_id: z.string().uuid().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { amount, account_id } = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Check minimum payout amount
  const { data: settings } = await db.from("payout_settings").select("min_payout_amount").limit(1).single();
  const minAmount = settings?.min_payout_amount ?? 25;
  if (amount < minAmount) {
    return NextResponse.json(
      { error: `Minimum payout amount is $${minAmount.toFixed(2)}` },
      { status: 400 }
    );
  }

  const { data: affiliate } = await db.from("affiliates").select("id").single();
  if (!affiliate) return NextResponse.json({ error: "Affiliate not found" }, { status: 404 });

  // Atomic balance check + insert via RPC (prevents TOCTOU double-spend race condition)
  const { data: result, error: rpcError } = await db.rpc("request_payout", {
    p_affiliate_id: affiliate.id,
    p_amount:       amount,
  });

  if (rpcError) {
    console.error("[payout-request] RPC failed:", rpcError);
    return NextResponse.json({ error: "Failed to create payout request" }, { status: 500 });
  }

  if (!result?.success) {
    return NextResponse.json({ error: "Insufficient balance" }, { status: 400 });
  }

  // Notify affiliate (confirmation)
  await db.from("notifications").insert({
    affiliate_id: affiliate.id,
    type:         "payout_processed",
    title:        `Payout requested — $${amount.toFixed(2)}`,
    body:         "Your payout request has been received and will be processed within 3-5 business days.",
    metadata:     { amount },
  });

  return NextResponse.json({ success: true });
}
