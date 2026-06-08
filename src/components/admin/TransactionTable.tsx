"use client";

import { useState, useMemo } from "react";
import { fmt } from "@/lib/fmt";
import Money from "./Money";

export interface AdminTransaction {
  id: string;
  affiliate_id: string | null;
  affiliate_name: string | null;
  user_email: string | null;
  amount: number;
  transaction_type: string;
  transaction_external_id: string | null;
  transaction_date: string | null;
  created_at: string;
  card_last4: string | null;
  card_issuer: string | null;
  funnel_percent: number | null;
}

type SortKey = "date" | "amount";

export default function TransactionTable({
  transactions,
  affiliateNames,
}: {
  transactions: AdminTransaction[];
  affiliateNames: { id: string; name: string }[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [search, setSearch] = useState("");
  const [affiliateFilter, setAffiliateFilter] = useState<string>("all");

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  const filtered = useMemo(() => {
    let list = transactions;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (tx) =>
          (tx.user_email?.toLowerCase().includes(q) ?? false) ||
          (tx.affiliate_name?.toLowerCase().includes(q) ?? false) ||
          (tx.transaction_external_id?.toLowerCase().includes(q) ?? false) ||
          (tx.card_last4?.includes(q) ?? false) ||
          (tx.card_issuer?.toLowerCase().includes(q) ?? false)
      );
    }
    if (affiliateFilter !== "all") list = list.filter((tx) => tx.affiliate_id === affiliateFilter);
    return list;
  }, [transactions, search, affiliateFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortKey === "amount") {
        return sortDir === "desc" ? b.amount - a.amount : a.amount - b.amount;
      }
      // date
      const aDate = new Date(a.transaction_date ?? a.created_at).getTime();
      const bDate = new Date(b.transaction_date ?? b.created_at).getTime();
      return sortDir === "desc" ? bDate - aDate : aDate - bDate;
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
          <h3 className="text-sm font-semibold ad-text-1">Transactions</h3>
          <p className="text-[11px] ad-text-3 mt-0.5">
            {search || affiliateFilter !== "all"
              ? `${sorted.length} of ${transactions.length}`
              : transactions.length}{" "}
            transactions
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[140px] max-w-xs">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--ad-text-3)] pointer-events-none" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              placeholder="Search email, affiliate, txn ID, last 4, or issuer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs ad-input"
            />
          </div>
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
              <th className="ad-th"><SortBtn col="date" label="Date" /></th>
              <th className="ad-th hidden sm:table-cell">User Email</th>
              <th className="ad-th hidden md:table-cell">Affiliate</th>
              <th className="ad-th"><SortBtn col="amount" label="Amount" /></th>
              <th className="ad-th hidden lg:table-cell">Card</th>
              <th className="ad-th">Funnel %</th>
              <th className="ad-th hidden lg:table-cell">Transaction ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ad-border)]">
            {sorted.map((tx) => (
              <tr key={tx.id} className="hover:bg-[var(--ad-surface-2)] transition-colors">
                <td className="ad-td">
                  <span className="text-xs ad-text-3">
                    {tx.transaction_date ? fmt.date(tx.transaction_date) : fmt.date(tx.created_at)}
                  </span>
                </td>
                <td className="ad-td hidden sm:table-cell">
                  <span className="text-xs ad-text-3">{tx.user_email ?? "\u2014"}</span>
                </td>
                <td className="ad-td hidden md:table-cell">
                  <span className="text-xs ad-text-2 font-medium">{tx.affiliate_name ?? "\u2014"}</span>
                </td>
                <td className="ad-td">
                  <Money value={tx.amount} className="text-sm font-semibold ad-text-1" />
                </td>
                <td className="ad-td hidden lg:table-cell">
                  {tx.card_last4 ? (
                    <span className="text-xs ad-text-2 font-mono tabular-nums">
                      {tx.card_issuer ? <span className="ad-text-3 mr-1">{tx.card_issuer}</span> : null}
                      &middot;&middot;&middot;&middot; {tx.card_last4}
                    </span>
                  ) : (
                    <span className="text-xs ad-text-3">&mdash;</span>
                  )}
                </td>
                <td className="ad-td">
                  <span className="text-xs ad-text-3 tabular-nums">
                    {tx.funnel_percent != null
                      ? `${Number(tx.funnel_percent).toFixed(Number(tx.funnel_percent) % 1 === 0 ? 0 : 2).replace(/\.?0+$/, "")}%`
                      : "\u2014"}
                  </span>
                </td>
                <td className="ad-td hidden lg:table-cell">
                  <span className="text-[11px] ad-text-3 font-mono">
                    {tx.transaction_external_id
                      ? (tx.transaction_external_id.length > 16
                          ? tx.transaction_external_id.slice(0, 16) + "\u2026"
                          : tx.transaction_external_id)
                      : "\u2014"}
                  </span>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-sm ad-text-3">
                  No transactions match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 border-t border-[var(--ad-border)] bg-[var(--ad-inset)]">
        <p className="text-xs ad-text-3">
          {search || affiliateFilter !== "all"
            ? `${sorted.length} of ${transactions.length}`
            : transactions.length}{" "}
          transactions total
        </p>
      </div>
    </div>
  );
}
