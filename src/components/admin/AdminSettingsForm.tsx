"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/fmt";
import type { PayoutSettings, PayoutProvider } from "@/types/database";

const PROVIDERS: { value: PayoutProvider; label: string }[] = [
  { value: "mercury",        label: "Mercury (ACH)" },
  { value: "stripe_connect", label: "Stripe Connect" },
  { value: "manual",         label: "Manual" },
];

export default function AdminSettingsForm({
  settings,
}: {
  settings: PayoutSettings | null;
}) {
  const router = useRouter();
  const [minPayout, setMinPayout] = useState(settings?.min_payout_amount ?? 25);
  const [provider, setProvider] = useState<PayoutProvider>(settings?.default_provider ?? "mercury");
  const [autoApprove, setAutoApprove] = useState(settings?.auto_approve_earnings ?? false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/admin/payout-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          min_payout_amount: minPayout,
          default_provider: provider,
          auto_approve_earnings: autoApprove,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 3000);
    } catch {
      alert("Failed to save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [minPayout, provider, autoApprove, router]);

  return (
    <div className="grid gap-6 max-w-2xl">
      {/* Payout Settings Card */}
      <div className="card p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-5">Payout Configuration</h3>

        <div className="space-y-5">
          {/* Min payout */}
          <div>
            <label className="block text-xs text-gray-700 font-medium mb-1.5">
              Minimum Payout Amount
            </label>
            <div className="relative max-w-xs">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-brand-400">$</span>
              <input
                type="number"
                min={1}
                step={1}
                value={minPayout}
                onChange={(e) => setMinPayout(Number(e.target.value))}
                className="w-full pl-7 pr-3 py-2 text-sm rounded-xl border border-gray-200 bg-white text-gray-900
                           focus:outline-none focus:ring-1 focus:ring-brand-600/30 focus:border-brand-400"
              />
            </div>
            <p className="text-[10px] text-brand-400 mt-1">
              Affiliates must have at least this amount in approved earnings to receive a payout.
            </p>
          </div>

          {/* Default provider */}
          <div>
            <label className="block text-xs text-gray-700 font-medium mb-1.5">
              Default Payout Provider
            </label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as PayoutProvider)}
              className="max-w-xs w-full text-sm rounded-xl border border-gray-200 bg-white text-gray-900 px-3 py-2
                         focus:outline-none focus:ring-1 focus:ring-brand-600/30 focus:border-brand-400"
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          {/* Auto-approve */}
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="auto-approve"
              checked={autoApprove}
              onChange={(e) => setAutoApprove(e.target.checked)}
              className="mt-0.5 rounded border-gray-300"
            />
            <div>
              <label htmlFor="auto-approve" className="text-xs text-gray-700 font-medium cursor-pointer">
                Auto-Approve Earnings
              </label>
              <p className="text-[10px] text-brand-400 mt-0.5">
                When enabled, new earnings will be automatically approved instead of requiring manual review.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700
                       rounded-lg px-4 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : null}
            Save Settings
          </button>
          {saved && (
            <span className="text-xs text-accent font-medium">Settings saved successfully.</span>
          )}
        </div>
      </div>

      {/* Tier Info Card (read-only) */}
      <div className="card p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Tier Thresholds</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b border-surface-200/60">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="text-xs font-medium text-gray-700">Gold</span>
            </div>
            <span className="text-xs text-brand-400">Default tier</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-400" />
              <span className="text-xs font-medium text-gray-700">Platinum</span>
            </div>
            <span className="text-xs text-brand-400">{fmt.currencyCompact(100000)} referred volume</span>
          </div>
        </div>
        <p className="text-[10px] text-brand-400 mt-3">
          Tier upgrades are automatic based on referred volume, or can be overridden per affiliate.
        </p>
      </div>
    </div>
  );
}
