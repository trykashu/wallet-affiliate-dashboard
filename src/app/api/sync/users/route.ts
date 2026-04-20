/**
 * GET /api/sync/users
 *
 * Fetches all records from the Airtable Launch List table and upserts them
 * into the `referred_users` Supabase table.
 *
 * Only syncs records that have a Referrer matching an existing affiliate.
 * Status mapping is best-effort — defaults to "signed_up" if unknown.
 * The key fact is that a user was referred; pipeline status will be
 * refined later by HighLevel sync and transaction sync.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchAllRecords, type AirtableRecord } from "@/lib/airtable";
import type { FunnelStatusSlug } from "@/types/database";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 50;

const STATUS_MAP: Record<string, FunnelStatusSlug> = {
  Waitlist: "waitlist",
  "Booked Call": "booked_call",
  "Sent Onboarding": "sent_onboarding",
  "Signed Up": "signed_up",
  "Run Volume": "transaction_run",
};

const DEFAULT_STATUS: FunnelStatusSlug = "signed_up";

/** Extract first value from a lookup array field, or return as string. */
function extractLookup(val: unknown): string | null {
  if (Array.isArray(val)) return val[0]?.toString() || null;
  if (typeof val === "string" && val.length > 0) return val;
  return null;
}

interface UserRow {
  wallet_user_id: string;
  affiliate_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status_slug: FunnelStatusSlug;
  created_at?: string;
}

function buildUserRow(
  rec: AirtableRecord,
  affiliateLookup: Record<string, string>,
): UserRow | null {
  const f = rec.fields;

  // Referrer is a lookup field (array) — extract first value
  const referrer = extractLookup(f["Referrer"]);
  if (!referrer) return null;

  // Match referrer to affiliate by attribution_id
  const affiliateId = affiliateLookup[referrer];
  if (!affiliateId) return null;

  // Use Contact ID as the upsert key, fall back to Airtable record ID
  const walletUserId = (f["Contact ID"] as string) || rec.id;

  // Best-effort status mapping — default to signed_up if unknown
  const statusRaw = (f["Status"] as string) || null;
  const statusSlug = statusRaw ? (STATUS_MAP[statusRaw] ?? DEFAULT_STATUS) : DEFAULT_STATUS;

  const row: UserRow = {
    wallet_user_id: walletUserId,
    affiliate_id: affiliateId,
    full_name: (f["Client Name"] as string) || null,
    email: extractLookup(f["Email"]) || (f["Email"] as string) || null,
    phone: (f["Phone"] as string) || null,
    status_slug: statusSlug,
  };

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

    // Build rows — only records with a valid Referrer matching an affiliate
    const rows: UserRow[] = [];
    let skippedNoReferrer = 0;
    let skippedNoMatch = 0;
    const unmatchedReferrers: string[] = [];

    for (const rec of records) {
      const referrer = extractLookup(rec.fields["Referrer"]);
      if (!referrer) {
        skippedNoReferrer++;
        continue;
      }

      const row = buildUserRow(rec, affiliateLookup);
      if (row) {
        rows.push(row);
      } else {
        skippedNoMatch++;
        if (!unmatchedReferrers.includes(referrer)) {
          unmatchedReferrers.push(referrer);
        }
      }
    }

    // Load existing referred_users for change detection
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

    // Batch upsert
    let upserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (db as any)
        .from("referred_users")
        .upsert(batch, { onConflict: "wallet_user_id" });

      if (!error) upserted += batch.length;
    }

    // Re-fetch IDs for funnel events
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

    // Log funnel events for new records and stage changes
    const funnelEvents: Record<string, unknown>[] = [];
    for (const row of rows) {
      const existing = existingLookup[row.wallet_user_id];
      const referredUserId = upsertedLookup[row.wallet_user_id];
      if (!referredUserId) continue;

      if (!existing) {
        funnelEvents.push({
          referred_user_id: referredUserId,
          from_status: null,
          to_status: row.status_slug,
        });
      } else if (existing.status_slug !== row.status_slug) {
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

    return NextResponse.json({
      success: true,
      total_fetched: records.length,
      with_referrer: rows.length + skippedNoMatch,
      matched: rows.length,
      skipped_no_referrer: skippedNoReferrer,
      skipped_no_match: skippedNoMatch,
      unmatched_referrers: unmatchedReferrers.length > 0 ? unmatchedReferrers : undefined,
      upserted,
      funnel_events_created: funnelEventsCreated,
      api_calls: apiCalls,
    });
  } catch (err) {
    console.error("[sync/users] Sync failed:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
