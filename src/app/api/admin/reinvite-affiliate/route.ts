/**
 * POST /api/admin/reinvite-affiliate
 *
 * Admin-only: deletes expired auth user, resets affiliate, sends fresh invite.
 * Body: { email: string }
 * Auth: admin session OR x-api-key header
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";
import { z } from "zod";

export const dynamic = "force-dynamic";

const BodySchema = z.object({ email: z.string().email() });

export async function POST(request: NextRequest) {
  // Auth: admin session OR API key
  const apiKey = request.headers.get("x-api-key") ?? "";
  const expectedKey = process.env.AIRTABLE_WEBHOOK_SECRET ?? "";
  const hasApiKey = apiKey.length > 0 && expectedKey.length > 0 && apiKey === expectedKey;

  let adminEmail = "automation";
  if (!hasApiKey) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !isAdminEmail(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    adminEmail = user.email ?? "admin";
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // Find affiliate
  const { data: affiliate } = await svc
    .from("affiliates")
    .select("id, user_id, email, agent_name, has_password")
    .ilike("email", parsed.data.email)
    .limit(1)
    .single();

  if (!affiliate) {
    return NextResponse.json({ error: "Affiliate not found" }, { status: 404 });
  }

  // If they already have a password, they don't need a re-invite
  if (affiliate.has_password) {
    return NextResponse.json({ error: "Affiliate already has an active account. Use 'Send Link' for a magic link instead." }, { status: 409 });
  }

  // Delete existing auth user if present
  if (affiliate.user_id) {
    const { error: deleteError } = await svc.auth.admin.deleteUser(affiliate.user_id);
    if (deleteError) {
      console.error("[reinvite] Failed to delete auth user:", deleteError.message);
    }
  }

  // Reset affiliate
  await svc
    .from("affiliates")
    .update({ user_id: null, has_password: false })
    .eq("id", affiliate.id);

  // Send fresh invite
  const siteUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const { error: inviteError } = await svc.auth.admin.inviteUserByEmail(
    parsed.data.email,
    {
      data: { affiliate_id: affiliate.id },
      redirectTo: `${siteUrl ?? "http://localhost:3000"}/auth/confirm`,
    },
  );

  if (inviteError) {
    console.error("[reinvite] Invite failed:", inviteError.message);
    return NextResponse.json({ error: "Failed to send invitation email" }, { status: 500 });
  }

  logSecurityEvent({
    userEmail: adminEmail,
    action: "admin.reinvite_affiliate",
    resourceType: "affiliate",
    resourceId: affiliate.id,
    metadata: { email: parsed.data.email },
  });

  return NextResponse.json({ success: true, affiliate_id: affiliate.id });
}
