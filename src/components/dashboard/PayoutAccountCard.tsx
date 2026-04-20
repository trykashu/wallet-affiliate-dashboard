"use client";

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
  if (!account || !account.is_verified) {
    return (
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Payout Account</h3>
        <p className="text-xs text-brand-400">
          No payout account on file. Bank details will be collected when you sign your agreement.
        </p>
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
            <span className="text-accent">verified</span>
          </p>
        </div>
      </div>
    </div>
  );
}
