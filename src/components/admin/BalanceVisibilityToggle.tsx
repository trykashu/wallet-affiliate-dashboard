"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "kw-admin-mask-money";

/**
 * System-wide balance-visibility toggle. Masks every monetary figure in the
 * admin panel (anything marked `data-sensitive`, e.g. <Money>) by toggling a
 * `mask-money` class on the [data-admin-theme] shell. CSS does the blur, so it
 * works across server-rendered pages with no prop drilling. Persists in
 * localStorage so it survives navigation/refresh — handy when screen-sharing.
 */
export default function BalanceVisibilityToggle() {
  const [masked, setMasked] = useState(false);

  // Apply persisted preference on mount.
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) === "1";
    setMasked(stored);
  }, []);

  // Reflect state onto the admin shell + persist.
  useEffect(() => {
    const shell = document.querySelector("[data-admin-theme]");
    if (shell) shell.classList.toggle("mask-money", masked);
    localStorage.setItem(STORAGE_KEY, masked ? "1" : "0");
  }, [masked]);

  return (
    <button
      type="button"
      onClick={() => setMasked((m) => !m)}
      className="ad-btn-ghost flex items-center gap-1.5"
      aria-pressed={masked}
      title={masked ? "Show balances" : "Hide balances"}
    >
      {masked ? (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.243 4.243L9.88 9.88" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )}
      <span className="hidden sm:inline">{masked ? "Balances hidden" : "Hide balances"}</span>
    </button>
  );
}
