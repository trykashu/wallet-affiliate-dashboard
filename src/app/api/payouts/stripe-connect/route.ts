/**
 * GET  /api/payouts/stripe-connect
 *   - Generates a Stripe Connect account link; redirects affiliate to onboarding.
 *   - Also handles the Stripe return_url callback when ?connected=true is present.
 *
 * POST /api/payouts/stripe-connect
 *   - Legacy POST callback fallback.
 */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key);
}

/** App base URL — prefer server-only APP_URL to avoid NEXT_PUBLIC_ exposure */
function getAppBase(): string {
  const url = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!url) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("[stripe-connect] FATAL: No APP_URL configured in production");
    }
    console.warn("[stripe-connect] No APP_URL configured — using localhost fallback");
    return "http://localhost:3000";
  }
  return url;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const connected   = searchParams.get("connected");
  const accountId   = searchParams.get("account_id");
  const affiliateId = searchParams.get("affiliate_id");

  // -- Stripe return_url callback (GET redirect from Stripe) --
  if (connected === "true" && accountId && affiliateId) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    // Verify the authenticated user actually owns this affiliate_id
    const { data: ownAffiliate } = await db
      .from("affiliates")
      .select("id")
      .single();

    if (!ownAffiliate || ownAffiliate.id !== affiliateId) {
      console.error(
        "[stripe-connect] Ownership mismatch — session affiliate:",
        ownAffiliate?.id,
        "param affiliate_id:",
        affiliateId,
      );
      return NextResponse.redirect(
        new URL("/dashboard/payouts?stripe=error", request.url),
      );
    }

    await db
      .from("payout_accounts")
      .update({
        is_verified:  true,
        account_name: `Stripe Express (${accountId.slice(-4)})`,
      })
      .eq("affiliate_id", affiliateId)
      .eq("provider_id", accountId);

    return NextResponse.redirect(
      new URL("/dashboard/payouts?stripe=connected", request.url),
    );
  }

  // -- Normal flow: generate Stripe account link --
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: affiliate } = await db.from("affiliates").select("id").single();
  if (!affiliate) return NextResponse.json({ error: "Affiliate not found" }, { status: 404 });

  try {
    const stripe = getStripe();

    // Create or retrieve the Stripe Connect account for this affiliate
    const { data: existing } = await db
      .from("payout_accounts")
      .select("provider_id, is_verified")
      .eq("affiliate_id", affiliate.id)
      .eq("provider", "stripe_connect")
      .maybeSingle();

    let acctId: string;
    if (existing?.provider_id) {
      acctId = existing.provider_id;
    } else {
      const account = await stripe.accounts.create({ type: "express" });
      acctId = account.id;

      await db.from("payout_accounts").upsert(
        {
          affiliate_id:  affiliate.id,
          provider:      "stripe_connect",
          provider_id:   acctId,
          account_name:  "Stripe Express",
          is_verified:   false,
          is_default:    false,
        },
        { onConflict: "affiliate_id, provider" },
      );
    }

    const appBase = getAppBase();
    const accountLink = await stripe.accountLinks.create({
      account:     acctId,
      refresh_url: `${appBase}/dashboard/payouts?stripe=refresh`,
      return_url:  `${appBase}/api/payouts/stripe-connect?connected=true&account_id=${acctId}&affiliate_id=${affiliate.id}`,
      type:        "account_onboarding",
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (err) {
    console.error("[stripe-connect] Error:", err);
    return NextResponse.json({ error: "Failed to create Stripe link" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // Legacy POST callback — kept for any direct POST flows, ownership-verified
  const { searchParams } = new URL(request.url);
  const connected   = searchParams.get("connected");
  const accountId   = searchParams.get("account_id");
  const affiliateId = searchParams.get("affiliate_id");

  if (!connected || !accountId || !affiliateId) {
    return NextResponse.redirect(
      new URL("/dashboard/payouts?stripe=error", request.url),
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Verify ownership before updating any payout account
  const { data: ownAffiliate } = await db.from("affiliates").select("id").single();

  if (!ownAffiliate || ownAffiliate.id !== affiliateId) {
    console.error(
      "[stripe-connect POST] Ownership mismatch — session affiliate:",
      ownAffiliate?.id,
      "param affiliate_id:",
      affiliateId,
    );
    return NextResponse.redirect(
      new URL("/dashboard/payouts?stripe=error", request.url),
    );
  }

  await db
    .from("payout_accounts")
    .update({
      is_verified:  true,
      account_name: `Stripe Express (${accountId.slice(-4)})`,
    })
    .eq("affiliate_id", affiliateId)
    .eq("provider_id", accountId);

  return NextResponse.redirect(
    new URL("/dashboard/payouts?stripe=connected", request.url),
  );
}
