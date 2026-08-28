/**
 * GET /api/cron/sync-airtable
 *
 * Cron endpoint that runs all sync operations in sequence:
 * 1. Affiliates sync (must run first — users depend on affiliate lookup)
 * 2. Referred users sync (Airtable Launch List)
 * 3. HighLevel User Pipeline sync
 * 4. Transactions sync
 *
 * Validates CRON_SECRET before processing.
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Internal base URL for calling sibling sync routes.
// Prefer APP_URL (public custom domain) over VERCEL_URL — the per-deployment
// `*.vercel.app` host is gated by SSO protection, so internal fetches to it
// hit an auth wall.
function getBaseUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
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
  // Steps 3 and 4 continue on failure, but a failure must still be VISIBLE:
  // returning 200 here is how a dead HighLevel sync went unnoticed for months.
  const failedSteps: string[] = [];

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
      // Non-fatal for the run, but recorded so the cron reports failure.
      console.error("[cron/sync-airtable] HighLevel sync failed:", highlevelData);
      failedSteps.push("highlevel");
    }

    // Step 4: Sync transactions
    const transactionsRes = await fetch(`${baseUrl}/api/sync/transactions`, {
      cache: "no-store",
    });
    const transactionsData = await transactionsRes.json();
    results.transactions = transactionsData;

    if (!transactionsRes.ok) {
      // Non-fatal for the run, but recorded so the cron reports failure.
      console.error("[cron/sync-airtable] Transactions sync failed:", transactionsData);
      failedSteps.push("transactions");
    }

    if (failedSteps.length > 0) {
      // Non-2xx so the failure surfaces in Vercel cron monitoring instead of
      // being buried in logs. Earlier steps already committed their work.
      return NextResponse.json(
        { success: false, failed_steps: failedSteps, ...results },
        { status: 500 },
      );
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
