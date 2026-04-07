/**
 * Next.js Middleware — Session refresh + route protection.
 *
 * Runs on every request before the page renders.
 * Refreshes the Supabase session cookie and redirects
 * unauthenticated users away from protected routes.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAdminEmail } from "@/lib/admin";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session — MUST be called before any auth checks
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Preview bypass: skip all auth checks when PREVIEW_BYPASS_AUTH is set
  // Only use on Vercel Preview deployments — never in production
  if (process.env.PREVIEW_BYPASS_AUTH === "true" && process.env.VERCEL_ENV === "preview") {
    return supabaseResponse;
  }

  // Skip auth for demo routes
  if (pathname.startsWith("/demo")) {
    return supabaseResponse;
  }

  // Redirect unauthenticated users to login
  if (!user && (pathname.startsWith("/dashboard") || pathname.startsWith("/admin"))) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    // Only add redirect param for non-default destinations
    if (pathname !== "/dashboard") {
      loginUrl.searchParams.set("redirect", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  // Redirect non-admin users away from /admin
  if (user && pathname.startsWith("/admin")) {
    const isAdmin = isAdminEmail(user.email);

    if (!isAdmin) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  // Redirect authenticated users away from login page
  if (user && pathname === "/login") {
    const dest = request.nextUrl.clone();
    dest.pathname = isAdminEmail(user.email) ? "/admin" : "/dashboard";
    return NextResponse.redirect(dest);
  }

  // Redirect admin users without an affiliate row from /dashboard to /admin
  // Skip if view-as cookie is set — admin is intentionally viewing an affiliate's dashboard
  const hasViewAsCookie = request.cookies.has("wallet_view_as");
  if (user && pathname.startsWith("/dashboard") && isAdminEmail(user.email) && !hasViewAsCookie) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: affiliate } = await (supabase as any)
      .from("affiliates")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!affiliate) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
  }

  // Block dashboard/admin access until password is set (skip API routes and setup-password itself)
  if (
    user &&
    (pathname.startsWith("/dashboard") || pathname.startsWith("/admin")) &&
    !pathname.startsWith("/api/")
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const isAdmin = isAdminEmail(user.email);

    if (isAdmin) {
      // Check admins table for password status
      const { data: admin } = await db
        .from("admins")
        .select("has_password")
        .eq("user_id", user.id)
        .maybeSingle();

      if (admin && !admin.has_password) {
        return NextResponse.redirect(new URL("/setup-password", request.url));
      }
    } else {
      // Check affiliates table for password status + suspension
      const { data: affiliate } = await db
        .from("affiliates")
        .select("has_password, status")
        .eq("user_id", user.id)
        .single();

      if (affiliate?.status === "suspended") {
        await supabase.auth.signOut();
        const suspendedUrl = request.nextUrl.clone();
        suspendedUrl.pathname = "/login";
        suspendedUrl.searchParams.set("error", "account_suspended");
        return NextResponse.redirect(suspendedUrl);
      }

      if (affiliate && !affiliate.has_password) {
        return NextResponse.redirect(new URL("/setup-password", request.url));
      }
    }
  }

  // If user already has password and visits /setup-password, redirect to correct destination
  if (user && pathname === "/setup-password") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const isAdmin = isAdminEmail(user.email);

    if (isAdmin) {
      const { data: admin } = await db
        .from("admins")
        .select("has_password")
        .eq("user_id", user.id)
        .maybeSingle();

      if (admin?.has_password) {
        return NextResponse.redirect(new URL("/admin", request.url));
      }
    } else {
      const { data: affiliate } = await db
        .from("affiliates")
        .select("has_password")
        .eq("user_id", user.id)
        .single();

      if (affiliate?.has_password) {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Run on all routes except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
