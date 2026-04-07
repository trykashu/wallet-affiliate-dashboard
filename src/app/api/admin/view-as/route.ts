/**
 * /api/admin/view-as
 * ------------------
 * POST  { affiliate_id, affiliate_name } -> sets wallet_view_as cookie, returns { ok: true }
 * DELETE                                 -> clears cookie, redirects to /admin
 *
 * Both methods are admin-only (403 if not admin email).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient }              from "@/lib/supabase/server";
import { createServiceClient }       from "@/lib/supabase/service";
import { isAdminEmail }              from "@/lib/admin";
import { VIEW_AS_COOKIE }            from "@/lib/affiliate-context";
import { logSecurityEvent }          from "@/lib/audit-log";

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path:     "/",
  maxAge:   60 * 60 * 8, // 8 hours
};

// -- POST: enter view-as mode --
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let affiliate_id: string;
  try {
    ({ affiliate_id } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Verify the affiliate actually exists and get canonical name from DB
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data: affiliate } = await svc
    .from("affiliates")
    .select("id, agent_name, business_name")
    .eq("id", affiliate_id)
    .single();

  if (!affiliate) {
    return NextResponse.json({ error: "Affiliate not found" }, { status: 404 });
  }

  // Use DB-sourced name, not the client-supplied value
  const canonicalName = affiliate.agent_name ?? affiliate.business_name ?? affiliate_id;

  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    VIEW_AS_COOKIE,
    JSON.stringify({ affiliate_id, affiliate_name: canonicalName }),
    COOKIE_OPTS,
  );

  // Audit log
  logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: "admin.view_as_enter",
    resourceType: "affiliate",
    resourceId: affiliate_id,
    metadata: { affiliate_name: canonicalName },
  });

  return response;
}

// -- DELETE: exit view-as mode --
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const origin = req.nextUrl.origin;
  const response = NextResponse.redirect(`${origin}/admin`);
  response.cookies.delete(VIEW_AS_COOKIE);
  return response;
}
