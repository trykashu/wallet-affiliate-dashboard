/**
 * POST /api/admin/invite-affiliate
 *
 * Admin-only: sends a Supabase invite email to an existing affiliate.
 * Affiliate row must already exist in the system.
 * If affiliate already has a dashboard account, returns 409.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";

const InviteSchema = z.object({
  email: z.string().email(),
});

export async function POST(request: NextRequest) {
  // 1. Auth: admin session OR API key (for n8n automation)
  const apiKey = request.headers.get("x-api-key") ?? "";
  const expectedKey = process.env.AIRTABLE_WEBHOOK_SECRET ?? "";
  const hasApiKey = apiKey.length > 0 && expectedKey.length > 0 && apiKey === expectedKey;

  let adminUserId: string;
  let adminEmail: string;

  if (hasApiKey) {
    adminUserId = "automation";
    adminEmail = "n8n@kashupay.com";
  } else {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !isAdminEmail(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    adminUserId = user.id;
    adminEmail = user.email ?? "unknown";
  }

  // 2. Validate body
  let rawBody: unknown;
  try { rawBody = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = InviteSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // 3. Look up existing affiliate by email
  const { data: affiliate, error: lookupError } = await svc
    .from("affiliates")
    .select("id, user_id")
    .eq("email", parsed.data.email)
    .maybeSingle();

  if (lookupError) {
    console.error("[admin/invite-affiliate] Lookup failed:", lookupError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  if (!affiliate) {
    return NextResponse.json(
      { error: "No affiliate found with this email." },
      { status: 404 },
    );
  }

  // 4. Skip if affiliate already has a dashboard account
  if (affiliate.user_id) {
    return NextResponse.json(
      { error: "Affiliate already has a dashboard account" },
      { status: 409 },
    );
  }

  // 5. Send invite via Supabase Auth admin
  const siteUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!siteUrl && process.env.NODE_ENV === "production") {
    console.error("[admin/invite-affiliate] FATAL: No APP_URL configured in production");
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const { error: inviteError } = await svc.auth.admin.inviteUserByEmail(
    parsed.data.email,
    {
      data:       { affiliate_id: affiliate.id },
      redirectTo: `${siteUrl ?? "http://localhost:3000"}/auth/callback`,
    },
  );

  if (inviteError) {
    console.error("[admin/invite-affiliate] Invite failed:", inviteError);
    return NextResponse.json({ error: "Failed to send invitation email" }, { status: 500 });
  }

  // 6. Audit log
  logSecurityEvent({
    userId: adminUserId,
    userEmail: adminEmail,
    action: "admin.invite_affiliate",
    resourceType: "affiliate",
    resourceId: affiliate.id,
    metadata: { invited_email: parsed.data.email },
  });

  return NextResponse.json({ success: true, affiliate_id: affiliate.id });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
