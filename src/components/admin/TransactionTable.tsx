"use client";

import { useState, useMemo } from "react";
import { fmt } from "@/lib/fmt";

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
          <h3 className="text-sm font-semibold text-gray-900">Transactions</h3>
          <p className="text-xs text-brand-400 mt-0.5">
            {search || affiliateFilter !== "all"
              ? `${sorted.length} of ${transactions.length}`
              : transactions.length}{" "}
            transactions
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[140px] max-w-xs">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-400 pointer-events-none" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              placeholder="Search email, affiliate, txn ID, last 4, or issuer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-surface-200 bg-white text-gray-900 placeholder-brand-400/50 focus:outline-none focus:ring-1 focus:ring-brand-600/30 focus:border-brand-400"
            />
          </div>
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
              <th className="th"><SortBtn col="date" label="Date" /></th>
              <th className="th hidden sm:table-cell">User Email</th>
              <th className="th hidden md:table-cell">Affiliate</th>
              <th className="th"><SortBtn col="amount" label="Amount" /></th>
              <th className="th hidden lg:table-cell">Card</th>
              <th className="th">Funnel %</th>
              <th className="th hidden lg:table-cell">Transaction ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-200/60">
            {sorted.map((tx) => (
              <tr key={tx.id} className="hover:bg-surface-100/40 transition-colors">
                <td className="td">
                  <span className="text-xs text-brand-400">
                    {tx.transaction_date ? fmt.date(tx.transaction_date) : fmt.date(tx.created_at)}
                  </span>
                </td>
                <td className="td hidden sm:table-cell">
                  <span className="text-xs text-brand-400">{tx.user_email ?? "\u2014"}</span>
                </td>
                <td className="td hidden md:table-cell">
                  <span className="text-xs text-gray-700 font-medium">{tx.affiliate_name ?? "\u2014"}</span>
                </td>
                <td className="td">
                  <span className="text-sm font-semibold text-gray-900 tabular-nums">
                    {fmt.currency(tx.amount)}
                  </span>
                </td>
                <td className="td hidden lg:table-cell">
                  {tx.card_last4 ? (
                    <span className="text-xs text-gray-700 font-mono tabular-nums">
                      {tx.card_issuer ? <span className="text-brand-400 mr-1">{tx.card_issuer}</span> : null}
                      &middot;&middot;&middot;&middot; {tx.card_last4}
                    </span>
                  ) : (
                    <span className="text-xs text-brand-400">&mdash;</span>
                  )}
                </td>
                <td className="td">
                  <span className="text-xs text-brand-400 tabular-nums">
                    {tx.funnel_percent != null
                      ? `${Number(tx.funnel_percent).toFixed(Number(tx.funnel_percent) % 1 === 0 ? 0 : 2).replace(/\.?0+$/, "")}%`
                      : "\u2014"}
                  </span>
                </td>
                <td className="td hidden lg:table-cell">
                  <span className="text-[11px] text-brand-400 font-mono">
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
                <td colSpan={7} className="px-5 py-10 text-center text-sm text-brand-400">
                  No transactions match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 border-t border-surface-200/60 bg-surface-50/60">
        <p className="text-xs text-brand-400">
          {search || affiliateFilter !== "all"
            ? `${sorted.length} of ${transactions.length}`
            : transactions.length}{" "}
          transactions total
        </p>
      </div>
    </div>
  );
}
