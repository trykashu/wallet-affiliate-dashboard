import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { calculateEarning, calculateKashuFee, getTierForVolume } from "@/lib/tier";
import {
  checkUserMilestone,
  checkEarningsMilestone,
  checkVolumeMilestone,
} from "@/lib/milestones";
import type { FunnelStatusSlug } from "@/types/database";

export const dynamic = "force-dynamic";

// --- Webhook secret validation (timing-safe, matches MRP Airtable pattern) ---

function verifyWebhookSecret(request: NextRequest): boolean {
  const secret = request.headers.get("x-webhook-secret") ?? "";
  const expected = process.env.WALLET_WEBHOOK_SECRET ?? "";
  if (!expected) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a); // burn constant time on length mismatch
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

// --- Stage ordering for advancement logic ---

const STAGE_ORDER: FunnelStatusSlug[] = [
  "waitlist",
  "booked_call",
  "sent_onboarding",
  "signed_up",
  "transaction_run",
  "funds_in_wallet",
  "ach_initiated",
  "funds_in_bank",
];

function stageIndex(slug: FunnelStatusSlug): number {
  return STAGE_ORDER.indexOf(slug);
}

// --- Stage advancement helper ---

async function advanceStage(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
  newStage: FunnelStatusSlug
) {
  const { data: user, error } = await db
    .from("referred_users")
    .select("id, status_slug")
    .eq("id", userId)
    .single();

  if (error || !user) return;

  const currentIdx = stageIndex(user.status_slug);
  const newIdx = stageIndex(newStage);

  // Only advance forward, never backward or same
  if (newIdx <= currentIdx) return;

  await db.from("funnel_events").insert({
    referred_user_id: user.id,
    from_status: user.status_slug,
    to_status: newStage,
  });

  await db
    .from("referred_users")
    .update({ status_slug: newStage })
    .eq("id", user.id);
}

// --- Event handlers ---

interface WebhookData {
  wallet_user_id: string;
  affiliate_attribution_id?: string;
  full_name?: string;
  email?: string;
  phone?: string;
  transaction_amount?: number;
  transaction_fee?: number;
}

async function handleUserSignedUp(
  db: ReturnType<typeof createServiceClient>,
  data: WebhookData
) {
  if (!data.affiliate_attribution_id) {
    throw new Error("Missing affiliate_attribution_id for user.signed_up");
  }

  // Find affiliate by attribution_id
  const { data: affiliate, error: affErr } = await db
    .from("affiliates")
    .select("id, agent_name")
    .eq("attribution_id", data.affiliate_attribution_id)
    .single();

  if (affErr || !affiliate) {
    throw new Error(
      `Affiliate not found for attribution_id: ${data.affiliate_attribution_id}`
    );
  }

  // Upsert referred_user (onConflict: wallet_user_id)
  const { data: referredUser, error: upsertErr } = await db
    .from("referred_users")
    .upsert(
      {
        affiliate_id: affiliate.id,
        wallet_user_id: data.wallet_user_id,
        full_name: data.full_name ?? "Unknown",
        email: data.email ?? "",
        phone: data.phone ?? null,
        status_slug: "signed_up" as FunnelStatusSlug,
      },
      { onConflict: "wallet_user_id" }
    )
    .select("id")
    .single();

  if (upsertErr || !referredUser) {
    throw new Error(`Failed to upsert referred_user: ${upsertErr?.message}`);
  }

  // Insert funnel_event
  await db.from("funnel_events").insert({
    referred_user_id: referredUser.id,
    from_status: null,
    to_status: "signed_up" as FunnelStatusSlug,
  });

  // Insert notification for affiliate
  await db.from("notifications").insert({
    affiliate_id: affiliate.id,
    type: "funnel_change" as const,
    title: "New referred user signed up",
    body: `${data.full_name ?? "A new user"} signed up through your referral link.`,
  });

  // Check user count milestone
  const { count } = await db
    .from("referred_users")
    .select("id", { count: "exact", head: true })
    .eq("affiliate_id", affiliate.id);

  if (count !== null) {
    const milestone = checkUserMilestone(count);
    if (milestone) {
      await db.from("notifications").insert({
        affiliate_id: affiliate.id,
        type: "system_announcement" as const,
        title: milestone.title,
        body: milestone.body,
      });
    }
  }
}

async function handleTransactionCompleted(
  db: ReturnType<typeof createServiceClient>,
  data: WebhookData
) {
  // Find referred_user by wallet_user_id
  const { data: referredUser, error: userErr } = await db
    .from("referred_users")
    .select("id, affiliate_id, first_transaction_at, status_slug")
    .eq("wallet_user_id", data.wallet_user_id)
    .single();

  if (userErr || !referredUser) {
    throw new Error(
      `Referred user not found for wallet_user_id: ${data.wallet_user_id}`
    );
  }

  // Advance stage regardless
  await advanceStage(db, referredUser.id, "transaction_run");

  // If first_transaction_at already set, only advance stage — no duplicate earning
  if (referredUser.first_transaction_at) {
    return;
  }

  // Get affiliate for tier info
  const { data: affiliate, error: affErr } = await db
    .from("affiliates")
    .select("id, tier, tier_override, referred_volume_total")
    .eq("id", referredUser.affiliate_id)
    .single();

  if (affErr || !affiliate) {
    throw new Error(
      `Affiliate not found for id: ${referredUser.affiliate_id}`
    );
  }

  const transactionAmount = data.transaction_amount ?? 0;
  const kashuFee = calculateKashuFee(transactionAmount); // 8.5% of TPV
  const earningAmount = calculateEarning(transactionAmount, affiliate.tier);

  // Update referred_user with first transaction data
  await db
    .from("referred_users")
    .update({
      first_transaction_amount: transactionAmount,
      first_transaction_fee: kashuFee,
      first_transaction_at: new Date().toISOString(),
      status_slug: "transaction_run" as FunnelStatusSlug,
    })
    .eq("id", referredUser.id);

  // Insert earning (status: pending)
  await db.from("earnings").insert({
    affiliate_id: affiliate.id,
    referred_user_id: referredUser.id,
    amount: earningAmount,
    transaction_fee_amount: kashuFee,
    tier_at_earning: affiliate.tier,
    status: "pending" as const,
  });

  // Update affiliate's referred_volume_total
  const previousVolume = affiliate.referred_volume_total;
  const newVolume = previousVolume + transactionAmount;

  await db
    .from("affiliates")
    .update({ referred_volume_total: newVolume })
    .eq("id", affiliate.id);

  // Check tier upgrade: if not tier_override AND gold AND new volume qualifies for platinum
  if (!affiliate.tier_override && affiliate.tier === "gold") {
    const newTier = getTierForVolume(newVolume);
    if (newTier === "platinum") {
      await db
        .from("affiliates")
        .update({ tier: "platinum" })
        .eq("id", affiliate.id);

      await db.from("notifications").insert({
        affiliate_id: affiliate.id,
        type: "tier_upgrade" as const,
        title: "Congratulations! You've been upgraded to Platinum!",
        body: "Your referred volume has crossed $250K. You now earn 10% of Kashu's fee on users that you refer who deposit funds into the wallet.",
      });
    }
  }

  // Check volume milestone
  const volumeMilestone = checkVolumeMilestone(newVolume, previousVolume);
  if (volumeMilestone) {
    await db.from("notifications").insert({
      affiliate_id: affiliate.id,
      type: "system_announcement" as const,
      title: volumeMilestone.title,
      body: volumeMilestone.body,
    });
  }

  // Check earnings milestone — get total earnings for affiliate
  const { data: earningsAgg } = await db
    .from("earnings")
    .select("amount")
    .eq("affiliate_id", affiliate.id);

  if (earningsAgg) {
    const totalEarnings = earningsAgg.reduce((sum, e) => sum + e.amount, 0);
    const previousTotal = totalEarnings - earningAmount;
    const earningsMilestone = checkEarningsMilestone(
      totalEarnings,
      previousTotal
    );
    if (earningsMilestone) {
      await db.from("notifications").insert({
        affiliate_id: affiliate.id,
        type: "system_announcement" as const,
        title: earningsMilestone.title,
        body: earningsMilestone.body,
      });
    }
  }

  // Insert earning notification
  await db.from("notifications").insert({
    affiliate_id: affiliate.id,
    type: "earning_credited" as const,
    title: "New earning from referral transaction",
    body: `You earned $${earningAmount.toFixed(2)} from a referred user's transaction of $${transactionAmount.toFixed(2)}.`,
  });
}

async function handleWalletFunded(
  db: ReturnType<typeof createServiceClient>,
  data: WebhookData
) {
  const { data: referredUser, error } = await db
    .from("referred_users")
    .select("id")
    .eq("wallet_user_id", data.wallet_user_id)
    .single();

  if (error || !referredUser) {
    throw new Error(
      `Referred user not found for wallet_user_id: ${data.wallet_user_id}`
    );
  }

  await advanceStage(db, referredUser.id, "funds_in_wallet");
}

async function handleAchInitiated(
  db: ReturnType<typeof createServiceClient>,
  data: WebhookData
) {
  const { data: referredUser, error } = await db
    .from("referred_users")
    .select("id")
    .eq("wallet_user_id", data.wallet_user_id)
    .single();

  if (error || !referredUser) {
    throw new Error(
      `Referred user not found for wallet_user_id: ${data.wallet_user_id}`
    );
  }

  await advanceStage(db, referredUser.id, "ach_initiated");
}

async function handleAchCompleted(
  db: ReturnType<typeof createServiceClient>,
  data: WebhookData
) {
  const { data: referredUser, error } = await db
    .from("referred_users")
    .select("id")
    .eq("wallet_user_id", data.wallet_user_id)
    .single();

  if (error || !referredUser) {
    throw new Error(
      `Referred user not found for wallet_user_id: ${data.wallet_user_id}`
    );
  }

  await advanceStage(db, referredUser.id, "funds_in_bank");
}

// --- Main POST handler ---

export async function POST(request: NextRequest) {
  // 1. Validate webhook secret
  if (!verifyWebhookSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    event_type: string;
    idempotency_key: string;
    data: WebhookData;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { event_type, idempotency_key, data } = body;

  if (!event_type || !idempotency_key || !data) {
    return NextResponse.json(
      { error: "Missing required fields: event_type, idempotency_key, data" },
      { status: 400 }
    );
  }

  const db = createServiceClient();

  // 2. Check idempotency via webhook_events table
  const { data: existing } = await db
    .from("webhook_events")
    .select("id, processed")
    .eq("idempotency_key", idempotency_key)
    .single();

  if (existing) {
    return NextResponse.json(
      { status: "already_processed", idempotency_key },
      { status: 200 }
    );
  }

  // Insert the webhook event as unprocessed
  const { data: webhookEvent, error: insertErr } = await db
    .from("webhook_events")
    .insert({
      idempotency_key,
      event_type,
      payload: data as unknown as Record<string, unknown>,
      processed: false,
    })
    .select("id")
    .single();

  if (insertErr || !webhookEvent) {
    // Could be a race condition — another request already inserted
    return NextResponse.json(
      { status: "already_processed", idempotency_key },
      { status: 200 }
    );
  }

  // 3. Route by event_type to handler functions
  try {
    switch (event_type) {
      case "user.signed_up":
        await handleUserSignedUp(db, data);
        break;
      case "transaction.completed":
        await handleTransactionCompleted(db, data);
        break;
      case "wallet.funded":
        await handleWalletFunded(db, data);
        break;
      case "ach.initiated":
        await handleAchInitiated(db, data);
        break;
      case "ach.completed":
        await handleAchCompleted(db, data);
        break;
      default:
        // Unknown event type — mark as processed but log it
        await db
          .from("webhook_events")
          .update({
            processed: true,
            processed_at: new Date().toISOString(),
            error_message: `Unknown event_type: ${event_type}`,
          })
          .eq("id", webhookEvent.id);
        return NextResponse.json(
          { status: "unknown_event_type", event_type },
          { status: 200 }
        );
    }

    // Mark as processed
    await db
      .from("webhook_events")
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
      })
      .eq("id", webhookEvent.id);

    return NextResponse.json(
      { status: "processed", event_type, idempotency_key },
      { status: 200 }
    );
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown processing error";

    // Log error to webhook_events
    await db
      .from("webhook_events")
      .update({
        processed: false,
        error_message: errorMessage,
      })
      .eq("id", webhookEvent.id);

    console.error(`[webhook/wallet] ${event_type} error:`, errorMessage);

    return NextResponse.json(
      { error: "Processing failed" },
      { status: 500 }
    );
  }
}
