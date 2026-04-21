"use client";

import { useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

type Mode   = "password" | "magic";
type Status = "idle" | "loading" | "sent" | "error";

interface LoginFormProps {
  initialError?: string;
}

export default function LoginForm({ initialError }: LoginFormProps) {
  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mode,         setMode]         = useState<Mode>("password");
  const [status,       setStatus]       = useState<Status>(initialError ? "error" : "idle");
  const [errorMsg,     setErrorMsg]     = useState(
    initialError ? `Sign-in failed: ${initialError}` : ""
  );

  const supabase = createClient();

  // ── Email + Password ────────────────────────────────────────────────────────
  /** Returns the validated post-login destination from the ?redirect= param. */
  function getRedirectTarget(): string {
    const raw = new URLSearchParams(window.location.search).get("redirect");
    // Only allow same-site relative paths — block //host and external URLs
    if (raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("://")) {
      return raw;
    }
    return "/dashboard";
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
    } else {
      // Post-login returns a redirect — navigate to it directly
      const next = getRedirectTarget();
      window.location.href = `/api/auth/post-login?next=${encodeURIComponent(next)}`;
    }
  }

  // ── Magic Link ───────────────────────────────────────────────────────────────
  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    const redirectTarget = getRedirectTarget();
    const callbackUrl = `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTarget)}`;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl },
    });

    if (error) { setStatus("error"); setErrorMsg(error.message); }
    else        { setStatus("sent"); }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setStatus("idle");
    setErrorMsg("");
  }

  // ── "Check inbox" success state ─────────────────────────────────────────────
  if (status === "sent") {
    return (
      <main className="min-h-screen flex flex-col lg:flex-row">
        <MobileHeader />
        <LeftPanel />
        <div className="flex-1 bg-white flex items-center justify-center px-6 py-10 sm:py-12">
          <div className="w-full max-w-sm text-center animate-fade-in">
            <div className="mx-auto mb-5 w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
              <svg className="w-7 h-7 text-accent" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 9v.906a2.25 2.25 0 01-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 001.183 1.981l6.478 3.488m8.839 2.51l-4.66-2.51m0 0l-1.023-.55a2.25 2.25 0 00-2.134 0l-1.022.55m0 0l-4.661 2.51m16.5 1.615a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V8.844a2.25 2.25 0 011.183-1.98l7.5-4.04a2.25 2.25 0 012.134 0l7.5 4.04a2.25 2.25 0 011.183 1.98V19.5z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900">Check your inbox</h2>
            <p className="mt-2 text-sm text-gray-500 leading-relaxed">
              We sent a magic link to{" "}
              <span className="text-gray-900 font-medium">{email}</span>.
              <br />It expires in 1 hour.
            </p>
            <button
              onClick={() => switchMode("password")}
              className="mt-6 text-sm text-brand-600 hover:text-brand-700 font-medium transition-colors"
            >
              ← Back to sign in
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ── Main form ────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen flex flex-col lg:flex-row">
      <MobileHeader />
      <LeftPanel />

      {/* Right: form panel */}
      <div className="flex-1 bg-white flex items-center justify-center px-6 py-10 sm:py-12">
        <div className="w-full max-w-sm animate-fade-in">

          {/* Heading */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900">
              {mode === "password" ? "Sign in to Affiliate Portal" : "Forgot your password?"}
            </h1>
            <p className="mt-1.5 text-sm text-gray-500">
              {mode === "password"
                ? "Welcome back. Enter your credentials to continue."
                : "No worries — we'll email you a magic sign-in link."}
            </p>
          </div>

          {/* ── Password mode ── */}
          {mode === "password" && (
            <form onSubmit={handlePasswordLogin} className="space-y-5">
              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-surface-200 bg-white px-4 py-3 text-sm text-gray-900
                             placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-600/20
                             focus:border-brand-600 transition-all"
                />
              </div>

              {/* Password */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => switchMode("magic")}
                    className="text-xs text-brand-600 hover:text-brand-700 font-medium transition-colors"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-surface-200 bg-white px-4 py-3 pr-11 text-sm text-gray-900
                               placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-600/20
                               focus:border-brand-600 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <ErrorBanner msg={errorMsg} show={status === "error"} />

              <button
                type="submit"
                disabled={status === "loading"}
                className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-lg py-3 text-sm
                           disabled:opacity-60 flex items-center justify-center gap-2 transition-colors"
              >
                {status === "loading" ? <Spinner label="Signing in…" /> : "Sign in"}
              </button>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-surface-200/60" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-white px-3 text-xs text-gray-400">or</span>
                </div>
              </div>

              {/* Magic link alternative */}
              <button
                type="button"
                onClick={() => switchMode("magic")}
                className="w-full border border-surface-200 hover:border-gray-300 hover:bg-gray-50 text-gray-700
                           font-medium rounded-lg py-3 text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 9v.906a2.25 2.25 0 01-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 001.183 1.981l6.478 3.488m8.839 2.51l-4.66-2.51m0 0l-1.023-.55a2.25 2.25 0 00-2.134 0l-1.022.55m0 0l-4.661 2.51m16.5 1.615a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V8.844a2.25 2.25 0 011.183-1.98l7.5-4.04a2.25 2.25 0 012.134 0l7.5 4.04a2.25 2.25 0 011.183 1.98V19.5z" />
                </svg>
                Sign in with magic link
              </button>
            </form>
          )}

          {/* ── Magic link mode ── */}
          {mode === "magic" && (
            <form onSubmit={handleMagicLink} className="space-y-5">
              <div>
                <label htmlFor="email-magic" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Email address
                </label>
                <input
                  id="email-magic"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-surface-200 bg-white px-4 py-3 text-sm text-gray-900
                             placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-600/20
                             focus:border-brand-600 transition-all"
                />
              </div>

              <ErrorBanner msg={errorMsg} show={status === "error"} />

              <button
                type="submit"
                disabled={status === "loading"}
                className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-lg py-3 text-sm
                           disabled:opacity-60 flex items-center justify-center gap-2 transition-colors"
              >
                {status === "loading" ? <Spinner label="Sending…" /> : "Send magic link"}
              </button>

              <button
                type="button"
                onClick={() => switchMode("password")}
                className="w-full text-sm text-gray-500 hover:text-gray-700 transition-colors py-1"
              >
                ← Back to sign in
              </button>
            </form>
          )}

          {/* Get started footer */}
          <p className="mt-8 text-center text-sm text-gray-500">
            New to Kashu Wallet Affiliates?{" "}
            <a
              href="https://www.kashupay.com/affiliates"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-600 hover:text-brand-700 font-semibold transition-colors"
            >
              Get started
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LeftPanel() {
  return (
    <div className="hidden lg:flex lg:w-[44%] bg-brand-600 flex-col relative overflow-hidden">
      {/* Decorative blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
        <div className="absolute -top-40 -right-40 w-[28rem] h-[28rem] rounded-full bg-white/5 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-80 h-80 rounded-full bg-accent/10 blur-3xl" />
        <div className="absolute top-1/2 right-0 w-48 h-48 rounded-full bg-white/5 blur-2xl" />
      </div>

      {/* Logo pinned to top */}
      <div className="relative px-12 pt-12">
        <Image
          src="/kashu-logo-white.png"
          alt="Kashu"
          width={120}
          height={38}
          className="object-contain"
          priority
        />
      </div>

      {/* Tagline — vertically centered to match right panel form */}
      <div className="flex-1 flex flex-col justify-center px-12 relative">
        <div className="space-y-4">
          <h2 className="text-[2rem] font-bold text-white leading-tight">
            Earn on every wallet<br />user you refer.
          </h2>
          <p className="text-brand-300 text-sm leading-relaxed max-w-xs">
            Track your referrals, monitor earnings, and grow your
            affiliate network — all in one place.
          </p>

          {/* Feature bullets */}
          <ul className="space-y-2 pt-2">
            {[
              "Real-time referral funnel tracking",
              "Earnings & commission insights",
              "Leaderboard & performance tiers",
            ].map((item) => (
              <li key={item} className="flex items-center gap-2.5 text-sm text-brand-200">
                <svg className="w-4 h-4 text-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Footer pinned to bottom */}
      <div className="relative px-12 pb-8">
        <p className="text-brand-400 text-xs">
          © {new Date().getFullYear()} Kashu, Inc. All rights reserved.
        </p>
      </div>
    </div>
  );
}

function MobileHeader() {
  return (
    <div className="lg:hidden bg-brand-600 px-6 py-5 flex items-center justify-center">
      <Image
        src="/kashu-logo-white.png"
        alt="Kashu"
        width={100}
        height={32}
        className="object-contain"
        priority
      />
    </div>
  );
}

function ErrorBanner({ msg, show }: { msg: string; show: boolean }) {
  if (!show || !msg) return null;
  return (
    <div className="flex items-start gap-2.5 p-3 rounded-lg bg-red-50 border border-red-100">
      <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
      <p className="text-sm text-red-600">{msg}</p>
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <>
      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      {label}
    </>
  );
}
