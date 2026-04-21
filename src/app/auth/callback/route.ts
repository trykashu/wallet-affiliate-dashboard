/**
 * GET /auth/callback
 *
 * Supabase auth callback — handles both:
 * 1. PKCE flow: ?code=xxx (from magic link signInWithOtp)
 * 2. Implicit flow: #access_token=xxx (from inviteUserByEmail)
 *
 * For PKCE: exchanges code for session server-side, then redirects to post-login.
 * For implicit: redirects to a client-side page that reads the hash fragment.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  // If no code, this might be an implicit flow redirect where the token is in the hash fragment.
  // Hash fragments are NOT sent to the server, so redirect to a client-side page to handle it.
  if (!code) {
    // Redirect to client-side callback handler that can read hash fragments
    return NextResponse.redirect(`${origin}/auth/confirm`);
  }

  // PKCE flow: exchange code for session
  const response = NextResponse.redirect(`${origin}/api/auth/post-login?next=${encodeURIComponent(next)}`);

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
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  return response;
}
