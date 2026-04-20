"use client";

import { useState } from "react";
import { fmt } from "@/lib/fmt";
import type { Payout } from "@/types/database";

interface Props {
  payouts: Payout[];
  affiliateName?: string;
}

const STATUS_CLASSES: Record<string, string> = {
  requested:  "text-amber-400 bg-amber-400/5  border-amber-400/20",
  processing: "text-gray-600 bg-surface-100 border-surface-200/60",
  completed:  "text-accent    bg-accent/5     border-accent/20",
  failed:     "text-red-600   bg-red-50       border-red-200",
};

export default function PayoutHistory({ payouts, affiliateName = "Affiliate" }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-surface-200/60">
        <h3 className="text-sm font-semibold text-gray-900">Payout History</h3>
        <p className="text-xs text-brand-400 mt-0.5">{payouts.length} record{payouts.length !== 1 ? "s" : ""}</p>
      </div>

      {payouts.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="text-sm text-brand-400">No payouts yet. Payouts are processed automatically on the 15th of each month.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200/60 bg-surface-50/60">
                <th className="th">Date</th>
                <th className="th text-right">Amount</th>
                <th className="th text-right">Status</th>
                <th className="th text-right hidden sm:table-cell">Updated</th>
                <th className="th w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-200/60">
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 sm:px-5 py-3.5 text-sm text-brand-400">{fmt.date(p.created_at)}</td>
                  <td className="px-3 sm:px-5 py-3.5 text-right text-sm font-semibold text-gray-900">
                    {fmt.currency(p.amount)}
                  </td>
                  <td className="px-3 sm:px-5 py-3.5 text-right">
                    <span className={`text-[10px] px-2 py-0.5 rounded-md border capitalize ${STATUS_CLASSES[p.status] ?? ""}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-3 sm:px-5 py-3.5 text-right text-sm text-brand-400 hidden sm:table-cell">
                    {p.updated_at && p.updated_at !== p.created_at ? fmt.date(p.updated_at) : "—"}
                  </td>
                  <td className="px-3 sm:px-5 py-3.5 text-right">
                    {p.status === "completed" && (
                      <button
                        onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                        className="text-[10px] text-brand-600 hover:text-brand-700 font-medium hidden sm:inline"
                        title="Toggle details"
                      >
                        {expanded === p.id ? "Hide" : "Details"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}

              {/* Expanded detail rows rendered separately to avoid React key issues with fragments */}
              {payouts.filter((p) => expanded === p.id).map((p) => (
                <tr key={`${p.id}-detail`}>
                  <td colSpan={5} className="bg-surface-50/60 px-5 py-4">
                    <div className="max-w-md space-y-2">
                      <p className="text-xs font-semibold text-gray-900 uppercase tracking-wider">Payout Receipt</p>
                      <div className="grid grid-cols-2 gap-y-1.5 text-xs">
                        <span className="text-brand-400">Amount</span>
                        <span className="text-gray-900 font-medium text-right">{fmt.currency(p.amount)}</span>
                        <span className="text-brand-400">Currency</span>
                        <span className="text-gray-900 text-right">{p.currency}</span>
                        <span className="text-brand-400">Requested</span>
                        <span className="text-gray-900 text-right">{fmt.date(p.created_at)}</span>
                        {p.updated_at && p.updated_at !== p.created_at && (
                          <>
                            <span className="text-brand-400">Updated</span>
                            <span className="text-gray-900 text-right">{fmt.date(p.updated_at)}</span>
                          </>
                        )}
                        <span className="text-brand-400">Reference</span>
                        <span className="text-gray-900 text-right font-mono text-[10px]">{p.id.slice(0, 8).toUpperCase()}</span>
                      </div>
                      <button
                        onClick={() => window.print()}
                        className="mt-2 text-[10px] text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />
                        </svg>
                        Print Receipt
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
