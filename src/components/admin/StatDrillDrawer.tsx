"use client";

import { fmt } from "@/lib/fmt";
import DrillTrendChart from "./DrillTrendChart";

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
  /** Heading above the list (e.g. "Top contributors" vs "Recently added"). */
  listLabel?: string;
  /** Optional additions-by-month trend rendered above the list. */
  trend?: { label: string; value: number }[];
  trendCaption?: string;
}

export default function StatDrillDrawer({
  open, onClose, rows, headlineLabel, headlineValue, emptyHint, formatValue,
  listLabel = "Top contributors", trend, trendCaption,
}: Props) {
  if (!open) return null;

  const isCurrency = open === "volume" || open === "earnings";
  const sensAttr = isCurrency ? { "data-sensitive": "" } : {};

  return (
    <>
      <div className="drawer-backdrop fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div
        className="drawer-panel fixed inset-y-0 right-0 w-full max-w-md p-6 z-50 overflow-y-auto"
        style={{ backgroundColor: "var(--ad-surface)", borderLeft: "1px solid var(--ad-border)" }}
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="ad-label">{headlineLabel}</p>
            <p className="text-[28px] font-semibold ad-num ad-text-1 mt-1" {...sensAttr}>{headlineValue}</p>
          </div>
          <button
            onClick={onClose}
            className="text-sm ad-text-3 hover:!text-[#F4F5F7]"
            aria-label="Close drawer"
          >
            Close
          </button>
        </div>

        {trend && <DrillTrendChart series={trend} caption={trendCaption ?? "Added"} />}

        <h3 className="ad-label mb-2">{listLabel}</h3>

        {rows.length === 0 ? (
          <p className="ad-inset p-6 text-center text-sm ad-text-3">{emptyHint}</p>
        ) : (
          <ol className="space-y-0.5">
            {rows.map((r, i) => (
              <li
                key={r.affiliate_id}
                className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl ad-row hover:!bg-[#1A1F2A] transition-colors"
                style={{ borderTop: "none" }}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="text-[10px] font-semibold ad-text-3 tabular-nums w-5 text-right flex-shrink-0">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold ad-text-1 truncate">{r.agent_name}</p>
                    {r.sub && <p className="text-[10px] ad-text-3 truncate">{r.sub}</p>}
                  </div>
                </div>
                <span className="text-sm font-bold ad-text-1 tabular-nums flex-shrink-0" {...sensAttr}>
                  {formatValue(r.value)}
                </span>
              </li>
            ))}
          </ol>
        )}

        <div className="mt-5 pt-4 ad-divider">
          <a
            href={destinationFor(open)}
            className="inline-flex items-center gap-1 text-xs font-semibold ad-accent-text hover:underline"
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
