"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Click-to-verify landing page for emailed auth links.
 *
 * Email security scanners (Gmail prefetch, Microsoft SafeLinks) follow links
 * with GET requests and burn one-time Supabase tokens before the user clicks.
 * This page defeats that: the emailed URL carries ?token_hash=...&type=...,
 * loading the page consumes NOTHING, and the token is only verified when the
 * user clicks the button (an XHR triggered by a real gesture — scanners
 * issue bare GETs and don't submit).
 *
 * Unlike PKCE ?code= links, token_hash verification has no dependence on a
 * code-verifier cookie, so the link works in any browser or device.
 */

const VALID_TYPES: EmailOtpType[] = [
  "invite",
  "recovery",
  "email",
  "magiclink",
  "signup",
  "email_change",
];

const SAFE_NEXT = /^\/(?!\/)/; // same-origin paths only

export default function AuthVerifyPage() {
  const [params, setParams] = useState<{
    tokenHash: string;
    type: EmailOtpType;
    next: string;
  } | null>(null);
  const [status, setStatus] = useState<"idle" | "verifying" | "invalid" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const tokenHash = search.get("token_hash");
    const type = search.get("type") as EmailOtpType | null;
    const nextParam = search.get("next");
    const next = nextParam && SAFE_NEXT.test(nextParam) ? nextParam : "/dashboard";

    if (!tokenHash || !type || !VALID_TYPES.includes(type)) {
      setStatus("invalid");
      setErrorMsg("This link is incomplete or malformed. Please use the button in your most recent email, or request a new link.");
      return;
    }
    setParams({ tokenHash, type, next });
  }, []);

  async function handleVerify() {
    if (!params) return;
    setStatus("verifying");

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { error } = await supabase.auth.verifyOtp({
      token_hash: params.tokenHash,
      type: params.type,
    });

    if (error) {
      console.error("[auth/verify] verifyOtp failed:", error.code, error.message);
      setStatus("error");
      if (error.code === "otp_expired") {
        setErrorMsg(
          "This link has expired or was already used. Links are valid for 24 hours and can only be used once — request a new one below."
        );
      } else {
        setErrorMsg(error.message || "Verification failed. Please request a new link.");
      }
      return;
    }

    // Session established — post-login routes to /setup-password when
    // the account has no password yet, otherwise to the dashboard.
    window.location.href = `/api/auth/post-login?next=${encodeURIComponent(params.next)}`;
  }

  if (status === "invalid" || status === "error") {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-red-100 border border-red-200 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Link Not Valid</h1>
          <p className="mt-3 text-sm text-brand-400 leading-relaxed">{errorMsg}</p>
          <a
            href="/login"
            className="inline-block mt-6 px-6 py-2.5 bg-brand-600 text-white text-sm font-semibold rounded-xl hover:bg-brand-700 transition-colors"
          >
            Back to Login
          </a>
          <p className="mt-4 text-xs text-brand-400">
            From the login page you can request a fresh link with &ldquo;Forgot password?&rdquo;
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-accent/10 border border-accent/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-900">You&rsquo;re almost in</h1>
        <p className="mt-3 text-sm text-brand-400 leading-relaxed">
          Click below to verify this device and continue to your Kashu affiliate dashboard.
        </p>
        <button
          onClick={handleVerify}
          disabled={status === "verifying" || !params}
          className="inline-block mt-6 px-6 py-2.5 bg-brand-600 text-white text-sm font-semibold rounded-xl hover:bg-brand-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {status === "verifying" ? "Verifying…" : "Continue to Dashboard"}
        </button>
      </div>
    </div>
  );
}
