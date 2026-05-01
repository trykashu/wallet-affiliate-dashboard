/**
 * GET /api/sync/affiliates
 *
 * Fetches all records from the Airtable Affiliate Hub (Kashu Affiliates table)
 * and upserts them into the `affiliates` Supabase table.
 *
 * Field mapping:
 *   Attribution ID       → attribution_id (upsert key)
 *   Agent Name           → agent_name
 *   Business Name        → business_name
 *   Agent Email          → email
 *   Agent Phone Number   → phone
 *   Agreement Status     → agreement_status
 *   Affiliate Tier       → tier (mapped to gold/platinum)
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchAllRecords, type AirtableRecord } from "@/lib/airtable";
import { processPendingBankDetails } from "@/lib/process-pending-bank-details";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 50;

const TIER_MAP: Record<string, string> = {
  "Gold Tier - T2": "gold",
  "Platinum Tier - T1": "platinum",
};

function mapTier(raw: unknown): "gold" | "platinum" {
  if (typeof raw === "string" && TIER_MAP[raw]) {
    return TIER_MAP[raw] as "gold" | "platinum";
  }
  return "gold";
}

function buildAffiliateRow(rec: AirtableRecord): Record<string, unknown> | null {
  const f = rec.fields;
  const attributionId = f["Attribution ID"] as string | undefined;
  if (!attributionId) return null;

  const email = (f["Agent Email"] as string) || null;
  if (!email) return null;

  return {
    attribution_id: attributionId,
    agent_name: (f["Agent Name"] as string) || "Unknown",
    business_name: (f["Business Name"] as string) || null,
    email,
    phone: (f["Agent Phone Number"] as string) || null,
    agreement_status: (f["Agreement Status"] as string) || null,
    tier: mapTier(f["Affiliate Tier"]),
    status: "active",
  };
}

export async function GET() {
  const baseId = process.env.AIRTABLE_AFFILIATE_BASE;
  const tableId = process.env.AIRTABLE_AFFILIATE_TABLE;

  if (!baseId || !tableId) {
    return NextResponse.json(
      { error: "AIRTABLE_AFFILIATE_BASE or AIRTABLE_AFFILIATE_TABLE not configured" },
      { status: 500 },
    );
  }

  try {
    const { records, apiCalls } = await fetchAllRecords(baseId, tableId);

    // Build rows, filtering out invalid records
    const rows: Record<string, unknown>[] = [];
    let skipped = 0;
    for (const rec of records) {
      const row = buildAffiliateRow(rec);
      if (row) {
        rows.push(row);
      } else {
        skipped++;
      }
    }

    const db = createServiceClient();

    // Pre-load existing affiliates for collision + orphan checks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingRaw } = await (db as any)
      .from("affiliates")
      .select("id, attribution_id, email, agent_name, business_name, user_id, last_login_at, status");

    interface ExistingRow {
      id: string;
      attribution_id: string;
      email: string | null;
      agent_name: string | null;
      business_name: string | null;
      user_id: string | null;
      last_login_at: string | null;
      status: string;
    }
    const existing: ExistingRow[] = (existingRaw ?? []) as ExistingRow[];
    const existingByAttribution = new Map(existing.map((e) => [e.attribution_id, e]));
    const existingByEmail = new Map<string, ExistingRow>();
    for (const e of existing) {
      if (e.email) existingByEmail.set(e.email.toLowerCase(), e);
    }

    // Email collisions: incoming row's email is already attached to a different
    // attribution_id. Strong signal that someone duplicated an Airtable record
    // instead of editing it (the Daniel Dixon Jr scenario).
    interface Collision {
      email: string;
      incoming_attribution_id: string;
      existing_attribution_id: string;
      existing_affiliate_id: string;
      existing_user_id: string | null;
      existing_has_login: boolean;
    }
    const emailCollisions: Collision[] = [];
    for (const row of rows) {
      const email = String(row.email || "").toLowerCase();
      const incomingAttr = String(row.attribution_id);
      if (!email) continue;
      const match = existingByEmail.get(email);
      if (match && match.attribution_id !== incomingAttr) {
        emailCollisions.push({
          email,
          incoming_attribution_id: incomingAttr,
          existing_attribution_id: match.attribution_id,
          existing_affiliate_id: match.id,
          existing_user_id: match.user_id,
          existing_has_login: !!match.last_login_at,
        });
      }
    }

    // Orphans: affiliates in DB whose attribution_id no longer appears in
    // Airtable. The source of truth has dropped them.
    const incomingAttributionIds = new Set(rows.map((r) => String(r.attribution_id)));
    const orphans = existing
      .filter((e) => !incomingAttributionIds.has(e.attribution_id))
      .map((e) => ({
        affiliate_id: e.id,
        attribution_id: e.attribution_id,
        agent_name: e.agent_name,
        business_name: e.business_name,
        email: e.email,
        status: e.status,
        ever_logged_in: !!e.last_login_at,
        has_user: !!e.user_id,
      }));

    // Batch upsert
    let upserted = 0;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (db as any)
        .from("affiliates")
        .upsert(batch, { onConflict: "attribution_id" });

      if (error) {
        errors.push(error.message);
      } else {
        upserted += batch.length;
      }
    }

    // Process any queued bank details from PandaDoc
    const pendingResult = await processPendingBankDetails(db);

    return NextResponse.json({
      success: true,
      total_fetched: records.length,
      upserted,
      skipped,
      email_collisions: emailCollisions.length > 0 ? emailCollisions : undefined,
      orphans: orphans.length > 0 ? orphans : undefined,
      errors: errors.length > 0 ? errors : undefined,
      api_calls: apiCalls,
      pending_bank_details: pendingResult,
    });
  } catch (err) {
    console.error("[sync/affiliates] Sync failed:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
