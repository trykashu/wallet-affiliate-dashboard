"use client";

import { fmt } from "@/lib/fmt";

export type StatKey = "affiliates" | "users" | "volume" | "earnings";

export interface StatRow {
  affiliate_id: string;
  agent_name: string;
  business_name: string | null;
  value: number;
  sub: string;
}

interface Props {
  open: StatKey | null;
  onClose: () => void;
  rows: StatRow[];
  headlineLabel: string;
  headlineValue: string;
  emptyHint: string;
  formatValue: (n: number) => string;
}

export default function StatDrillDrawer({
  open, onClose, rows, headlineLabel, headlineValue, emptyHint, formatValue,
}: Props) {
  if (!open) return null;

  return (
    <>
      <div className="drawer-backdrop fixed inset-0 bg-gray-900/30 z-40" onClick={onClose} />
      <div className="drawer-panel fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-card-md p-6 z-50 overflow-y-auto">
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">{headlineLabel}</p>
            <p className="text-display-sm font-bold tabular-nums text-gray-900 mt-1">{headlineValue}</p>
          </div>
          <button
            onClick={onClose}
            className="text-sm text-brand-400 hover:text-gray-900"
            aria-label="Close drawer"
          >
            Close
          </button>
        </div>

        <h3 className="text-[10px] font-bold text-brand-400 uppercase tracking-wider mb-2">Top contributors</h3>

        {rows.length === 0 ? (
          <p className="card p-6 text-center text-sm text-brand-400">{emptyHint}</p>
        ) : (
          <ol className="space-y-1">
            {rows.map((r, i) => (
              <li
                key={r.affiliate_id}
                className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-100/60 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="text-[10px] font-semibold text-brand-400 tabular-nums w-5 text-right flex-shrink-0">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{r.agent_name}</p>
                    {r.sub && <p className="text-[10px] text-brand-400 truncate">{r.sub}</p>}
                  </div>
                </div>
                <span className="text-sm font-bold text-gray-900 tabular-nums flex-shrink-0">
                  {formatValue(r.value)}
                </span>
              </li>
            ))}
          </ol>
        )}

        <div className="mt-5 pt-4 border-t border-surface-200/60">
          <a
            href={destinationFor(open)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
          >
            View all in {destinationLabel(open)}
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 8.25L21 12m0 0l-3.75 3.75M21 12H3" />
            </svg>
          </a>
        </div>
      </div>
    </>
  );
}

function destinationFor(key: StatKey): string {
  if (key === "affiliates") return "/admin/affiliates";
  if (key === "users") return "/admin/users";
  if (key === "volume") return "/admin/transactions";
  return "/admin/earnings";
}
function destinationLabel(key: StatKey): string {
  if (key === "affiliates") return "Affiliates";
  if (key === "users") return "Users";
  if (key === "volume") return "Transactions";
  return "Earnings";
}

// Re-export formatter helpers callers will use to feed `formatValue`.
export const formatCount = (n: number) => fmt.count(n);
export const formatCurrency = (n: number) => fmt.currency(n);
export const formatRelative = (_n: number) => "—"; // for the affiliates stat (no numeric value)
