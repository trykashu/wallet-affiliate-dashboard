/**
 * POST /api/automation/sync-affiliates
 *
 * n8n-callable endpoint: triggers affiliate sync from Airtable.
 * Protected by x-api-key header.
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function verifyApiKey(request: NextRequest): boolean {
  const key = request.headers.get("x-api-key") ?? "";
  const expected = process.env.AIRTABLE_WEBHOOK_SECRET ?? "";
  if (!expected || !key) return false;
  return key === expected;
}

export async function POST(request: NextRequest) {
  if (!verifyApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const origin = request.nextUrl.origin;

  try {
    const res = await fetch(`${origin}/api/sync/affiliates`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
