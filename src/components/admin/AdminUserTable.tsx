"use client";

import { useState, useMemo } from "react";
import { fmt } from "@/lib/fmt";
import { funnelColor, funnelLabel } from "@/lib/funnel-colors";
import type { FunnelStatusSlug } from "@/types/database";

export interface AdminUser {
  id: string;
  full_name: string;
  email: string;
  affiliate_name: string;
  affiliate_id: string;
  status_slug: FunnelStatusSlug;
  first_transaction_amount: number | null;
  created_at: string;
}

type SortKey = "name" | "date";

function contrastText(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#1F2937" : "#FFFFFF";
}

const FUNNEL_STAGES: FunnelStatusSlug[] = [
  "waitlist",
  "booked_call",
  "sent_onboarding",
  "signed_up",
  "transaction_run",
  "funds_in_wallet",
  "ach_initiated",
  "funds_in_bank",
];

export default function AdminUserTable({
  users,
  affiliateNames,
}: {
  users: AdminUser[];
  affiliateNames: { id: string; name: string }[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<FunnelStatusSlug | "all">("all");
  const [affiliateFilter, setAffiliateFilter] = useState<string>("all");

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  const filtered = useMemo(() => {
    let list = users;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (u) =>
          u.full_name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
      );
    }
    if (stageFilter !== "all") list = list.filter((u) => u.status_slug === stageFilter);
    if (affiliateFilter !== "all") list = list.filter((u) => u.affiliate_id === affiliateFilter);
    return list;
  }, [users, search, stageFilter, affiliateFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;
      if (sortKey === "name") {
        aVal = a.full_name.toLowerCase();
        bVal = b.full_name.toLowerCase();
        return sortDir === "desc"
          ? bVal.localeCompare(aVal as string)
          : (aVal as string).localeCompare(bVal as string);
      }
      aVal = new Date(a.created_at).getTime();
      bVal = new Date(b.created_at).getTime();
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
  }, [filtered, sortKey, sortDir]);

  function SortBtn({ col, label }: { col: SortKey; label: string }) {
    const active = sortKey === col;
    return (
      <button
        onClick={() => toggleSort(col)}
        className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.1em] transition-colors ${
          active ? "text-accent" : "text-brand-400 hover:text-brand-600"
        }`}
      >
        {label}
        <span className="text-[10px]">{active ? (sortDir === "desc" ? "\u2193" : "\u2191") : ""}</span>
      </button>
    );
  }

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-surface-200/60 flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Referred Users</h3>
          <p className="text-xs text-brand-400 mt-0.5">
            {search || stageFilter !== "all" || affiliateFilter !== "all"
              ? `${sorted.length} of ${users.length}`
              : users.length}{" "}
            users
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[140px] max-w-xs">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-400 pointer-events-none" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-surface-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-brand-600/30 focus:border-brand-400"
            />
          </div>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value as FunnelStatusSlug | "all")}
            className="text-xs rounded-lg border border-surface-200 bg-white text-gray-900 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-600/30"
          >
            <option value="all">All stages</option>
            {FUNNEL_STAGES.map((s) => (
              <option key={s} value={s}>{funnelLabel(s)}</option>
            ))}
          </select>
          <select
            value={affiliateFilter}
            onChange={(e) => setAffiliateFilter(e.target.value)}
            className="text-xs rounded-lg border border-surface-200 bg-white text-gray-900 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-600/30"
          >
            <option value="all">All affiliates</option>
            {affiliateNames.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-surface-200/60 bg-surface-50/60">
              <th className="th"><SortBtn col="name" label="Name" /></th>
              <th className="th hidden sm:table-cell">Email</th>
              <th className="th hidden md:table-cell">Affiliate</th>
              <th className="th">Funnel Stage</th>
              <th className="th hidden lg:table-cell">First Txn</th>
              <th className="th"><SortBtn col="date" label="Signed Up" /></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-200/60">
            {sorted.map((u) => {
              const bg = funnelColor(u.status_slug);
              const fg = contrastText(bg);
              return (
                <tr key={u.id} className="hover:bg-surface-100/40 transition-colors">
                  <td className="td">
                    <span className="text-sm font-semibold text-gray-900">{u.full_name}</span>
                  </td>
                  <td className="td hidden sm:table-cell">
                    <span className="text-xs text-brand-400">{u.email}</span>
                  </td>
                  <td className="td hidden md:table-cell">
                    <span className="text-xs text-gray-700 font-medium">{u.affiliate_name}</span>
                  </td>
                  <td className="td">
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: bg, color: fg }}
                    >
                      {funnelLabel(u.status_slug)}
                    </span>
                  </td>
                  <td className="td hidden lg:table-cell">
                    <span className="text-sm text-gray-900 tabular-nums">
                      {u.first_transaction_amount != null
                        ? fmt.currency(u.first_transaction_amount)
                        : "\u2014"}
                    </span>
                  </td>
                  <td className="td">
                    <span className="text-xs text-brand-400">{fmt.date(u.created_at)}</span>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-sm text-brand-400">
                  No users match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 border-t border-surface-200/60 bg-surface-50/60">
        <p className="text-xs text-brand-400">
          {search || stageFilter !== "all" || affiliateFilter !== "all"
            ? `${sorted.length} of ${users.length}`
            : users.length}{" "}
          users total
        </p>
      </div>
    </div>
  );
}
