import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function verifyWebhookSecret(request: NextRequest): boolean {
  const secret = request.headers.get("x-webhook-secret") ?? "";
  const expected = process.env.AIRTABLE_WEBHOOK_SECRET ?? "";
  if (!expected) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a); // burn constant time on length mismatch
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!verifyWebhookSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const origin = request.nextUrl.origin;

  console.log("[webhook/airtable/affiliates] Received webhook, triggering full sync");

  try {
    const syncRes = await fetch(`${origin}/api/sync/affiliates`, {
      method: "GET",
      headers: { "x-internal-trigger": "airtable-webhook" },
    });

    const result = await syncRes.json();

    if (!syncRes.ok) {
      console.error("[webhook/airtable/affiliates] Sync failed:", result);
      return NextResponse.json(
        { error: "Sync failed" },
        { status: 502 }
      );
    }

    return NextResponse.json({ status: "ok", sync: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[webhook/airtable/affiliates] Error:", message);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
