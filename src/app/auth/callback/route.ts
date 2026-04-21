/**
 * GET /auth/callback
 *
 * Supabase auth callback — handles:
 * 1. PKCE flow: ?code=xxx (from magic link signInWithOtp)
 * 2. Implicit flow: no code (from inviteUserByEmail) → redirect to client-side /auth/confirm
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  // No code → implicit flow (invite links) → redirect to client-side handler
  if (!code) {
    const redirectUrl = new URL("/auth/confirm", origin);
    // Preserve hash fragment by using a meta refresh page
    return new NextResponse(
      `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=/auth/confirm${request.nextUrl.hash || ""}"></head><body>Redirecting...</body></html>`,
      {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  // PKCE flow: exchange code for session server-side
  const postLoginUrl = new URL(`/api/auth/post-login`, origin);
  postLoginUrl.searchParams.set("next", next);
  const response = NextResponse.redirect(postLoginUrl.toString());

  // Ensure mobile browsers treat this as a navigation, not a download
  response.headers.set("Content-Type", "text/html; charset=utf-8");

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
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth/callback] Code exchange failed:", error.message);
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  return response;
}
