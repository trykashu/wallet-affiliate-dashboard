"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/**
 * Client-side auth callback handler for implicit flow (invite links).
 *
 * Supabase invite links redirect with hash fragments (#access_token=xxx)
 * which are not visible to server-side route handlers.
 * This page reads the hash, sets the session, then redirects to post-login.
 */
export default function AuthConfirmPage() {
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    async function handleCallback() {
      try {
        // Read hash fragment from the URL
        const hash = window.location.hash;
        console.log("[auth/confirm] Hash:", hash ? hash.substring(0, 50) + "..." : "none");
        console.log("[auth/confirm] Search:", window.location.search);
        console.log("[auth/confirm] Full URL:", window.location.href.substring(0, 120));

        const supabase = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );

        // If hash contains access_token, Supabase client should detect it on init.
        // But we may need to explicitly call onAuthStateChange to catch it.

        // First, check if there's already a session (from auto-detection)
        const { data: sessionData } = await supabase.auth.getSession();

        if (sessionData.session) {
          console.log("[auth/confirm] Session found immediately");
          window.location.href = "/api/auth/post-login?next=/dashboard";
          return;
        }

        // If hash has tokens, try to set session manually
        if (hash && hash.includes("access_token")) {
          const params = new URLSearchParams(hash.substring(1));
          const accessToken = params.get("access_token");
          const refreshToken = params.get("refresh_token");

          if (accessToken && refreshToken) {
            console.log("[auth/confirm] Setting session from hash tokens");
            const { error: setError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });

            if (setError) {
              console.error("[auth/confirm] setSession error:", setError.message);
              setStatus("error");
              setErrorMsg(setError.message);
              return;
            }

            window.location.href = "/api/auth/post-login?next=/dashboard";
            return;
          }
        }

        // If URL has a code param (PKCE flow landed here somehow)
        const searchParams = new URLSearchParams(window.location.search);
        const code = searchParams.get("code");
        if (code) {
          console.log("[auth/confirm] Found code param, exchanging...");
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (!exchangeError) {
            window.location.href = "/api/auth/post-login?next=/dashboard";
            return;
          }
          console.error("[auth/confirm] Code exchange failed:", exchangeError.message);
        }

        // Wait briefly for onAuthStateChange to fire (Supabase may process async)
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => resolve(), 3000);
          supabase.auth.onAuthStateChange((event) => {
            console.log("[auth/confirm] Auth state change:", event);
            if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
              clearTimeout(timeout);
              resolve();
            }
          });
        });

        // Final check
        const { data: finalSession } = await supabase.auth.getSession();
        if (finalSession.session) {
          console.log("[auth/confirm] Session found after waiting");
          window.location.href = "/api/auth/post-login?next=/dashboard";
          return;
        }

        setStatus("error");
        setErrorMsg("Could not verify your invite link. Please try again or request a new invite.");
      } catch (err) {
        console.error("[auth/confirm] Unexpected error:", err);
        setStatus("error");
        setErrorMsg("Something went wrong. Please try again.");
      }
    }

    handleCallback();
  }, []);

  if (status === "error") {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-red-100 border border-red-200 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Sign-in Failed</h1>
          <p className="mt-3 text-sm text-brand-400 leading-relaxed">{errorMsg}</p>
          <a
            href="/login"
            className="inline-block mt-6 px-6 py-2.5 bg-brand-600 text-white text-sm font-semibold rounded-xl hover:bg-brand-700 transition-colors"
          >
            Back to Login
          </a>
        </div>
      </div>
    );
  }

  // Loading state
  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center px-4">
      <div className="text-center">
        <svg className="animate-spin w-8 h-8 text-brand-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-sm text-brand-400">Verifying your invite...</p>
      </div>
    </div>
  );
}
