"use client";

import { useState } from "react";

interface Props {
  url: string;
  label?: string;
  description?: string;
}

export default function ReferralLinkCard({
  url,
  label = "Your Referral Link",
  description,
}: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard API unavailable */
    }
  }

  return (
    <div className="rounded-3xl border border-accent/15 bg-gradient-to-r from-accent/[0.05] via-accent/[0.02] to-transparent backdrop-blur-sm p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4 transition-all duration-300 hover:shadow-card-md">
      {/* Icon + label + URL */}
      <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
        <div className="w-9 h-9 rounded-xl border bg-accent/10 border-accent/15 flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold text-accent uppercase tracking-[0.1em] mb-1">
            {label}
          </p>
          <p className="text-xs sm:text-sm font-mono text-gray-600 truncate">{url}</p>
          {description && (
            <p className="text-[11px] text-brand-400/70 mt-1 hidden sm:block">{description}</p>
          )}
        </div>
      </div>

      {/* Copy action */}
      <button
        onClick={handleCopy}
        className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200 active:scale-[0.97] flex-shrink-0 ${
          copied
            ? "bg-accent text-brand-900 shadow-glow-sm"
            : "bg-accent text-brand-900 hover:bg-accent/90 shadow-[0_2px_12px_rgba(0,222,143,0.25)]"
        }`}
      >
        {copied ? (
          <>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            Copied!
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
            </svg>
            Copy Link
          </>
        )}
      </button>
    </div>
  );
}
