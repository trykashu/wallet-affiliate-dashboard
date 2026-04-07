"use client";

import { useState, useMemo } from "react";
import type { ReferredUser, FunnelStatus, FunnelStatusSlug } from "@/types/database";
import { fmt } from "@/lib/fmt";
import { funnelColor, funnelLabel, funnelLabelColor } from "@/lib/funnel-colors";

interface Props {
  users: ReferredUser[];
  funnelStatuses: FunnelStatus[];
}

// -- Helpers ------------------------------------------------------------------

function StatusBadge({ slug }: { slug: FunnelStatusSlug }) {
  const bg = funnelColor(slug);
  const label = funnelLabel(slug);
  const labelClr = funnelLabelColor(slug);
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: bg + "22",
        color: labelClr,
        border: `1px solid ${bg}44`,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full mr-1.5 flex-shrink-0"
        style={{ backgroundColor: bg }}
      />
      {label}
    </span>
  );
}

// -- Component ----------------------------------------------------------------

export default function UserTable({ users, funnelStatuses }: Props) {
  const [activeFilter, setActiveFilter] = useState<FunnelStatusSlug | "all">("all");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [search, setSearch] = useState("");

  // Build filter options from funnel_statuses (sorted by sort_order)
  const filterOptions = useMemo(() => {
    const sorted = [...funnelStatuses].sort((a, b) => a.sort_order - b.sort_order);
    return [
      { label: "All", value: "all" as const },
      ...sorted.map((s) => ({ label: s.label, value: s.slug })),
    ];
  }, [funnelStatuses]);

  const filtered = useMemo(() => {
    let result =
      activeFilter === "all"
        ? users
        : users.filter((u) => u.status_slug === activeFilter);

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (u) =>
          u.full_name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
      );
    }

    return [...result].sort((a, b) => {
      const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
      return sortOrder === "desc" ? bDate - aDate : aDate - bDate;
    });
  }, [users, activeFilter, sortOrder, search]);

  const countByStatus = useMemo(() => {
    const counts: Record<string, number> = { all: users.length };
    for (const u of users) counts[u.status_slug] = (counts[u.status_slug] ?? 0) + 1;
    return counts;
  }, [users]);

  const hasActiveFilters = !!search || activeFilter !== "all";

  function clearAll() {
    setSearch("");
    setActiveFilter("all");
  }

  if (users.length === 0) {
    return (
      <div className="card p-16 text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-2xl bg-surface-100 flex items-center justify-center">
          <svg className="w-6 h-6 text-brand-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128H5.228A2 2 0 013 17.208V5.792A2 2 0 015.228 3.872h13.544A2 2 0 0121 5.792v3.284M15 19.128a9.38 9.38 0 00-2.625.372M12 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-900">No referred users yet</p>
        <p className="text-xs text-brand-400 mt-1">Users you refer will appear here once they sign up.</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-surface-200/60">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-900 flex-1">All Users</h3>

          {/* Search */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-400" aria-hidden="true" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="search"
              placeholder="Search name, email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-white border border-gray-200 rounded-xl
                         text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2
                         focus:ring-brand-600/20 focus:border-brand-600/50 w-full sm:w-44 transition-all focus:sm:w-56"
            />
          </div>

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
          {filterOptions.map((opt) => {
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
            <tr className="border-b border-surface-200/60 bg-gray-50/60">
              <th className="th">Name</th>
              <th className="th hidden md:table-cell">Email</th>
              <th className="th hidden lg:table-cell">Phone</th>
              <th className="th">Status</th>
              <th className="th hidden sm:table-cell text-right">First Txn</th>
              <th className="th hidden sm:table-cell">Signed Up</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-200/60">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center">
                  <div className="w-10 h-10 mx-auto mb-3 rounded-2xl bg-surface-100 flex items-center justify-center">
                    <svg className="w-5 h-5 text-brand-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-gray-900">No results</p>
                  <p className="text-xs text-brand-400 mt-0.5">No users match the current filters.</p>
                </td>
              </tr>
            ) : (
              filtered.map((user) => (
                <tr key={user.id} className="hover:bg-surface-50/80 transition-colors duration-100">
                  <td className="td">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-brand-600">
                          {user.full_name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate" title={user.full_name}>
                          {user.full_name}
                        </p>
                        <p className="text-xs text-brand-400 mt-0.5 truncate md:hidden" title={user.email}>
                          {user.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="td text-sm text-brand-400 hidden md:table-cell truncate max-w-[200px]" title={user.email}>
                    {user.email}
                  </td>
                  <td className="td text-sm text-brand-400 hidden lg:table-cell whitespace-nowrap">
                    {user.phone ?? "\u2014"}
                  </td>
                  <td className="td">
                    <StatusBadge slug={user.status_slug} />
                  </td>
                  <td className="td text-sm text-brand-400 hidden sm:table-cell text-right tabular-nums">
                    {user.first_transaction_amount != null
                      ? fmt.currency(Number(user.first_transaction_amount))
                      : "\u2014"}
                  </td>
                  <td className="td text-xs text-brand-400 hidden sm:table-cell">
                    {fmt.date(user.created_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-surface-200/60 bg-surface-50/60 flex items-center justify-between">
        <p className="text-xs text-brand-400">
          Showing <span className="text-gray-900 font-medium">{filtered.length}</span> of{" "}
          <span className="text-gray-900 font-medium">{users.length}</span> users
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
