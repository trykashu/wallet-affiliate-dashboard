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
import { calculateEarningFromFee, resolveCollectedFee, getTierForVolume, TIER_THRESHOLDS } from "@/lib/tier";
import { dedupAirtableTransactions, decideEarningAction } from "@/lib/sync/anneal-transactions";
import { buildResolverIndex, resolveReferredUser } from "@/lib/sync/referred-user-match";
import type { AffiliateTier, FunnelStatusSlug } from "@/types/database";

export const dynamic = "force-dynamic";

const AIRTABLE_TABLE_ID = "tblyWtDBeiZAqDm8P";
const LAUNCH_LIST_TABLE_ID = "tblV03MwocMeq3wYl";
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
    const { records: rawRecords, apiCalls } = await fetchAllRecords(baseId, AIRTABLE_TABLE_ID);

    // Step 1b: ANNEAL — collapse Airtable-side duplicates sharing the same
    // wallet `Transaction ID` to a single canonical record (oldest wins).
    // Loser airtable_record_ids will be reconciled later: their earnings get
    // migrated to (or deleted in favor of) the canonical, and the loser local
    // rows are hard-deleted.
    const dedupResult = dedupAirtableTransactions(rawRecords);
    const records = dedupResult.canonical;

    // Step 2: Pre-load all affiliates into lookup maps
    const db = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: affiliates } = await (db as any)
      .from("affiliates")
      .select("id, attribution_id, business_name, agent_name, email, tier, tier_override, referred_volume_total, legacy_volume_adjustment, custom_commission_rate, custom_commission_basis");

    const affiliateById = new Map<string, {
      id: string;
      email: string | null;
      tier: AffiliateTier;
      tier_override: boolean;
      referred_volume_total: number;
      legacy_volume_adjustment: number;
      custom_commission_rate: number | null;
      custom_commission_basis: 'tpv' | 'kashu_fee' | null;
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
        legacy_volume_adjustment: Number(a.legacy_volume_adjustment) || 0,
        custom_commission_rate: a.custom_commission_rate !== null && a.custom_commission_rate !== undefined ? Number(a.custom_commission_rate) : null,
        custom_commission_basis: a.custom_commission_basis ?? null,
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

    // Step 3: Pre-load referred_users and index them by BOTH the stable
    // Contact ID (via the Launch List) and email. Email alone is not a reliable
    // key — see @/lib/sync/referred-user-match.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: referredUsers } = await (db as any)
      .from("referred_users")
      .select("id, email, wallet_user_id, affiliate_id, status_slug, first_transaction_at, created_at");

    const { records: launchListRecords } = await fetchAllRecords(baseId, LAUNCH_LIST_TABLE_ID);
    const resolverIndex = buildResolverIndex(referredUsers || [], launchListRecords);

    // Retained for the legacy self-heal pass further down.
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
    // Airtable record id -> fee Kashu actually collected (Softpoint), with the
    // funnel price as fallback. Commission rides this, never the list price.
    const collectedFeeByRecord = new Map<string, number>();
    let matchedByContactId = 0;
    let matchedByEmail = 0;
    let unresolvedReferredUser = 0;
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
      collectedFee: number;
    }[] = [];
    // Track first-transaction updates for referred_users
    const firstTxnUpdates: {
      referredUserId: string;
      affiliateId: string;
      amount: number;
      date: string | null;
      currentStatusSlug: FunnelStatusSlug;
      firstTxnAlreadyRecorded: boolean;
      collectedFee: number;
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
      collectedFeeByRecord.set(
        record.id,
        resolveCollectedFee(Number(fields["Actual Fee Assessed"]), amount, funnelPercent),
      );

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
      const resolved = resolveReferredUser(
        fields["Launch List Link"] as string[] | undefined,
        email,
        resolverIndex,
      );
      if (resolved.user) {
        referredUserId = resolved.user.id;
        referredUser = resolved.user;
        if (resolved.via === "wallet_id") matchedByContactId++;
        else matchedByEmail++;
      } else if (email || fields["Launch List Link"]) {
        unresolvedReferredUser++;
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

      // Track Transfer In amounts per affiliate for volume update.
      // Self-referrals are explicitly excluded — an affiliate cannot earn
      // commission on their own deposit, and counting self-funded volume
      // would also inflate tier-upgrade thresholds.
      if (transactionType === "Transfer In" && amount > 0 && !isSelfReferral) {
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
              collectedFee: collectedFeeByRecord.get(record.id) ?? 0,
            });
          }

          // Queue an update if either:
          //   - This is the first recorded transaction for this user (set financial fields), OR
          //   - The user's status_slug is currently before transaction_run despite having a
          //     transaction (self-heal a previously regressed user).
          const needsFirstTxnRecord = !referredUser.first_transaction_at;
          const currentIdxForCheck = stageIndex(referredUser.status_slug);
          const txnRunIdxForCheck = stageIndex("transaction_run");
          const needsStageAdvance =
            currentIdxForCheck >= 0 && currentIdxForCheck < txnRunIdxForCheck;

          if (needsFirstTxnRecord || needsStageAdvance) {
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
                firstTxnAlreadyRecorded: !!referredUser.first_transaction_at,
                collectedFee: collectedFeeByRecord.get(record.id) ?? 0,
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

    // Step 5b: ANNEAL — earnings reconciliation for loser airtable_record_ids.
    // For every loser ID, decide whether its earning(s) should be migrated to
    // the canonical, deleted (duplicate of canonical), or flagged (paid).
    const earningsMigrated: string[] = [];
    const earningsDeleted: string[] = [];
    const earningsWarnings: string[] = [];

    if (dedupResult.loserToCanonical.size > 0) {
      const loserIds = Array.from(dedupResult.loserToCanonical.keys());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: orphanEarnings } = await (db as any)
        .from("earnings")
        .select("id, status, transaction_ref, amount, transaction_fee_amount")
        .in("transaction_ref", loserIds);

      for (const e of (orphanEarnings ?? []) as Array<{
        id: string;
        status: string;
        transaction_ref: string;
      }>) {
        const canonicalRef = dedupResult.loserToCanonical.get(e.transaction_ref)!;
        // Check if canonical already has an earning
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existing } = await (db as any)
          .from("earnings")
          .select("id")
          .eq("transaction_ref", canonicalRef)
          .limit(1);
        const canonicalHasEarning = (existing?.length ?? 0) > 0;

        const decision = decideEarningAction(e, canonicalRef, canonicalHasEarning);
        if (decision.action === "migrate") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (db as any)
            .from("earnings")
            .update({ transaction_ref: decision.to })
            .eq("id", e.id);
          earningsMigrated.push(e.id);
        } else if (decision.action === "delete") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (db as any).from("earnings").delete().eq("id", e.id);
          earningsDeleted.push(e.id);
        } else {
          earningsWarnings.push(`${e.id}: ${decision.reason}`);
        }
      }
    }

    // Step 5c: ANNEAL — hard-delete local transactions for losers + any
    // transaction whose airtable_record_id no longer exists upstream.
    const allUpstreamIds = new Set([
      ...records.map((r) => r.id),
      // We do NOT include loser IDs — they're explicitly removed.
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: localTxns } = await (db as any)
      .from("transactions")
      .select("id, airtable_record_id");
    const localById = new Map<string, string>();
    for (const t of (localTxns ?? []) as Array<{ id: string; airtable_record_id: string }>) {
      localById.set(t.airtable_record_id, t.id);
    }
    const toDeleteAirtableIds: string[] = [];
    for (const [airtableId] of localById) {
      if (!allUpstreamIds.has(airtableId)) toDeleteAirtableIds.push(airtableId);
    }

    let transactionsDeleted = 0;
    let cascadedEarningsDeleted = 0;
    // Track affiliate_ids of deleted transactions so we recompute their
    // volume totals below — otherwise affiliates whose every transaction was
    // pruned would keep stale referred_volume_total.
    const affiliatesAffectedByDelete = new Set<string>();
    if (toDeleteAirtableIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: affectedRows } = await (db as any)
        .from("transactions")
        .select("affiliate_id")
        .in("airtable_record_id", toDeleteAirtableIds);
      for (const r of (affectedRows ?? []) as Array<{ affiliate_id: string }>) {
        if (r.affiliate_id) affiliatesAffectedByDelete.add(r.affiliate_id);
      }
      // Cascade-delete pending/approved earnings that referenced any of these.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: cascade } = await (db as any)
        .from("earnings")
        .select("id, status, transaction_ref")
        .in("transaction_ref", toDeleteAirtableIds);
      const toDeleteEarningIds: string[] = [];
      for (const e of (cascade ?? []) as Array<{ id: string; status: string; transaction_ref: string }>) {
        if (e.status === "pending" || e.status === "approved") {
          toDeleteEarningIds.push(e.id);
        } else {
          earningsWarnings.push(
            `${e.id}: status=${e.status}; underlying transaction ${e.transaction_ref} deleted upstream — manual review`,
          );
        }
      }
      if (toDeleteEarningIds.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any).from("earnings").delete().in("id", toDeleteEarningIds);
        cascadedEarningsDeleted = toDeleteEarningIds.length;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: deleted } = await (db as any)
        .from("transactions")
        .delete()
        .in("airtable_record_id", toDeleteAirtableIds)
        .select("id");
      transactionsDeleted = deleted?.length ?? 0;
    }

    // Step 5d: ANNEAL — re-derive earning amounts for pending/approved when
    // the underlying transaction amount has drifted from what was originally
    // recorded. (status='paid' / 'reversed' are immutable.)
    let earningsRederived = 0;
    if (rows.length > 0) {
      const canonicalIds = rows.map((r) => r.airtable_record_id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existingEarnings } = await (db as any)
        .from("earnings")
        .select("id, transaction_ref, amount, transaction_fee_amount, tier_at_earning, custom_commission_rate, custom_commission_basis, status, affiliate_id")
        .in("transaction_ref", canonicalIds)
        .in("status", ["pending", "approved"]);

      const rowByRef = new Map(rows.map((r) => [r.airtable_record_id, r]));
      for (const e of (existingEarnings ?? []) as Array<{
        id: string;
        transaction_ref: string;
        amount: number;
        transaction_fee_amount: number;
        tier_at_earning: AffiliateTier;
        custom_commission_rate: number | null;
        custom_commission_basis: 'tpv' | 'kashu_fee' | null;
        status: string;
        affiliate_id: string;
      }>) {
        const row = rowByRef.get(e.transaction_ref);
        if (!row) continue;
        if (row.amount <= 0 || row.self_referral) continue;

        const expectedKashuFee = collectedFeeByRecord.get(e.transaction_ref) ?? 0;
        if (expectedKashuFee <= 0) continue; // no basis to re-derive against
        const customCommission =
          e.tier_at_earning === "custom" && e.custom_commission_rate !== null && e.custom_commission_basis
            ? { rate: Number(e.custom_commission_rate), basis: e.custom_commission_basis }
            : undefined;
        const expectedAmount = calculateEarningFromFee(
          expectedKashuFee,
          row.amount,
          e.tier_at_earning,
          customCommission,
        );

        const amountDrift = Math.abs(Number(e.amount) - expectedAmount) > 0.005;
        const feeDrift = Math.abs(Number(e.transaction_fee_amount) - expectedKashuFee) > 0.005;
        if (amountDrift || feeDrift) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (db as any)
            .from("earnings")
            .update({ amount: expectedAmount, transaction_fee_amount: expectedKashuFee })
            .eq("id", e.id);
          earningsRederived++;
        }
      }
    }

    // Step 6: Update affiliate volume totals from ALL Transfer In transactions
    let volumeUpdated = 0;
    let tierUpgrades = 0;

    // Union of: affiliates with new/updated upstream txns this cycle, AND
    // affiliates whose transactions were pruned in the deletion pass.
    const affiliatesToRecompute = new Set<string>([
      ...affiliateTransferInTotals.keys(),
      ...affiliatesAffectedByDelete,
    ]);

    for (const affiliateId of affiliatesToRecompute) {
      // Sum all Transfer In amounts from the transactions table for this affiliate
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: txnData } = await (db as any)
        .from("transactions")
        .select("amount")
        .eq("affiliate_id", affiliateId)
        .eq("transaction_type", "Transfer In")
        .eq("self_referral", false);

      const transactionVolume = (txnData || []).reduce(
        (sum: number, t: { amount: number }) => sum + Number(t.amount),
        0,
      );

      // Fold in the durable manual legacy adjustment so it survives the
      // recompute and counts toward the Platinum threshold.
      const legacyAdjustment = affiliateById.get(affiliateId)?.legacy_volume_adjustment ?? 0;
      const totalVolume = transactionVolume + legacyAdjustment;

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
      const updatePayload: Record<string, unknown> = {};

      // Only write financial fields if this is the first recorded transaction.
      // Otherwise we'd clobber the original first-txn metadata with whatever
      // transaction happens to come through the sync at the moment we self-heal.
      if (!update.firstTxnAlreadyRecorded) {
        const kashuFee = update.collectedFee; // fee actually collected
        updatePayload.first_transaction_amount = update.amount;
        updatePayload.first_transaction_fee = kashuFee;
        updatePayload.first_transaction_at = update.date || new Date().toISOString();
      }

      // Advance to transaction_run if currently before it (re-check independently
      // of the financial path — supports self-healing previously regressed users).
      const currentIdx = stageIndex(update.currentStatusSlug);
      const txnRunIdx = stageIndex("transaction_run");
      const shouldAdvance = currentIdx >= 0 && currentIdx < txnRunIdx;

      if (shouldAdvance) {
        updatePayload.status_slug = "transaction_run";
      }

      // Skip the write if nothing to update (paranoia — should be unreachable
      // since the push site requires at least one of the two conditions).
      if (Object.keys(updatePayload).length === 0) continue;

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
      const customCommission =
        tier === "custom" && aff?.custom_commission_rate !== null && aff?.custom_commission_rate !== undefined && aff?.custom_commission_basis
          ? { rate: aff.custom_commission_rate, basis: aff.custom_commission_basis }
          : undefined;
      const kashuFeeForEarning = eligible.collectedFee;
      const earningAmount = calculateEarningFromFee(
        kashuFeeForEarning,
        eligible.amount,
        tier,
        customCommission,
      );

      const earningRow: Record<string, unknown> = {
        affiliate_id: eligible.affiliateId,
        referred_user_id: eligible.referredUserId,
        amount: earningAmount,
        transaction_fee_amount: kashuFeeForEarning,
        tier_at_earning: tier,
        transaction_ref: txnRef,
        status: "pending",
      };
      if (tier === "custom" && customCommission) {
        earningRow.custom_commission_rate = customCommission.rate;
        earningRow.custom_commission_basis = customCommission.basis;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: earningError } = await (db as any)
        .from("earnings")
        .insert(earningRow);

      if (!earningError) earningsCreated++;
    }

    return NextResponse.json({
      success: true,
      total_fetched: rawRecords.length,
      after_dedup: records.length,
      duplicates_collapsed: dedupResult.duplicates.length,
      duplicates: dedupResult.duplicates.length > 0 ? dedupResult.duplicates : undefined,
      transactions_deleted: transactionsDeleted,
      cascaded_earnings_deleted: cascadedEarningsDeleted,
      earnings_migrated: earningsMigrated.length,
      earnings_deleted: earningsDeleted.length,
      earnings_rederived: earningsRederived,
      earnings_warnings: earningsWarnings.length > 0 ? earningsWarnings : undefined,
      matched: rows.length,
      skipped_no_referrer: skippedNoReferrer,
      referred_user_matched_by_contact_id: matchedByContactId,
      referred_user_matched_by_email: matchedByEmail,
      referred_user_unresolved: unresolvedReferredUser,
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
