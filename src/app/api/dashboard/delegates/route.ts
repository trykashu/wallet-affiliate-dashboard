import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAffiliateContext } from "@/lib/affiliate-context";
import { createServiceClient } from "@/lib/supabase/service";
import { logSecurityEvent } from "@/lib/audit-log";
import { normalizeEmail, checkInviteAllowed } from "@/lib/delegates/validate-invite";

export const dynamic = "force-dynamic";

const InviteSchema = z.object({
  delegate_name:     z.string().min(1).max(200),
  delegate_email:    z.string().email().max(200),
  can_view_earnings: z.boolean().optional(),
  can_view_payouts:  z.boolean().optional(),
});

export async function GET() {
  const ctx = await getAffiliateContext();
  if (!ctx || ctx.isDelegate) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data } = await svc
    .from("affiliate_delegates")
    .select("id, delegate_name, delegate_email, delegate_user_id, accepted_at, can_view_earnings, can_view_payouts, invited_at")
    .eq("affiliate_id", ctx.affiliateId)
    .order("invited_at", { ascending: false });
  return NextResponse.json({ delegates: data ?? [] });
}

export async function POST(request: NextRequest) {
  const ctx = await getAffiliateContext();
  if (!ctx || ctx.isDelegate) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let raw: unknown;
  try { raw = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = InviteSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const email = normalizeEmail(parsed.data.delegate_email);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // Guard: is this email an existing affiliate? (email-match trigger hazard)
  const { data: affMatch } = await svc
    .from("affiliates")
    .select("id")
    .ilike("email", email)
    .maybeSingle();

  const check = checkInviteAllowed({
    email,
    ownerEmail: ctx.affiliate.email,
    emailIsAffiliate: !!affMatch,
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 409 });
  }

  // Pre-check the global-unique-email constraint for a friendly message.
  const { data: existing } = await svc
    .from("affiliate_delegates")
    .select("id")
    .ilike("delegate_email", email)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: "This email is already a delegate." },
      { status: 409 },
    );
  }

  // Insert the row first, then send the invite; roll back if the email send fails.
  const { data: inserted, error: insertErr } = await svc
    .from("affiliate_delegates")
    .insert({
      affiliate_id:      ctx.affiliateId,
      delegate_email:    email,
      delegate_name:     parsed.data.delegate_name,
      can_view_earnings: parsed.data.can_view_earnings ?? false,
      can_view_payouts:  parsed.data.can_view_payouts ?? false,
      invited_by:        ctx.affiliateId,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json({ error: "Could not create delegate." }, { status: 500 });
  }

  const siteUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const { data: invited, error: inviteErr } = await svc.auth.admin.inviteUserByEmail(email, {
    data:       { role: "delegate", affiliate_id: ctx.affiliateId },
    redirectTo: `${siteUrl}/auth/confirm`,
  });

  if (inviteErr) {
    // email_exists (422) is non-fatal — the user already has an auth account and
    // acceptance still happens on next login. Any other error = roll back the row.
    const status = (inviteErr as { status?: number }).status;
    const code = (inviteErr as { code?: string }).code;
    if (status !== 422 && code !== "email_exists") {
      await svc.from("affiliate_delegates").delete().eq("id", inserted.id);
      return NextResponse.json({ error: "Failed to send the invite email." }, { status: 500 });
    }
  }

  // Stamp delegate_user_id immediately when the invite created/returned a user.
  const newUserId = invited?.user?.id;
  if (newUserId) {
    await svc.from("affiliate_delegates")
      .update({ delegate_user_id: newUserId })
      .eq("id", inserted.id);
  }

  logSecurityEvent({
    userId: ctx.affiliate.user_id,
    userEmail: ctx.affiliate.email,
    action: "delegate.invited",
    resourceType: "affiliate_delegate",
    resourceId: inserted.id,
    metadata: { affiliate_id: ctx.affiliateId, delegate_email: email },
  });

  return NextResponse.json({ success: true, id: inserted.id });
}
