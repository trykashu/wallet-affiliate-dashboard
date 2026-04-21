/**
 * POST /api/automation/invite-affiliate
 *
 * n8n-callable endpoint: sends invite to an affiliate.
 * Protected by x-api-key header.
 * Body: { email, agent_name?, business_name?, agent_phone? }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { logSecurityEvent } from "@/lib/audit-log";
import { z } from "zod";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  email: z.string().email(),
  agent_name: z.string().optional(),
  business_name: z.string().optional(),
  agent_phone: z.string().optional(),
});

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // Look up affiliate by email
  const { data: affiliate, error: lookupError } = await svc
    .from("affiliates")
    .select("id, user_id, email, agent_name")
    .ilike("email", parsed.data.email)
    .limit(1)
    .single();

  if (lookupError || !affiliate) {
    return NextResponse.json({ error: "No affiliate found with this email." }, { status: 404 });
  }

  if (affiliate.user_id) {
    return NextResponse.json({ error: "Affiliate already has a dashboard account." }, { status: 409 });
  }

  // Send invite
  const siteUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!siteUrl && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const { error: inviteError } = await svc.auth.admin.inviteUserByEmail(
    parsed.data.email,
    {
      data: { affiliate_id: affiliate.id },
      redirectTo: `${siteUrl ?? "http://localhost:3000"}/auth/confirm`,
    },
  );

  if (inviteError) {
    console.error("[automation/invite-affiliate] Invite failed:", inviteError);
    return NextResponse.json({ error: "Failed to send invitation email" }, { status: 500 });
  }

  // Audit log
  logSecurityEvent({
    userEmail: "n8n@kashupay.com",
    action: "automation.invite_affiliate",
    resourceType: "affiliate",
    resourceId: affiliate.id,
    metadata: { invited_email: parsed.data.email },
  });

  return NextResponse.json({
    success: true,
    affiliate_id: affiliate.id,
  });
}
