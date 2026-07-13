/**
 * GET /api/auth/post-login
 *
 * Called after auth callback establishes the session.
 * Handles admin auto-creation, last_login_at tracking, and routing.
 * Redirects the browser to the appropriate destination.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";

export async function GET(request: NextRequest) {
  const { origin } = request.nextUrl;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  // Use service client to bypass RLS for admin/affiliate DB operations
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const isAdmin = isAdminEmail(user.email);

  if (isAdmin) {
    // Auto-create admin row if it doesn't exist yet
    const { data: admin } = await db
      .from("admins")
      .select("has_password")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!admin) {
      await db.from("admins").insert({
        user_id: user.id,
        email: user.email,
        has_password: false,
      });
      return NextResponse.redirect(`${origin}/setup-password`);
    }

    // Track last login
    await db
      .from("admins")
      .update({ last_login_at: new Date().toISOString() })
      .eq("user_id", user.id);

    if (!admin.has_password) {
      return NextResponse.redirect(`${origin}/setup-password`);
    }

    return NextResponse.redirect(`${origin}/admin`);
  }

  // Affiliate flow
  let { data: affiliate } = await db
    .from("affiliates")
    .select("has_password")
    .eq("user_id", user.id)
    .single();

  // Self-heal: if no affiliate is linked to this auth user, the
  // on_auth_user_created trigger never matched (email whitespace/casing
  // drift between auth.users and the imported affiliate row). Re-link here
  // via link_affiliate_by_email, which does the exact same trimmed,
  // case-insensitive match as the trigger and only touches rows whose
  // user_id is still NULL — so the user isn't stranded on "Account Being
  // Set Up".
  if (!affiliate && user.email) {
    const { data: linkedRows } = await db.rpc("link_affiliate_by_email", {
      p_user_id: user.id,
      p_email: user.email,
    });
    if (Array.isArray(linkedRows) && linkedRows.length > 0) {
      affiliate = linkedRows[0];
    }
  }

  if (affiliate) {
    // Track last login
    await db
      .from("affiliates")
      .update({ last_login_at: new Date().toISOString() })
      .eq("user_id", user.id);

    if (!affiliate.has_password) {
      return NextResponse.redirect(`${origin}/setup-password`);
    }
  }

  // Delegate flow: no affiliate row for this user — they may be an invited
  // delegate. accept_delegate_invite() (SECURITY DEFINER, reads auth.uid()/jwt)
  // stamps delegate_user_id/accepted_at and returns the owner affiliate id.
  if (!affiliate) {
    const { data: delegateAffId } = await supabase.rpc("accept_delegate_invite");
    if (delegateAffId) {
      const next = request.nextUrl.searchParams.get("next");
      const safeNext =
        next && next.startsWith("/") && !next.startsWith("//") && !next.includes("://")
          ? next
          : "/dashboard";
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  // Honor ?next= param with open-redirect protection
  const next = request.nextUrl.searchParams.get("next");
  const safeNext =
    next && next.startsWith("/") && !next.startsWith("//") && !next.includes("://")
      ? next
      : "/dashboard";

  return NextResponse.redirect(`${origin}${safeNext}`);
}
