/**
 * GET /api/cron/sync-airtable
 *
 * Cron endpoint that runs all sync operations in sequence:
 * 1. Affiliates sync (must run first — users depend on affiliate lookup)
 * 2. Referred users sync (Airtable Launch List)
 * 3. HighLevel User Pipeline sync
 *
 * Validates CRON_SECRET before processing.
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Internal base URL for calling sibling sync routes
function getBaseUrl(): string {
  // In Vercel, use the deployment URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.APP_URL) return process.env.APP_URL;
  return "http://localhost:3000";
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = getBaseUrl();
  const results: Record<string, unknown> = {};

  try {
    // Step 1: Sync affiliates first (users depend on affiliate lookup)
    const affiliatesRes = await fetch(`${baseUrl}/api/sync/affiliates`, {
      cache: "no-store",
    });
    const affiliatesData = await affiliatesRes.json();
    results.affiliates = affiliatesData;

    if (!affiliatesRes.ok) {
      return NextResponse.json(
        { error: "Affiliates sync failed", details: affiliatesData },
        { status: 500 },
      );
    }

    // Step 2: Sync referred users
    const usersRes = await fetch(`${baseUrl}/api/sync/users`, {
      cache: "no-store",
    });
    const usersData = await usersRes.json();
    results.users = usersData;

    if (!usersRes.ok) {
      return NextResponse.json(
        { error: "Users sync failed", details: results },
        { status: 500 },
      );
    }

    // Step 3: Sync referred users from HighLevel User Pipeline
    const highlevelRes = await fetch(`${baseUrl}/api/sync/highlevel`, {
      cache: "no-store",
    });
    const highlevelData = await highlevelRes.json();
    results.highlevel = highlevelData;

    if (!highlevelRes.ok) {
      // HighLevel sync failure is non-fatal — log but continue
      console.error("[cron/sync-airtable] HighLevel sync failed:", highlevelData);
    }

    return NextResponse.json({
      success: true,
      ...results,
    });
  } catch (err) {
    console.error("[cron/sync-airtable] Failed:", err);
    return NextResponse.json({ error: "Cron sync failed" }, { status: 500 });
  }
}
