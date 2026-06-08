"use client";

import { useState } from "react";

interface Props {
  onClose:   () => void;
  onSuccess: () => void;
}

export default function InviteAffiliateModal({ onClose, onSuccess }: Props) {
  const [email,   setEmail]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [sent,    setSent]    = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/invite-affiliate", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email: email.trim() }),
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "An unexpected error occurred.");
      } else {
        setSent(true);
        setTimeout(onSuccess, 1400);
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-md ad-modal overflow-hidden animate-scale-in">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-[var(--ad-border)]">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-semibold ad-text-1">Invite Affiliate</h2>
              <p className="text-xs ad-text-3 mt-0.5">
                Send a dashboard invite to an existing affiliate.
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl ad-text-3 hover:text-[var(--ad-text)] hover:bg-[var(--ad-surface-2)] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Success state */}
        {sent ? (
          <div className="px-6 py-10 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[rgba(52,211,153,0.10)] border border-[rgba(52,211,153,0.28)] flex items-center justify-center">
              <svg className="w-6 h-6 text-[var(--ad-pos)]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <p className="text-sm font-semibold ad-text-1">Invite sent!</p>
            <p className="text-xs ad-text-3 mt-1">
              They&apos;ll receive an email to set up their dashboard account.
            </p>
          </div>
        ) : (
          /* Form */
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            <div>
              <label className="block text-xs font-medium ad-text-2 mb-1.5">
                Affiliate Email <span className="text-[var(--ad-neg)]">*</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="affiliate@example.com"
                className="w-full px-3 py-2 text-sm ad-input transition-colors"
              />
            </div>

            {/* Info callout */}
            <div className="ad-inset p-3 flex gap-2.5">
              <svg className="w-4 h-4 text-[var(--ad-text-3)] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
              <p className="text-xs ad-text-3 leading-relaxed">
                The affiliate must already exist in the system.
                They&apos;ll receive an email to create their dashboard account.
              </p>
            </div>

            {error && (
              <p className="text-xs text-[var(--ad-neg)] bg-[rgba(242,112,110,0.10)] border border-[rgba(242,112,110,0.28)] rounded-xl px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 ad-btn-ghost text-sm justify-center"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="flex-1 ad-btn-primary text-sm flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Sending...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                    </svg>
                    Send Invite
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
