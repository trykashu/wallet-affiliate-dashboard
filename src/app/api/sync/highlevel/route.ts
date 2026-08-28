/**
 * GET /api/sync/highlevel
 *
 * Fetches all opportunities from the HighLevel User Pipeline, filters for
 * those with the "Referrer" custom field populated, matches them to affiliates
 * by attribution_id, and upserts referred_users.
 *
 * NOTE: attribution lives in the "Referrer" field, which holds the affiliate's
 * attribution_id (e.g. "8RWS4OA2IRDmp4"). Do NOT use "MFC Affiliate"
 * (bY9JdohKL671KIoECxTV) — it holds free-text business names that match no
 * attribution_id, and is not a reliable attribution source.
 *
 * Also logs funnel events for stage transitions and creates earnings
 * for users at transaction_run stage or later.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { calculateEarning, calculateKashuFee } from "@/lib/tier";
import { preserveAdvancedStage, GHL_STAGE_MAP } from "@/lib/funnel-stage";
import type { FunnelStatusSlug, AffiliateTier } from "@/types/database";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 50;
/** Opportunity custom field "Referrer" — holds the affiliate attribution_id. */
const REFERRER_FIELD_ID = "MM9Q4dVku39BJD3rY3MB";
const PIPELINE_ID = "zNiCun5Y5koEsWmN9bDo";
const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";
const PAGE_LIMIT = 100;


// Stages at or after transaction_run (eligible for earnings)
const EARNING_ELIGIBLE_STAGES: Set<FunnelStatusSlug> = new Set([
  "transaction_run",
  "funds_in_wallet",
  "ach_initiated",
  "funds_in_bank",
]);

interface GHLCustomField {
  id: string;
  fieldValueString?: string;
}

interface GHLContact {
  id: string;
  name: string;
  email?: string;
  phone?: string;
}

interface GHLOpportunity {
  id: string;
  name: string;
  monetaryValue?: number;
  pipelineStageId: string;
  status: string;
  createdAt: string;
  contactId: string;
  customFields?: GHLCustomField[];
  contact?: GHLContact;
}

interface GHLSearchResponse {
  opportunities: GHLOpportunity[];
  meta: {
    total: number;
    nextPageUrl?: string;
    startAfterId?: string;
    startAfter?: number;
    nextPage?: number;
  };
}

/** Fetch all opportunities from the HighLevel pipeline, paginating through results. */
async function fetchAllOpportunities(
  apiKey: string,
  locationId: string,
): Promise<{ opportunities: GHLOpportunity[]; apiCalls: number }> {
  const opportunities: GHLOpportunity[] = [];
  let apiCalls = 0;
  let startAfter: number | undefined;
  let startAfterId: string | undefined;

  while (true) {
    let url = `${GHL_BASE_URL}/opportunities/search?location_id=${locationId}&pipeline_id=${PIPELINE_ID}&limit=${PAGE_LIMIT}`;
    if (startAfter !== undefined && startAfterId) {
      url += `&startAfter=${startAfter}&startAfterId=${startAfterId}`;
    }

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: GHL_API_VERSION,
      },
      cache: "no-store",
    });
    apiCalls++;

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GHL API error ${res.status}: ${text}`);
    }

    const data: GHLSearchResponse = await res.json();
    opportunities.push(...data.opportunities);

    // Check if there are more pages
    if (data.meta.startAfter && data.meta.startAfterId && data.opportunities.length === PAGE_LIMIT) {
      startAfter = data.meta.startAfter;
      startAfterId = data.meta.startAfterId;
    } else {
      break;
    }
  }

  return { opportunities, apiCalls };
}

/** Extract the Referrer (affiliate attribution_id) from an opportunity. */
function getReferrerCode(opp: GHLOpportunity): string | null {
  if (!opp.customFields) return null;
  const field = opp.customFields.find((f) => f.id === REFERRER_FIELD_ID);
  return field?.fieldValueString?.trim() || null;
}

export async function GET() {
  const apiKey = process.env.HIGHLEVEL_API_KEY;
  const locationId = process.env.HIGHLEVEL_LOCATION_ID;

  if (!apiKey || !locationId) {
    return NextResponse.json(
      { error: "HIGHLEVEL_API_KEY or HIGHLEVEL_LOCATION_ID not configured" },
      { status: 500 },
    );
  }

  try {
    // Step 1: Fetch all opportunities from GHL
    const { opportunities, apiCalls } = await fetchAllOpportunities(apiKey, locationId);

    // Step 2: Filter for opportunities with a Referrer code populated
    const withAffiliate: { opp: GHLOpportunity; referrerCode: string }[] = [];
    for (const opp of opportunities) {
      const code = getReferrerCode(opp);
      if (code) {
        withAffiliate.push({ opp, referrerCode: code });
      }
    }

    // Step 3: Load all affiliates for matching
    const db = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: affiliates } = await (db as any)
      .from("affiliates")
      .select("id, attribution_id, tier");

    // attribution_id → affiliate. Keyed case-insensitively so a transcription
    // variant still resolves; codes are otherwise matched verbatim.
    const affiliatesByCode = new Map<string, { id: string; tier: AffiliateTier }>();
    for (const a of affiliates || []) {
      if (a.attribution_id) {
        affiliatesByCode.set(a.attribution_id.trim().toLowerCase(), { id: a.id, tier: a.tier });
      }
    }

    // Step 4: Match opportunities to affiliates and build rows
    interface UserRow {
      wallet_user_id: string;
      affiliate_id: string;
      full_name: string;
      email: string;
      phone: string | null;
      status_slug: FunnelStatusSlug;
      first_transaction_amount: number | null;
      first_transaction_fee: number | null;
      first_transaction_at: string | null;
      created_at?: string;
    }

    const rows: UserRow[] = [];
    const affiliateTiers: Record<string, AffiliateTier> = {};
    let unmatched = 0;
    const unmatchedNames: string[] = [];
    let unmappedStages = 0;
    const unmappedStageIds: string[] = [];

    for (const { opp, referrerCode } of withAffiliate) {
      const match = affiliatesByCode.get(referrerCode.toLowerCase());

      if (!match) {
        unmatched++;
        if (!unmatchedNames.includes(referrerCode)) {
          unmatchedNames.push(referrerCode);
        }
        continue;
      }

      const stageSlug = GHL_STAGE_MAP[opp.pipelineStageId];
      if (!stageSlug) {
        // A stage with no mapping silently discards an attributed referral —
        // surface it instead of dropping it on the floor.
        unmappedStages++;
        if (!unmappedStageIds.includes(opp.pipelineStageId)) {
          unmappedStageIds.push(opp.pipelineStageId);
        }
        continue;
      }

      const contactId = opp.contact?.id || opp.contactId;
      const contactName = opp.contact?.name || opp.name;
      const contactEmail = opp.contact?.email || "";

      if (!contactId || !contactEmail) continue;

      const isEarningEligible = EARNING_ELIGIBLE_STAGES.has(stageSlug);
      const monetaryValue = opp.monetaryValue || null;

      affiliateTiers[match.id] = match.tier;

      rows.push({
        wallet_user_id: contactId,
        affiliate_id: match.id,
        full_name: contactName,
        email: contactEmail,
        phone: opp.contact?.phone || null,
        status_slug: stageSlug,
        first_transaction_amount: isEarningEligible && monetaryValue ? monetaryValue : null,
        first_transaction_fee: isEarningEligible && monetaryValue ? calculateKashuFee(monetaryValue) : null,
        first_transaction_at: isEarningEligible && monetaryValue ? new Date().toISOString() : null,
        created_at: opp.createdAt,
      });
    }

    // Step 5: Load existing referred_users for change detection
    const walletIds = rows.map((r) => r.wallet_user_id);
    const existingLookup: Record<string, {
      id: string;
      status_slug: string;
      first_transaction_amount: number | null;
    }> = {};

    for (let i = 0; i < walletIds.length; i += BATCH_SIZE) {
      const batch = walletIds.slice(i, i + BATCH_SIZE);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existing } = await (db as any)
        .from("referred_users")
        .select("id, wallet_user_id, status_slug, first_transaction_amount")
        .in("wallet_user_id", batch);

      for (const row of existing || []) {
        existingLookup[row.wallet_user_id] = {
          id: row.id,
          status_slug: row.status_slug,
          first_transaction_amount: row.first_transaction_amount,
        };
      }
    }

    // Protect against status_slug regression: if the existing row indicates
    // this user has transacted (or is already past transaction_run), do not
    // downgrade them with the CRM-derived stage.
    for (const row of rows) {
      const existing = existingLookup[row.wallet_user_id];
      row.status_slug = preserveAdvancedStage(row.status_slug, existing);
    }

    // Step 6: Batch upsert referred_users
    let upserted = 0;
    const upsertErrors: string[] = [];

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (db as any)
        .from("referred_users")
        .upsert(batch, { onConflict: "wallet_user_id" });

      if (error) {
        upsertErrors.push(error.message);
      } else {
        upserted += batch.length;
      }
    }

    // Step 7: Re-fetch to get IDs for funnel events and earnings
    const upsertedLookup: Record<string, string> = {};
    for (let i = 0; i < walletIds.length; i += BATCH_SIZE) {
      const batch = walletIds.slice(i, i + BATCH_SIZE);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: fresh } = await (db as any)
        .from("referred_users")
        .select("id, wallet_user_id")
        .in("wallet_user_id", batch);

      for (const row of fresh || []) {
        upsertedLookup[row.wallet_user_id] = row.id;
      }
    }

    // Step 8: Log funnel events for stage transitions
    const funnelEvents: Record<string, unknown>[] = [];
    for (const row of rows) {
      const existing = existingLookup[row.wallet_user_id];
      const referredUserId = upsertedLookup[row.wallet_user_id];
      if (!referredUserId) continue;

      if (!existing) {
        // New record — log initial stage
        funnelEvents.push({
          referred_user_id: referredUserId,
          from_status: null,
          to_status: row.status_slug,
        });
      } else if (existing.status_slug !== row.status_slug) {
        // Stage changed — log transition
        funnelEvents.push({
          referred_user_id: referredUserId,
          from_status: existing.status_slug,
          to_status: row.status_slug,
        });
      }
    }

    let funnelEventsCreated = 0;
    for (let i = 0; i < funnelEvents.length; i += BATCH_SIZE) {
      const batch = funnelEvents.slice(i, i + BATCH_SIZE);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (db as any).from("funnel_events").insert(batch);
      if (!error) funnelEventsCreated += batch.length;
    }

    // Step 9: Create earnings for records at transaction_run or later
    let earningsCreated = 0;
    for (const row of rows) {
      if (!EARNING_ELIGIBLE_STAGES.has(row.status_slug)) continue;
      if (!row.first_transaction_amount || row.first_transaction_amount <= 0) continue;

      const referredUserId = upsertedLookup[row.wallet_user_id];
      if (!referredUserId) continue;

      // Check if earning already exists for this referred_user
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existingEarning } = await (db as any)
        .from("earnings")
        .select("id")
        .eq("referred_user_id", referredUserId)
        .limit(1);

      if (existingEarning && existingEarning.length > 0) continue;

      const tier = affiliateTiers[row.affiliate_id] || "gold";
      const tpv = row.first_transaction_amount!;
      const kashuFee = calculateKashuFee(tpv);
      const earningAmount = calculateEarning(tpv, tier);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (db as any).from("earnings").insert({
        affiliate_id: row.affiliate_id,
        referred_user_id: referredUserId,
        amount: earningAmount,
        transaction_fee_amount: kashuFee,
        tier_at_earning: tier,
        status: "pending",
      });

      if (!error) earningsCreated++;
    }

    return NextResponse.json({
      success: true,
      total_fetched: opportunities.length,
      with_referrer: withAffiliate.length,
      matched_to_affiliate: rows.length,
      unmatched,
      unmatched_codes: unmatchedNames.length > 0 ? unmatchedNames : undefined,
      skipped_unmapped_stage: unmappedStages > 0 ? unmappedStages : undefined,
      unmapped_stage_ids: unmappedStageIds.length > 0 ? unmappedStageIds : undefined,
      upserted,
      funnel_events_created: funnelEventsCreated,
      earnings_created: earningsCreated,
      errors: upsertErrors.length > 0 ? upsertErrors : undefined,
      api_calls: apiCalls,
    });
  } catch (err) {
    console.error("[sync/highlevel] Sync failed:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
