"use client";

import { useState } from "react";
import { fmt } from "@/lib/fmt";
import type { PayoutAccount } from "@/types/database";

interface Props {
  available:    number;
  account:      PayoutAccount | null;
  affiliateId:  string;
  minAmount?:   number;
  onSuccess:    () => void;
  onClose:      () => void;
}

export default function PayoutRequestModal({ available, account, affiliateId, minAmount = 25, onSuccess, onClose }: Props) {
  const [amount, setAmount]   = useState(available.toFixed(2));
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    if (parsed < minAmount) {
      setError(`Minimum payout amount is ${fmt.currency(minAmount)}.`);
      return;
    }
    if (parsed > available) {
      setError(`Maximum available is ${fmt.currency(available)}.`);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/payouts/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: parsed, account_id: account?.id ?? null }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json();
        setError(msg ?? "Failed to request payout.");
        return;
      }
      onSuccess();
      onClose();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-sm bg-white border border-surface-200/60 rounded-2xl shadow-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">Request Payout</h3>
          <button onClick={onClose} className="text-brand-400 hover:text-gray-900 p-1 rounded-lg hover:bg-surface-100 transition-all">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-xs text-brand-400 mb-4">
          Available balance: <span className="text-accent font-semibold">{fmt.currency(available)}</span>
          <span className="ml-2">· Minimum: {fmt.currency(minAmount)}</span>
        </p>

        {!account && (
          <div className="mb-4 px-3 py-2.5 bg-amber-400/5 border border-amber-400/20 rounded-xl text-xs text-amber-400">
            No payout account connected. Add your bank account to receive funds.
          </div>
        )}

        {available <= 0 && (
          <div className="mb-4 px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl text-center">
            <p className="text-sm font-medium text-gray-900">No balance available</p>
            <p className="text-xs text-brand-400 mt-1">Commissions will appear here once your referred users are actively transacting and earnings are confirmed.</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Amount (USD)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-400 text-sm">$</span>
              <input
                type="number"
                step="0.01"
                min="1"
                max={available}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-7 pr-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/50"
                required
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 btn-ghost text-sm py-2">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || available <= 0}
              className="flex-1 btn-primary text-sm py-2 disabled:opacity-60"
            >
              {loading ? "Requesting…" : "Request Payout"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
