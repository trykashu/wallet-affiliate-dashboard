import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function verifyApiKey(request: NextRequest): boolean {
  const key =
    request.headers.get("x-api-key") ??
    request.nextUrl.searchParams.get("key") ??
    "";
  const expected = process.env.AIRTABLE_WEBHOOK_SECRET ?? "";
  if (!expected) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a); // burn constant time on length mismatch
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

type SyncType = "affiliates" | "transactions" | "all";

const VALID_TYPES: SyncType[] = ["affiliates", "transactions", "all"];

async function runSync(
  origin: string,
  type: "affiliates" | "transactions"
): Promise<{ type: string; ok: boolean; data: unknown }> {
  try {
    const res = await fetch(`${origin}/api/sync/${type}`, {
      method: "GET",
      headers: { "x-internal-trigger": "manual-trigger" },
    });
    const data = await res.json();
    return { type, ok: res.ok, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { type, ok: false, data: { error: message } };
  }
}

export async function GET(request: NextRequest) {
  if (!verifyApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const typeParam = (request.nextUrl.searchParams.get("type") ?? "all") as string;

  if (!VALID_TYPES.includes(typeParam as SyncType)) {
    return NextResponse.json(
      { error: `Invalid type. Must be one of: ${VALID_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  const syncType = typeParam as SyncType;
  const origin = request.nextUrl.origin;

  console.log(`[trigger/sync] Manual sync triggered: type=${syncType}`);

  const results: Record<string, unknown> = {};

  if (syncType === "affiliates" || syncType === "all") {
    results.affiliates = await runSync(origin, "affiliates");
  }

  if (syncType === "transactions" || syncType === "all") {
    results.transactions = await runSync(origin, "transactions");
  }

  const allOk = Object.values(results).every(
    (r) => (r as { ok: boolean }).ok
  );

  return NextResponse.json(
    { status: allOk ? "ok" : "partial_failure", results },
    { status: allOk ? 200 : 207 }
  );
}
