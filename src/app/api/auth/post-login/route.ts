/**
 * GET /api/auth/post-login
 *
 * Called by the client-side auth callback after session is established.
 * Handles admin auto-creation, last_login_at tracking, and routing.
 * Returns { redirect: string } with the appropriate destination.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ redirect: "/login" });
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
      return NextResponse.json({ redirect: "/setup-password" });
    }

    // Track last login
    await db
      .from("admins")
      .update({ last_login_at: new Date().toISOString() })
      .eq("user_id", user.id);

    if (!admin.has_password) {
      return NextResponse.json({ redirect: "/setup-password" });
    }

    return NextResponse.json({ redirect: "/admin" });
  }

  // Affiliate flow
  const { data: affiliate } = await db
    .from("affiliates")
    .select("has_password")
    .eq("user_id", user.id)
    .single();

  if (affiliate) {
    // Track last login
    await db
      .from("affiliates")
      .update({ last_login_at: new Date().toISOString() })
      .eq("user_id", user.id);

    if (!affiliate.has_password) {
      return NextResponse.json({ redirect: "/setup-password" });
    }
  }

  // Honor ?next= param with open-redirect protection
  const next = request.nextUrl.searchParams.get("next");
  const safeNext =
    next && next.startsWith("/") && !next.startsWith("//") && !next.includes("://")
      ? next
      : "/dashboard";

  return NextResponse.json({ redirect: safeNext });
}
