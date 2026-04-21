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
        const supabase = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );

        // Supabase client auto-detects hash fragments and sets session
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          console.error("[auth/confirm] Session error:", error.message);
          setStatus("error");
          setErrorMsg(error.message);
          return;
        }

        if (data.session) {
          // Session established — redirect to post-login for routing
          window.location.href = "/api/auth/post-login?next=/dashboard";
          return;
        }

        // No session and no error — might still be processing hash
        // Try getUser as fallback
        const { data: userData, error: userError } = await supabase.auth.getUser();

        if (userError || !userData.user) {
          setStatus("error");
          setErrorMsg("Could not verify your invite link. Please try again or request a new invite.");
          return;
        }

        // User exists — redirect
        window.location.href = "/api/auth/post-login?next=/dashboard";
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
