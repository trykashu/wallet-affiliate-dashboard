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

    // Batch upsert
    const db = createServiceClient();
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

    return NextResponse.json({
      success: true,
      total_fetched: records.length,
      upserted,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
      api_calls: apiCalls,
    });
  } catch (err) {
    console.error("[sync/affiliates] Sync failed:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
