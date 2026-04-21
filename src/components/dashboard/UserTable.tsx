"use client";

import { useState, useMemo } from "react";
import type { ReferredUser } from "@/types/database";
import { fmt } from "@/lib/fmt";

interface Props {
  users: ReferredUser[];
}

export default function UserTable({ users }: Props) {
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let result = users;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (u) =>
          (u.full_name ?? "").toLowerCase().includes(q) ||
          (u.email ?? "").toLowerCase().includes(q)
      );
    }

    return [...result].sort((a, b) => {
      const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
      return sortOrder === "desc" ? bDate - aDate : aDate - bDate;
    });
  }, [users, sortOrder, search]);

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
          <h3 className="text-sm font-semibold text-gray-900 flex-1">
            Referred Users
            <span className="ml-2 text-xs font-normal text-brand-400">{users.length} total</span>
          </h3>

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
              className="pl-8 pr-3 py-1.5 text-xs bg-white border border-surface-200 rounded-xl
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
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-surface-200/60 bg-surface-100/40">
              <th className="th">Name</th>
              <th className="th hidden md:table-cell">Email</th>
              <th className="th hidden lg:table-cell">Phone</th>
              <th className="th hidden sm:table-cell">Referred</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-200/60">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-12 text-center">
                  <p className="text-sm font-medium text-gray-900">No results</p>
                  <p className="text-xs text-brand-400 mt-0.5">No users match your search.</p>
                </td>
              </tr>
            ) : (
              filtered.map((user) => (
                <tr key={user.id} className="hover:bg-surface-50/80 transition-colors duration-100">
                  <td className="td">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-brand-600">
                          {(user.full_name ?? "?").charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate" title={user.full_name ?? ""}>
                          {user.full_name ?? "—"}
                        </p>
                        <p className="text-xs text-brand-400 mt-0.5 truncate md:hidden" title={user.email ?? ""}>
                          {user.email ?? "—"}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="td text-sm text-brand-400 hidden md:table-cell truncate max-w-[200px]" title={user.email ?? ""}>
                    {user.email ?? "—"}
                  </td>
                  <td className="td text-sm text-brand-400 hidden lg:table-cell whitespace-nowrap">
                    {user.phone ?? "—"}
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
        {search && (
          <button onClick={() => setSearch("")} className="text-xs text-accent hover:text-accent/80 transition-colors">
            Clear search
          </button>
        )}
      </div>
    </div>
  );
}
