"use client";

import { useState } from "react";
import type { PayoutAccount } from "@/types/database";

interface Props {
  account: PayoutAccount | null;
}

const PROVIDER_LABELS: Record<string, string> = {
  stripe_connect: "Stripe",
  manual:         "Manual",
  mercury:        "Mercury ACH",
};

export default function PayoutAccountCard({ account }: Props) {
  const [connecting, setConnecting] = useState(false);

  async function handleConnect() {
    setConnecting(true);
    try {
      const res = await fetch("/api/payouts/stripe-connect");
      const { url } = await res.json();
      if (url) window.location.href = url;
    } catch {
      setConnecting(false);
    }
  }

  if (!account || !account.is_verified) {
    return (
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Payout Account</h3>
        <p className="text-xs text-brand-400 mb-4">
          Connect a bank account to receive payouts via Stripe.
        </p>
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="btn-primary text-sm w-full flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {connecting ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Redirecting…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
              </svg>
              Connect with Stripe
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Payout Account</h3>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {account.account_name ?? PROVIDER_LABELS[account.provider]}
          </p>
          <p className="text-xs text-brand-400">
            {PROVIDER_LABELS[account.provider]} ·{" "}
            <span className={account.is_verified ? "text-accent" : "text-amber-400"}>
              {account.is_verified ? "verified" : "pending"}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
