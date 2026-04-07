import { NextRequest, NextResponse } from "next/server";
import { refreshLeaderboard } from "@/lib/refresh-leaderboard";

export const dynamic = "force-dynamic";

/**
 * Cron job endpoint for refreshing leaderboard rankings.
 * Validates CRON_SECRET header before processing.
 *
 * Vercel Cron: configure in vercel.json with Authorization header.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await refreshLeaderboard();
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
