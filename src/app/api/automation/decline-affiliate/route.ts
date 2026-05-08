/**
 * POST /api/automation/decline-affiliate
 *
 * Called by the n8n decline workflow at the end of the PandaDoc decline path.
 * Archives the affiliate so they no longer appear in active counts on the
 * admin dashboard.
 *
 * Auth: shared API key in `x-api-key` header or `?key=` query param,
 * matching the value in env var AIRTABLE_WEBHOOK_SECRET. Same pattern as
 * /api/admin/invite-affiliate.
 *
 * Body: one of `{ "email": "..." }`, `{ "attribution_id": "..." }`,
 * or `{ "pandadoc_id": "..." }`.
 *
 * Idempotent — re-running the call on an already-archived affiliate
 * returns 200 with `already_archived: true`.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { logSecurityEvent } from "@/lib/audit-log";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const DeclineSchema = z.object({
  email: z.string().email().optional(),
  attribution_id: z.string().min(1).optional(),
  pandadoc_id: z.string().min(1).optional(),
}).refine((d) => d.email || d.attribution_id || d.pandadoc_id, {
  message: "Provide at least one of email, attribution_id, or pandadoc_id",
});

function verifyApiKey(request: NextRequest): boolean {
  const provided =
    request.headers.get("x-api-key") ??
    request.nextUrl.searchParams.get("key") ??
    "";
  const expected = process.env.AIRTABLE_WEBHOOK_SECRET ?? "";
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!verifyApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try { rawBody = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = DeclineSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // Look up the affiliate by whichever identifier was provided
  let query = svc.from("affiliates").select("id, agent_name, status, agreement_status");
  if (parsed.data.email)          query = query.eq("email", parsed.data.email);
  if (parsed.data.attribution_id) query = query.eq("attribution_id", parsed.data.attribution_id);
  if (parsed.data.pandadoc_id)    query = query.eq("pandadoc_id", parsed.data.pandadoc_id);
  const { data: affiliate, error: lookupError } = await query.maybeSingle();

  if (lookupError) {
    console.error("[decline-affiliate] Lookup failed:", lookupError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  if (!affiliate) {
    return NextResponse.json({ error: "Affiliate not found" }, { status: 404 });
  }

  if (affiliate.status === "archived" && affiliate.agreement_status === "Declined") {
    return NextResponse.json({ success: true, already_archived: true, affiliate_id: affiliate.id });
  }

  const { error: updateError } = await svc
    .from("affiliates")
    .update({ status: "archived", agreement_status: "Declined" })
    .eq("id", affiliate.id);

  if (updateError) {
    console.error("[decline-affiliate] Update failed:", updateError);
    return NextResponse.json({ error: "Failed to archive" }, { status: 500 });
  }

  logSecurityEvent({
    userId: "automation",
    userEmail: "n8n@kashupay.com",
    action: "automation.decline_affiliate",
    resourceType: "affiliate",
    resourceId: affiliate.id,
    metadata: {
      lookup: parsed.data.email ?? parsed.data.attribution_id ?? parsed.data.pandadoc_id,
      previous_status: affiliate.status,
      previous_agreement_status: affiliate.agreement_status,
    },
  });

  return NextResponse.json({ success: true, affiliate_id: affiliate.id });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
