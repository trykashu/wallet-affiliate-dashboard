"use client";

import { useState, useMemo } from "react";
import type { Earning, EarningStatus, AffiliateTier } from "@/types/database";
import { fmt } from "@/lib/fmt";

interface EarningWithUser extends Earning {
  user_name: string;
}

interface Props {
  earnings: EarningWithUser[];
}

// -- Status badge config ------------------------------------------------------

const STATUS_STYLES: Record<EarningStatus, { label: string; className: string }> = {
  pending:  { label: "Pending",  className: "bg-amber-50 text-amber-700 border border-amber-200" },
  approved: { label: "Approved", className: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  paid:     { label: "Paid",     className: "bg-brand-50 text-brand-600 border border-brand-200" },
  reversed: { label: "Reversed", className: "bg-red-50 text-red-700 border border-red-200" },
};

const TIER_STYLES: Record<AffiliateTier, { label: string; className: string }> = {
  gold:     { label: "Gold",     className: "bg-amber-50 text-amber-700 border border-amber-200" },
  platinum: { label: "Platinum", className: "bg-gradient-to-r from-slate-100 to-slate-200 text-slate-700 border border-slate-300" },
};

const FILTER_OPTIONS: { label: string; value: EarningStatus | "all" }[] = [
  { label: "All",      value: "all" },
  { label: "Pending",  value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Paid",     value: "paid" },
  { label: "Reversed", value: "reversed" },
];

// -- Component ----------------------------------------------------------------

export default function EarningsTable({ earnings }: Props) {
  const [activeFilter, setActiveFilter] = useState<EarningStatus | "all">("all");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");

  const filtered = useMemo(() => {
    const result =
      activeFilter === "all"
        ? earnings
        : earnings.filter((e) => e.status === activeFilter);

    return [...result].sort((a, b) => {
      const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
      return sortOrder === "desc" ? bDate - aDate : aDate - bDate;
    });
  }, [earnings, activeFilter, sortOrder]);

  const countByStatus = useMemo(() => {
    const counts: Record<string, number> = { all: earnings.length };
    for (const e of earnings) counts[e.status] = (counts[e.status] ?? 0) + 1;
    return counts;
  }, [earnings]);

  const hasActiveFilters = activeFilter !== "all";

  function clearAll() {
    setActiveFilter("all");
  }

  if (earnings.length === 0) {
    return (
      <div className="card p-16 text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-2xl bg-surface-100 flex items-center justify-center">
          <svg className="w-6 h-6 text-brand-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-900">No earnings yet</p>
        <p className="text-xs text-brand-400 mt-1">Earnings from your referrals will appear here.</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-surface-200/60">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-900 flex-1">Earnings History</h3>

          {/* Sort */}
          <button
            onClick={() => setSortOrder((s) => (s === "desc" ? "asc" : "desc"))}
            className="btn-ghost text-xs flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
            </svg>
            {sortOrder === "desc" ? "Newest first" : "Oldest first"}
          </button>
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-0.5 overflow-x-auto mt-3 -mb-[1px] scrollbar-none">
          {FILTER_OPTIONS.map((opt) => {
            const count = countByStatus[opt.value] ?? 0;
            if (opt.value !== "all" && count === 0) return null;
            const isActive = activeFilter === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setActiveFilter(opt.value)}
                className={`whitespace-nowrap px-3 py-2 text-xs font-medium border-b-2 transition-all duration-150
                  ${isActive
                    ? "border-accent text-gray-900"
                    : "border-transparent text-brand-400 hover:text-brand-600 hover:border-surface-200/80"
                  }`}
              >
                {opt.label}
                <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold
                  ${isActive ? "bg-accent/15 text-accent" : "bg-surface-100 text-brand-500"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-surface-200/60 bg-surface-100/40">
              <th className="th">Date</th>
              <th className="th">User</th>
              <th className="th hidden md:table-cell">Tier</th>
              <th className="th text-right">Commission</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-200/60">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center">
                  <div className="w-10 h-10 mx-auto mb-3 rounded-2xl bg-surface-100 flex items-center justify-center">
                    <svg className="w-5 h-5 text-brand-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-gray-900">No results</p>
                  <p className="text-xs text-brand-400 mt-0.5">No earnings match the current filter.</p>
                </td>
              </tr>
            ) : (
              filtered.map((earning) => {
                const statusStyle = STATUS_STYLES[earning.status];
                const tierStyle = TIER_STYLES[earning.tier_at_earning];
                return (
                  <tr key={earning.id} className="hover:bg-surface-50/80 transition-colors duration-100">
                    <td className="td text-xs text-brand-400 whitespace-nowrap">
                      {fmt.date(earning.created_at)}
                    </td>
                    <td className="td">
                      <p className="text-sm font-medium text-gray-900 truncate max-w-[180px]" title={earning.user_name}>
                        {earning.user_name}
                      </p>
                    </td>
                    <td className="td hidden md:table-cell">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${tierStyle.className}`}>
                        {tierStyle.label}
                      </span>
                    </td>
                    <td className="td text-sm font-semibold text-gray-900 text-right tabular-nums">
                      {fmt.currency(Number(earning.amount))}
                    </td>
                    <td className="td">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle.className}`}>
                        {statusStyle.label}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-surface-200/60 bg-surface-50/60 flex items-center justify-between">
        <p className="text-xs text-brand-400">
          Showing <span className="text-gray-900 font-medium">{filtered.length}</span> of{" "}
          <span className="text-gray-900 font-medium">{earnings.length}</span> earnings
        </p>
        {hasActiveFilters && (
          <button onClick={clearAll} className="text-xs text-accent hover:text-accent/80 transition-colors">
            Clear all filters
          </button>
        )}
      </div>
    </div>
  );
}
