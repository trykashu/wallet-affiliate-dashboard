/**
 * GET /api/sync/transactions
 *
 * Fetches all records from Airtable "User Transactions" table, matches them
 * to affiliates and referred_users, upserts into the transactions table,
 * updates affiliate volume totals, handles tier upgrades, and creates
 * earnings for first transactions.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchAllRecords } from "@/lib/airtable";
import { calculateEarning, calculateKashuFee, getTierForVolume, TIER_THRESHOLDS } from "@/lib/tier";
import type { AffiliateTier, FunnelStatusSlug } from "@/types/database";

export const dynamic = "force-dynamic";

const AIRTABLE_TABLE_ID = "tblyWtDBeiZAqDm8P";
const BATCH_SIZE = 50;

// Funnel stages ordered for "is before" comparison
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

export async function GET() {
  const baseId = process.env.AIRTABLE_LAUNCH_BASE;
  if (!baseId) {
    return NextResponse.json(
      { error: "AIRTABLE_LAUNCH_BASE not configured" },
      { status: 500 },
    );
  }

  try {
    // Step 1: Fetch all records from Airtable User Transactions
    const { records, apiCalls } = await fetchAllRecords(baseId, AIRTABLE_TABLE_ID);

    // Step 2: Pre-load all affiliates into lookup maps
    const db = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: affiliates } = await (db as any)
      .from("affiliates")
      .select("id, attribution_id, business_name, agent_name, email, tier, tier_override, referred_volume_total");

    const affiliateById = new Map<string, {
      id: string;
      email: string | null;
      tier: AffiliateTier;
      tier_override: boolean;
      referred_volume_total: number;
    }>();
    const affiliatesByAttribution = new Map<string, string>();
    const affiliatesByBiz = new Map<string, string>();
    const affiliatesByName = new Map<string, string>();

    for (const a of affiliates || []) {
      affiliateById.set(a.id, {
        id: a.id,
        email: a.email || null,
        tier: a.tier,
        tier_override: a.tier_override,
        referred_volume_total: Number(a.referred_volume_total) || 0,
      });
      if (a.attribution_id) {
        affiliatesByAttribution.set(a.attribution_id.toLowerCase(), a.id);
      }
      if (a.business_name) {
        affiliatesByBiz.set(a.business_name.toLowerCase(), a.id);
      }
      if (a.agent_name) {
        affiliatesByName.set(a.agent_name.toLowerCase(), a.id);
      }
    }

    // Step 3: Pre-load all referred_users by email
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: referredUsers } = await (db as any)
      .from("referred_users")
      .select("id, email, affiliate_id, status_slug, first_transaction_at, created_at");

    const referredUserByEmail = new Map<string, {
      id: string;
      affiliate_id: string;
      status_slug: FunnelStatusSlug;
      first_transaction_at: string | null;
      created_at: string;
    }>();

    for (const ru of referredUsers || []) {
      if (ru.email) {
        referredUserByEmail.set(ru.email.toLowerCase(), {
          id: ru.id,
          affiliate_id: ru.affiliate_id,
          status_slug: ru.status_slug,
          first_transaction_at: ru.first_transaction_at,
          created_at: ru.created_at,
        });
      }
    }

    // Step 4: Process each transaction record
    interface TxnRow {
      airtable_record_id: string;
      affiliate_id: string;
      referred_user_id: string | null;
      amount: number;
      transaction_type: string;
      transaction_external_id: string | null;
      transaction_date: string | null;
      email: string | null;
      self_referral: boolean;
      card_last4: string | null;
      card_issuer: string | null;
      funnel_percent: number | null;
    }

    const rows: TxnRow[] = [];
    let skippedNoReferrer = 0;
    let skippedNoMatch = 0;
    let skippedNotTransferIn = 0;
    let skippedSelfReferral = 0;
    const unmatchedReferrers: string[] = [];

    // Track which affiliates have Transfer In transactions for volume update
    const affiliateTransferInTotals = new Map<string, number>();
    // Track eligible transactions for earnings (all txns in first month of referral)
    const eligibleEarnings: {
      referredUserId: string;
      affiliateId: string;
      amount: number;
      date: string | null;
      currentStatusSlug: FunnelStatusSlug;
      airtableRecordId: string;
    }[] = [];
    // Track first-transaction updates for referred_users
    const firstTxnUpdates: {
      referredUserId: string;
      affiliateId: string;
      amount: number;
      date: string | null;
      currentStatusSlug: FunnelStatusSlug;
    }[] = [];

    for (const record of records) {
      const fields = record.fields;

      // Get Referrer (lookup array — take first element)
      const referrerArr = fields["Referrer"] as string[] | undefined;
      const referrer = referrerArr?.[0]?.trim();
      if (!referrer) {
        skippedNoReferrer++;
        continue;
      }

      // Match referrer to affiliate: attribution_id > business_name > agent_name
      const referrerLower = referrer.toLowerCase();
      const affiliateId =
        affiliatesByAttribution.get(referrerLower) ||
        affiliatesByBiz.get(referrerLower) ||
        affiliatesByName.get(referrerLower);

      if (!affiliateId) {
        skippedNoMatch++;
        if (!unmatchedReferrers.includes(referrer)) {
          unmatchedReferrers.push(referrer);
        }
        continue;
      }

      // Parse fields
      const amount = Number(fields["Amount"]) || 0;
      const transactionType = (fields["Transaction Type"] as string) || "Unknown";

      // Only sync Transfer In transactions
      if (transactionType !== "Transfer In") {
        skippedNotTransferIn++;
        continue;
      }

      const transactionId = (fields["Transaction ID"] as string) || null;
      const dateTxn = (fields["Date Txn Started"] as string) || null;
      const emailArr = fields["Email"] as string[] | undefined;
      const email = emailArr?.[0]?.trim() || null;
      const lastFourRaw = fields["Last 4"];
      const cardLast4 =
        lastFourRaw === undefined || lastFourRaw === null || lastFourRaw === ""
          ? null
          : String(lastFourRaw).padStart(4, "0").slice(-4);
      const cardIssuer = (fields["Card Issuer"] as string) || null;
      const funnelArr = fields["Funnel %"] as (string | number)[] | undefined;
      const funnelRaw = funnelArr?.[0];
      const funnelParsed =
        funnelRaw === undefined || funnelRaw === null || funnelRaw === ""
          ? NaN
          : Number(String(funnelRaw).replace(/[^0-9.\-]/g, ""));
      const funnelPercent = Number.isFinite(funnelParsed) ? funnelParsed : null;

      // Self-referral check: flag if the transaction email matches the affiliate's email
      const affiliateRecord = affiliateById.get(affiliateId);
      const isSelfReferral = !!(email && affiliateRecord && email.toLowerCase() === (affiliateRecord.email || "").toLowerCase());
      if (isSelfReferral) skippedSelfReferral++;

      // Try to match to referred_user by email
      let referredUserId: string | null = null;
      let referredUser: {
        id: string;
        affiliate_id: string;
        status_slug: FunnelStatusSlug;
        first_transaction_at: string | null;
        created_at: string;
      } | null = null;
      if (email) {
        const ru = referredUserByEmail.get(email.toLowerCase());
        if (ru) {
          referredUserId = ru.id;
          referredUser = ru;
        }
      }

      rows.push({
        airtable_record_id: record.id,
        affiliate_id: affiliateId,
        referred_user_id: referredUserId,
        amount,
        transaction_type: transactionType,
        transaction_external_id: transactionId,
        transaction_date: dateTxn,
        email,
        self_referral: isSelfReferral,
        card_last4: cardLast4,
        card_issuer: cardIssuer,
        funnel_percent: funnelPercent,
      });

      // Track Transfer In amounts per affiliate for volume update
      if (transactionType === "Transfer In" && amount > 0) {
        const prev = affiliateTransferInTotals.get(affiliateId) || 0;
        affiliateTransferInTotals.set(affiliateId, prev + amount);

        if (referredUser && !isSelfReferral) {
          // Check if transaction is within first month of referral
          const referralDate = new Date(referredUser.created_at);
          const txnDate = dateTxn ? new Date(dateTxn) : new Date();
          const oneMonthAfterReferral = new Date(referralDate);
          oneMonthAfterReferral.setMonth(oneMonthAfterReferral.getMonth() + 1);

          const isWithinFirstMonth = txnDate <= oneMonthAfterReferral;

          if (isWithinFirstMonth) {
            // Track for earning creation
            eligibleEarnings.push({
              referredUserId: referredUser.id,
              affiliateId,
              amount,
              date: dateTxn,
              currentStatusSlug: referredUser.status_slug,
              airtableRecordId: record.id,
            });
          }

          // Track first-transaction update (for setting first_transaction_at)
          if (!referredUser.first_transaction_at) {
            const alreadyQueued = firstTxnUpdates.some(
              (u) => u.referredUserId === referredUser!.id,
            );
            if (!alreadyQueued) {
              firstTxnUpdates.push({
                referredUserId: referredUser.id,
                affiliateId,
                amount,
                date: dateTxn,
                currentStatusSlug: referredUser.status_slug,
              });
            }
          }
        }
      }
    }

    // Step 5: Batch upsert transactions
    let upserted = 0;
    const upsertErrors: string[] = [];

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (db as any)
        .from("transactions")
        .upsert(batch, { onConflict: "airtable_record_id" });

      if (error) {
        upsertErrors.push(error.message);
      } else {
        upserted += batch.length;
      }
    }

    // Step 6: Update affiliate volume totals from ALL Transfer In transactions
    let volumeUpdated = 0;
    let tierUpgrades = 0;

    for (const affiliateId of affiliateTransferInTotals.keys()) {
      // Sum all Transfer In amounts from the transactions table for this affiliate
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: txnData } = await (db as any)
        .from("transactions")
        .select("amount")
        .eq("affiliate_id", affiliateId)
        .eq("transaction_type", "Transfer In");

      const totalVolume = (txnData || []).reduce(
        (sum: number, t: { amount: number }) => sum + Number(t.amount),
        0,
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (db as any)
        .from("affiliates")
        .update({ referred_volume_total: totalVolume })
        .eq("id", affiliateId);

      if (!error) volumeUpdated++;

      // Check tier upgrade: volume >= $100K, currently gold, not overridden
      const aff = affiliateById.get(affiliateId);
      if (
        aff &&
        totalVolume >= TIER_THRESHOLDS.platinum &&
        aff.tier === "gold" &&
        !aff.tier_override
      ) {
        const newTier = getTierForVolume(totalVolume);
        if (newTier === "platinum") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: tierError } = await (db as any)
            .from("affiliates")
            .update({ tier: "platinum" })
            .eq("id", affiliateId);

          if (!tierError) {
            tierUpgrades++;
            // Create notification for tier upgrade
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (db as any).from("notifications").insert({
              affiliate_id: affiliateId,
              type: "tier_upgrade",
              title: "Congratulations! You've been upgraded to Platinum!",
              body: `Your referred transaction volume has reached $${Math.round(totalVolume).toLocaleString()}, qualifying you for Platinum tier with 10% commission rates.`,
            });
          }
        }
      }
    }

    // Step 7: Handle first-transaction updates for referred_users
    let firstTxnProcessed = 0;
    let earningsCreated = 0;
    let funnelEventsCreated = 0;

    for (const update of firstTxnUpdates) {
      const kashuFee = calculateKashuFee(update.amount); // 8.5% of TPV

      // Update referred_user with first transaction info
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updatePayload: Record<string, unknown> = {
        first_transaction_amount: update.amount,
        first_transaction_fee: kashuFee,
        first_transaction_at: update.date || new Date().toISOString(),
      };

      // Advance to transaction_run if currently before it
      const currentIdx = stageIndex(update.currentStatusSlug);
      const txnRunIdx = stageIndex("transaction_run");
      const shouldAdvance = currentIdx >= 0 && currentIdx < txnRunIdx;

      if (shouldAdvance) {
        updatePayload.status_slug = "transaction_run";
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateError } = await (db as any)
        .from("referred_users")
        .update(updatePayload)
        .eq("id", update.referredUserId);

      if (!updateError) {
        firstTxnProcessed++;

        // Create funnel event if stage advanced
        if (shouldAdvance) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: funnelError } = await (db as any)
            .from("funnel_events")
            .insert({
              referred_user_id: update.referredUserId,
              from_status: update.currentStatusSlug,
              to_status: "transaction_run",
            });
          if (!funnelError) funnelEventsCreated++;
        }

      }
    }

    // Step 8b: Create earnings for all eligible transactions (first month of referral)
    // Use airtable_record_id as dedup key to avoid duplicate earnings per transaction
    for (const eligible of eligibleEarnings) {
      const txnRef = eligible.airtableRecordId;

      // Check if earning already exists for this specific transaction
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existingEarning } = await (db as any)
        .from("earnings")
        .select("id")
        .eq("transaction_ref", txnRef)
        .limit(1);

      if (existingEarning && existingEarning.length > 0) continue;

      const aff = affiliateById.get(eligible.affiliateId);
      const tier: AffiliateTier = aff?.tier || "gold";
      const earningAmount = calculateEarning(eligible.amount, tier);
      const kashuFeeForEarning = calculateKashuFee(eligible.amount);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: earningError } = await (db as any)
        .from("earnings")
        .insert({
          affiliate_id: eligible.affiliateId,
          referred_user_id: eligible.referredUserId,
          amount: earningAmount,
          transaction_fee_amount: kashuFeeForEarning,
          tier_at_earning: tier,
          transaction_ref: txnRef,
          status: "pending",
        });

      if (!earningError) earningsCreated++;
    }

    return NextResponse.json({
      success: true,
      total_fetched: records.length,
      matched: rows.length,
      skipped_no_referrer: skippedNoReferrer,
      skipped_no_match: skippedNoMatch,
      skipped_not_transfer_in: skippedNotTransferIn,
      skipped_self_referral: skippedSelfReferral,
      unmatched_referrers: unmatchedReferrers.length > 0 ? unmatchedReferrers : undefined,
      upserted,
      volume_updated: volumeUpdated,
      tier_upgrades: tierUpgrades,
      first_txn_processed: firstTxnProcessed,
      funnel_events_created: funnelEventsCreated,
      earnings_created: earningsCreated,
      errors: upsertErrors.length > 0 ? upsertErrors : undefined,
      api_calls: apiCalls,
    });
  } catch (err) {
    console.error("[sync/transactions] Sync failed:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
