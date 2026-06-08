"use client";

import { useState, useMemo } from "react";
import { fmt } from "@/lib/fmt";
import Money from "./Money";
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
          active ? "text-[var(--ad-accent-strong)]" : "ad-text-3 hover:text-[var(--ad-text)]"
        }`}
      >
        {label}
        <span className="text-[10px]">{active ? (sortDir === "desc" ? "\u2193" : "\u2191") : ""}</span>
      </button>
    );
  }

  return (
    <div className="ad-card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[var(--ad-border)] flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h3 className="text-sm font-semibold ad-text-1">Referred Users</h3>
          <p className="text-[11px] ad-text-3 mt-0.5">
            {search || stageFilter !== "all" || affiliateFilter !== "all"
              ? `${sorted.length} of ${users.length}`
              : users.length}{" "}
            users
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[140px] max-w-xs">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--ad-text-3)] pointer-events-none" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs ad-input"
            />
          </div>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value as FunnelStatusSlug | "all")}
            className="text-xs ad-select px-2.5 py-1.5"
          >
            <option value="all">All stages</option>
            {FUNNEL_STAGES.map((s) => (
              <option key={s} value={s}>{funnelLabel(s)}</option>
            ))}
          </select>
          <select
            value={affiliateFilter}
            onChange={(e) => setAffiliateFilter(e.target.value)}
            className="text-xs ad-select px-2.5 py-1.5"
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
            <tr className="border-b border-[var(--ad-border)] bg-[var(--ad-inset)]">
              <th className="ad-th"><SortBtn col="name" label="Name" /></th>
              <th className="ad-th hidden sm:table-cell">Email</th>
              <th className="ad-th hidden md:table-cell">Affiliate</th>
              <th className="ad-th">Funnel Stage</th>
              <th className="ad-th hidden lg:table-cell">First Txn</th>
              <th className="ad-th"><SortBtn col="date" label="Signed Up" /></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ad-border)]">
            {sorted.map((u) => {
              const bg = funnelColor(u.status_slug);
              const fg = contrastText(bg);
              return (
                <tr key={u.id} className="hover:bg-[var(--ad-surface-2)] transition-colors">
                  <td className="ad-td">
                    <span className="text-sm font-semibold ad-text-1">{u.full_name}</span>
                  </td>
                  <td className="ad-td hidden sm:table-cell">
                    <span className="text-xs ad-text-3">{u.email}</span>
                  </td>
                  <td className="ad-td hidden md:table-cell">
                    <span className="text-xs ad-text-2 font-medium">{u.affiliate_name}</span>
                  </td>
                  <td className="ad-td">
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: bg, color: fg }}
                    >
                      {funnelLabel(u.status_slug)}
                    </span>
                  </td>
                  <td className="ad-td hidden lg:table-cell">
                    {u.first_transaction_amount != null
                      ? <Money value={u.first_transaction_amount} className="text-sm ad-text-1" />
                      : <span className="text-sm ad-text-3">{"\u2014"}</span>}
                  </td>
                  <td className="ad-td">
                    <span className="text-xs ad-text-3">{fmt.date(u.created_at)}</span>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-sm ad-text-3">
                  No users match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 border-t border-[var(--ad-border)] bg-[var(--ad-inset)]">
        <p className="text-xs ad-text-3">
          {search || stageFilter !== "all" || affiliateFilter !== "all"
            ? `${sorted.length} of ${users.length}`
            : users.length}{" "}
          users total
        </p>
      </div>
    </div>
  );
}
