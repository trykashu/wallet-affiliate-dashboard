import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function verifyApiKey(request: NextRequest): boolean {
  const key =
    request.headers.get("x-api-key") ??
    request.nextUrl.searchParams.get("key") ??
    "";
  const expected = process.env.AIRTABLE_WEBHOOK_SECRET ?? "";
  if (!expected || !key) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

async function verifyAdmin(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return !!user && isAdminEmail(user.email);
  } catch {
    return false;
  }
}

type SyncType = "affiliates" | "users" | "highlevel" | "transactions" | "all";

const VALID_TYPES: SyncType[] = ["affiliates", "users", "highlevel", "transactions", "all"];

// Order mirrors /api/cron/sync-airtable: affiliates → users → highlevel → transactions.
// users depends on affiliates; transactions depends on referred_users.
const ALL_SEQUENCE: ("affiliates" | "users" | "highlevel" | "transactions")[] = [
  "affiliates",
  "users",
  "highlevel",
  "transactions",
];

async function runSync(
  origin: string,
  type: "affiliates" | "users" | "highlevel" | "transactions"
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
  // Auth: API key (for external triggers) OR admin session (for dashboard buttons)
  const hasApiKey = verifyApiKey(request);
  const isAdmin = !hasApiKey ? await verifyAdmin() : false;

  if (!hasApiKey && !isAdmin) {
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

  if (syncType === "all") {
    for (const step of ALL_SEQUENCE) {
      results[step] = await runSync(origin, step);
    }
  } else {
    results[syncType] = await runSync(origin, syncType);
  }

  const allOk = Object.values(results).every(
    (r) => (r as { ok: boolean }).ok
  );

  return NextResponse.json(
    { status: allOk ? "ok" : "partial_failure", results },
    { status: allOk ? 200 : 207 }
  );
}
