"use client";

import { useState } from "react";
import Image from "next/image";

type Status = "idle" | "loading" | "error";

export default function SetupPasswordForm({ redirectTo = "/dashboard" }: { redirectTo?: string }) {
  const [password, setPassword]         = useState("");
  const [confirm, setConfirm]           = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm]   = useState(false);
  const [status, setStatus]             = useState<Status>("idle");
  const [errorMsg, setErrorMsg]         = useState("");

  const mismatch = confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < 8;
  const canSubmit = password.length >= 8 && password === confirm && status !== "loading";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/auth/setup-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data.error ?? "Something went wrong");
        return;
      }

      // Password set — go to correct destination
      window.location.href = redirectTo;
    } catch {
      setStatus("error");
      setErrorMsg("Network error — please try again");
    }
  }

  return (
    <main className="min-h-screen flex">
      {/* Left panel — same as login */}
      <div className="hidden lg:flex lg:w-[44%] bg-brand-600 flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
          <div className="absolute -top-40 -right-40 w-[28rem] h-[28rem] rounded-full bg-white/5 blur-3xl" />
          <div className="absolute bottom-0 left-0 w-80 h-80 rounded-full bg-accent/10 blur-3xl" />
          <div className="absolute top-1/2 right-0 w-48 h-48 rounded-full bg-white/5 blur-2xl" />
        </div>

        <div className="relative">
          <Image
            src="/kashu-logo-white.png"
            alt="Kashu"
            width={120}
            height={38}
            className="object-contain"
            priority
          />
        </div>

        <div className="relative space-y-4">
          <h2 className="text-[2rem] font-bold text-white leading-tight">
            Secure your account.
          </h2>
          <p className="text-brand-300 text-sm leading-relaxed max-w-xs">
            Create a password so you can sign in quickly next time.
            You&apos;ll still be able to use magic links if you prefer.
          </p>

          <ul className="space-y-2 pt-2">
            {[
              "Minimum 8 characters",
              "Use a mix of letters, numbers & symbols",
              "Don't reuse passwords from other sites",
            ].map((item) => (
              <li key={item} className="flex items-center gap-2.5 text-sm text-brand-200">
                <svg className="w-4 h-4 text-accent flex-shrink-0" aria-hidden="true" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative">
          <p className="text-brand-400 text-xs">
            © {new Date().getFullYear()} Kashu, Inc. All rights reserved.
          </p>
        </div>
      </div>

      {/* Right: form panel */}
      <div className="flex-1 bg-white flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm animate-fade-in">
          {/* Mobile logo */}
          <div className="flex justify-center mb-8 lg:hidden">
            <Image
              src="/kashu-logo-white.png"
              alt="Kashu"
              width={110}
              height={34}
              className="object-contain"
              priority
            />
          </div>

          {/* Heading */}
          <div className="mb-8">
            <div className="mx-auto lg:mx-0 mb-5 w-14 h-14 rounded-2xl bg-brand-600/10 border border-brand-600/20 flex items-center justify-center">
              <svg className="w-7 h-7 text-brand-600" aria-hidden="true" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Create your password</h1>
            <p className="mt-1.5 text-sm text-gray-500">
              Set a password to secure your account. You can always use a magic link too.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Password */}
            <div>
              <label htmlFor="setup-password" className="block text-sm font-medium text-gray-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  id="setup-password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className={`w-full rounded-xl border bg-white px-4 py-3 pr-11 text-sm text-gray-900
                             placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-600/20
                             focus:border-brand-600 transition-all ${
                               tooShort ? "border-red-300" : "border-surface-200"
                             }`}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <EyeIcon show={showPassword} />
                </button>
              </div>
              {tooShort && (
                <p className="text-xs text-red-500 mt-1">Must be at least 8 characters</p>
              )}
            </div>

            {/* Confirm */}
            <div>
              <label htmlFor="setup-confirm" className="block text-sm font-medium text-gray-700 mb-1.5">
                Confirm password
              </label>
              <div className="relative">
                <input
                  id="setup-confirm"
                  type={showConfirm ? "text" : "password"}
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter your password"
                  className={`w-full rounded-xl border bg-white px-4 py-3 pr-11 text-sm text-gray-900
                             placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-600/20
                             focus:border-brand-600 transition-all ${
                               mismatch ? "border-red-300" : "border-surface-200"
                             }`}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label={showConfirm ? "Hide password" : "Show password"}
                >
                  <EyeIcon show={showConfirm} />
                </button>
              </div>
              {mismatch && (
                <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
              )}
            </div>

            {/* Error */}
            {status === "error" && errorMsg && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-red-50 border border-red-100">
                <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" aria-hidden="true" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <p className="text-sm text-red-600">{errorMsg}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-lg py-3 text-sm
                         disabled:opacity-60 flex items-center justify-center gap-2 transition-colors"
            >
              {status === "loading" ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Setting password…
                </>
              ) : (
                "Create password & continue"
              )}
            </button>

            {/* Password strength hints (mobile only) */}
            <div className="lg:hidden space-y-1.5 pt-1">
              <p className="text-xs text-gray-400">Password tips:</p>
              <ul className="space-y-1">
                {["Min 8 characters", "Mix letters, numbers & symbols"].map((tip) => (
                  <li key={tip} className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span className="w-1 h-1 rounded-full bg-gray-300 flex-shrink-0" />
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}

function EyeIcon({ show }: { show: boolean }) {
  return show ? (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  ) : (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
