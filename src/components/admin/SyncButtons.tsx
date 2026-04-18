"use client";

import { useState } from "react";

type SyncType = "affiliates" | "transactions" | "all";

interface SyncResult {
  type: string;
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export default function SyncButtons() {
  const [loading, setLoading] = useState<SyncType | null>(null);
  const [lastResult, setLastResult] = useState<{
    type: SyncType;
    results: Record<string, SyncResult>;
    time: string;
  } | null>(null);

  async function runSync(type: SyncType) {
    setLoading(type);
    setLastResult(null);
    try {
      const res = await fetch(`/api/trigger/sync?type=${type}`, {
        headers: { "x-api-key": "" }, // key checked via query param on server if needed
      });
      const data = await res.json();
      setLastResult({
        type,
        results: data.results ?? {},
        time: new Date().toLocaleTimeString(),
      });
    } catch {
      setLastResult({
        type,
        results: { error: { type, ok: false, error: "Request failed" } },
        time: new Date().toLocaleTimeString(),
      });
    } finally {
      setLoading(null);
    }
  }

  function getSummary(result: SyncResult): string {
    if (!result.ok) return result.error ?? "Failed";
    const d = result.data as Record<string, number> | undefined;
    if (!d) return "Done";
    const parts: string[] = [];
    if (d.total_fetched != null) parts.push(`${d.total_fetched} fetched`);
    if (d.upserted != null) parts.push(`${d.upserted} synced`);
    if (d.matched != null) parts.push(`${d.matched} matched`);
    if (d.earnings_created != null && d.earnings_created > 0)
      parts.push(`${d.earnings_created} earnings`);
    if (d.tier_upgrades != null && d.tier_upgrades > 0)
      parts.push(`${d.tier_upgrades} upgrades`);
    return parts.join(", ") || "Done";
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-surface-200/60 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Data Sync</h3>
          <p className="text-xs text-brand-400 mt-0.5">
            Sync data from Airtable and HighLevel
          </p>
        </div>
        {lastResult && (
          <span className="text-[10px] text-brand-400">
            Last run: {lastResult.time}
          </span>
        )}
      </div>

      <div className="px-5 py-4 flex flex-wrap gap-3">
        <button
          onClick={() => runSync("affiliates")}
          disabled={loading !== null}
          className="btn-primary text-sm px-4 py-2 rounded-xl inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading === "affiliates" ? (
            <Spinner />
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          )}
          Sync Affiliates
        </button>

        <button
          onClick={() => runSync("transactions")}
          disabled={loading !== null}
          className="btn-primary text-sm px-4 py-2 rounded-xl inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading === "transactions" ? (
            <Spinner />
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          Sync Transactions
        </button>

        <button
          onClick={() => runSync("all")}
          disabled={loading !== null}
          className="btn-accent text-sm px-4 py-2 rounded-xl inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading === "all" ? (
            <Spinner />
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          Sync All
        </button>
      </div>

      {/* Results */}
      {lastResult && (
        <div className="px-5 pb-4">
          <div className="space-y-2">
            {Object.entries(lastResult.results).map(([key, result]) => (
              <div
                key={key}
                className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
                  result.ok
                    ? "bg-accent/[0.06] text-gray-900"
                    : "bg-red-50 text-red-700"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    result.ok ? "bg-accent" : "bg-red-500"
                  }`}
                />
                <span className="font-medium capitalize">{key}:</span>
                <span className="text-brand-400">{getSummary(result)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
