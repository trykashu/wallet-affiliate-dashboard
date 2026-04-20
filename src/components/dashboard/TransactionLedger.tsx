"use client";

import { useState, useMemo } from "react";
import { fmt } from "@/lib/fmt";
import type { Transaction } from "@/types/database";

interface TransactionWithUser extends Transaction {
  user_name: string | null;
  user_email: string | null;
}

interface Props {
  transactions: TransactionWithUser[];
}

const TYPE_STYLES: Record<string, { label: string; className: string }> = {
  "Transfer In": {
    label: "Transfer In",
    className: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  },
  "Transfer Out": {
    label: "Transfer Out",
    className: "bg-amber-50 text-amber-700 border border-amber-200",
  },
};

export default function TransactionLedger({ transactions }: Props) {
  const [filter, setFilter] = useState<"all" | "Transfer In" | "Transfer Out">("all");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");

  const filtered = useMemo(() => {
    const result = filter === "all"
      ? transactions
      : transactions.filter((t) => t.transaction_type === filter);

    return [...result].sort((a, b) => {
      const aDate = a.transaction_date ? new Date(a.transaction_date).getTime() : 0;
      const bDate = b.transaction_date ? new Date(b.transaction_date).getTime() : 0;
      return sortOrder === "desc" ? bDate - aDate : aDate - bDate;
    });
  }, [transactions, filter, sortOrder]);

  const totalIn = useMemo(
    () => transactions.filter((t) => t.transaction_type === "Transfer In").reduce((s, t) => s + t.amount, 0),
    [transactions]
  );

  if (transactions.length === 0) {
    return (
      <div className="card p-16 text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-2xl bg-surface-100 flex items-center justify-center">
          <svg className="w-6 h-6 text-brand-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-900">No transactions yet</p>
        <p className="text-xs text-brand-400 mt-1">Transactions from your referred users will appear here.</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-surface-200/60">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900">Transaction Ledger</h3>
            <p className="text-xs text-brand-400 mt-0.5">
              {fmt.count(transactions.length)} transactions
              {totalIn > 0 && <> &middot; <span className="text-accent font-medium">{fmt.currencyCompact(totalIn)}</span> total volume</>}
            </p>
          </div>

          {/* Filter */}
          <div className="flex gap-1.5">
            {(["all", "Transfer In", "Transfer Out"] as const).map((val) => {
              const isActive = filter === val;
              const label = val === "all" ? "All" : val;
              return (
                <button
                  key={val}
                  onClick={() => setFilter(val)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                    isActive
                      ? "bg-brand-600 text-white"
                      : "bg-surface-100 text-brand-400 hover:text-gray-900"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Sort */}
          <button
            onClick={() => setSortOrder((s) => (s === "desc" ? "asc" : "desc"))}
            className="btn-ghost text-xs flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
            </svg>
            {sortOrder === "desc" ? "Newest" : "Oldest"}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-surface-200/60 bg-gray-50/60">
              <th className="th">Date</th>
              <th className="th">User</th>
              <th className="th text-right">Amount</th>
              <th className="th hidden sm:table-cell">Type</th>
              <th className="th hidden md:table-cell">Transaction ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-200/60">
            {filtered.map((txn) => {
              const typeStyle = TYPE_STYLES[txn.transaction_type] ?? {
                label: txn.transaction_type,
                className: "bg-gray-50 text-gray-700 border border-gray-200",
              };
              return (
                <tr key={txn.id} className="hover:bg-surface-50/80 transition-colors duration-100">
                  <td className="td text-xs text-brand-400 whitespace-nowrap">
                    {txn.transaction_date ? fmt.date(txn.transaction_date) : "—"}
                  </td>
                  <td className="td">
                    <p className="text-sm font-medium text-gray-900 truncate max-w-[180px]">
                      {txn.user_name ?? txn.user_email ?? txn.email ?? "Unknown"}
                    </p>
                    {txn.user_email && txn.user_name && (
                      <p className="text-xs text-brand-400 truncate max-w-[180px] hidden md:block">
                        {txn.user_email}
                      </p>
                    )}
                  </td>
                  <td className="td text-sm font-semibold text-gray-900 text-right tabular-nums">
                    {fmt.currency(txn.amount)}
                  </td>
                  <td className="td hidden sm:table-cell">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${typeStyle.className}`}>
                      {typeStyle.label}
                    </span>
                  </td>
                  <td className="td hidden md:table-cell">
                    <span className="text-xs text-brand-400 font-mono truncate max-w-[150px] block">
                      {txn.transaction_external_id || "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-surface-200/60 bg-surface-50/60">
        <p className="text-xs text-brand-400">
          Showing <span className="text-gray-900 font-medium">{filtered.length}</span> of{" "}
          <span className="text-gray-900 font-medium">{transactions.length}</span> transactions
        </p>
      </div>
    </div>
  );
}
