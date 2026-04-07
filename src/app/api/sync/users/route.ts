/**
 * GET /api/sync/users
 *
 * Fetches all records from the Airtable Launch List table and upserts them
 * into the `referred_users` Supabase table.
 *
 * Field mapping:
 *   Referrer                     → match affiliates.attribution_id → affiliate_id
 *   Client Name                  → full_name
 *   Email                        → email
 *   Phone                        → phone
 *   Status                       → status_slug (mapped)
 *   Estimated Amount             → first_transaction_amount
 *   Official Amount Liquidated   → first_transaction_fee
 *   Contact ID                   → wallet_user_id (upsert key; falls back to Airtable record ID)
 *   Date Added                   → created_at
 *
 * Only syncs records that have a Referrer matching an existing affiliate.
 * Creates earnings for records with Official Amount Liquidated > 0.
 * Logs funnel events for stage transitions.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchAllRecords, type AirtableRecord } from "@/lib/airtable";
import type { FunnelStatusSlug } from "@/types/database";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 50;

const STATUS_MAP: Record<string, FunnelStatusSlug> = {
  "Sent Onboarding": "signed_up",
  "Run Volume": "transaction_run",
  "Booked Call": "signed_up",
};

function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number" && isFinite(raw) && raw >= 0) return raw;
  if (typeof raw === "string") {
    const n = parseFloat(raw);
    if (isFinite(n) && n >= 0) return n;
  }
  return null;
}

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

function buildUserRow(
  rec: AirtableRecord,
  affiliateLookup: Record<string, string>,
): UserRow | null {
  const f = rec.fields;

  // Must have a Referrer that matches an affiliate
  const referrer = (f["Referrer"] as string) || null;
  if (!referrer) return null;
  const affiliateId = affiliateLookup[referrer];
  if (!affiliateId) return null;

  const fullName = (f["Client Name"] as string) || null;
  if (!fullName) return null;

  const email = (f["Email"] as string) || null;
  if (!email) return null;

  const statusRaw = (f["Status"] as string) || null;
  const statusSlug = statusRaw ? STATUS_MAP[statusRaw] : undefined;
  if (!statusSlug) return null;

  const walletUserId = (f["Contact ID"] as string) || rec.id;

  const transactionAmount = parseAmount(f["Estimated Amount"]);
  const transactionFee = parseAmount(f["Official Amount Liquidated"]);

  const row: UserRow = {
    wallet_user_id: walletUserId,
    affiliate_id: affiliateId,
    full_name: fullName,
    email,
    phone: (f["Phone"] as string) || null,
    status_slug: statusSlug,
    first_transaction_amount: transactionAmount,
    first_transaction_fee: transactionFee,
    first_transaction_at:
      transactionFee && transactionFee > 0 ? new Date().toISOString() : null,
  };

  // Preserve original created_at from Airtable
  const dateAdded = f["Date Added"] as string | undefined;
  if (dateAdded) {
    row.created_at = new Date(dateAdded).toISOString();
  }

  return row;
}

export async function GET() {
  const baseId = process.env.AIRTABLE_LAUNCH_BASE;
  const tableId = process.env.AIRTABLE_LAUNCH_TABLE;

  if (!baseId || !tableId) {
    return NextResponse.json(
      { error: "AIRTABLE_LAUNCH_BASE or AIRTABLE_LAUNCH_TABLE not configured" },
      { status: 500 },
    );
  }

  try {
    // Fetch all records from Airtable
    const { records, apiCalls } = await fetchAllRecords(baseId, tableId);

    // Build affiliate lookup: attribution_id → affiliate UUID
    const db = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: affiliates } = await (db as any)
      .from("affiliates")
      .select("id, attribution_id");

    const affiliateLookup: Record<string, string> = {};
    for (const a of affiliates || []) {
      if (a.attribution_id) affiliateLookup[a.attribution_id] = a.id;
    }

    // Build rows
    const rows: UserRow[] = [];
    let skipped = 0;
    for (const rec of records) {
      const row = buildUserRow(rec, affiliateLookup);
      if (row) {
        rows.push(row);
      } else {
        skipped++;
      }
    }

    // Load existing referred_users for change detection (funnel events)
    const walletIds = rows.map((r) => r.wallet_user_id);
    const existingLookup: Record<string, { id: string; status_slug: string }> = {};

    for (let i = 0; i < walletIds.length; i += BATCH_SIZE) {
      const batch = walletIds.slice(i, i + BATCH_SIZE);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existing } = await (db as any)
        .from("referred_users")
        .select("id, wallet_user_id, status_slug")
        .in("wallet_user_id", batch);

      for (const row of existing || []) {
        existingLookup[row.wallet_user_id] = {
          id: row.id,
          status_slug: row.status_slug,
        };
      }
    }

    // Batch upsert referred_users
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

    // After upsert, re-fetch to get IDs for funnel events and earnings
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

    // Log funnel events for stage transitions
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

    // Create earnings for records with Official Amount Liquidated > 0
    let earningsCreated = 0;
    for (const row of rows) {
      if (!row.first_transaction_fee || row.first_transaction_fee <= 0) continue;

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

      // Look up affiliate tier for commission calculation
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: affiliate } = await (db as any)
        .from("affiliates")
        .select("tier")
        .eq("id", row.affiliate_id)
        .single();

      const tier = affiliate?.tier || "gold";

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (db as any).from("earnings").insert({
        affiliate_id: row.affiliate_id,
        referred_user_id: referredUserId,
        amount: row.first_transaction_fee,
        transaction_fee_amount: row.first_transaction_fee,
        tier_at_earning: tier,
        status: "pending",
      });

      if (!error) earningsCreated++;
    }

    return NextResponse.json({
      success: true,
      total_fetched: records.length,
      upserted,
      skipped,
      funnel_events_created: funnelEventsCreated,
      earnings_created: earningsCreated,
      errors: upsertErrors.length > 0 ? upsertErrors : undefined,
      api_calls: apiCalls,
    });
  } catch (err) {
    console.error("[sync/users] Sync failed:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
