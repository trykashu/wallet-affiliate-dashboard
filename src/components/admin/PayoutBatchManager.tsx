"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/fmt";
import type { PayoutStatus } from "@/types/database";

export interface PayoutRow {
  id: string;
  affiliate_id: string;
  affiliate_name: string;
  amount: number;
  status: PayoutStatus;
  provider_reference_id: string | null;
  period: string | null;
  created_at: string;
}

export interface PendingAffiliatePayout {
  affiliate_id: string;
  affiliate_name: string;
  approved_balance: number;
}

export default function PayoutBatchManager({
  payouts,
  pendingPayouts,
}: {
  payouts: PayoutRow[];
  pendingPayouts: PendingAffiliatePayout[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creatingBatch, setCreatingBatch] = useState(false);
  const [payingSingle, setPayingSingle] = useState<string | null>(null);
  const [executingBatch, setExecutingBatch] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [checkingMercury, setCheckingMercury] = useState(false);

  const requestedPayouts = payouts.filter((p) => p.status === "requested");
  const processingPayouts = payouts.filter((p) => p.status === "processing");

  // -- Selection --
  const allSelected = selected.size === pendingPayouts.length && pendingPayouts.length > 0;

  function toggleSelect(affId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(affId)) next.delete(affId);
      else next.add(affId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pendingPayouts.map((p) => p.affiliate_id)));
    }
  }

  // -- Create batch for selected --
  const handleCreateBatch = useCallback(async () => {
    if (selected.size === 0) return;
    const count = selected.size;
    const total = pendingPayouts
      .filter((p) => selected.has(p.affiliate_id))
      .reduce((s, p) => s + p.approved_balance, 0);

    if (!confirm(`Create payout batch for ${count} affiliate(s) totaling ${fmt.currency(total)}?`)) return;

    setCreatingBatch(true);
    try {
      const res = await fetch("/api/admin/payouts/create-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ affiliate_ids: Array.from(selected) }),
      });
      if (!res.ok) throw new Error("Failed");
      setSelected(new Set());
      router.refresh();
    } catch {
      alert("Failed to create payout batch. Please try again.");
    } finally {
      setCreatingBatch(false);
    }
  }, [selected, pendingPayouts, router]);

  // -- Create batch for single affiliate --
  const handlePaySingle = useCallback(async (affId: string, affName: string, amount: number) => {
    if (!confirm(`Create payout of ${fmt.currency(amount)} for ${affName}?`)) return;

    setPayingSingle(affId);
    try {
      const res = await fetch("/api/admin/payouts/create-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ affiliate_ids: [affId] }),
      });
      if (!res.ok) throw new Error("Failed");
      router.refresh();
    } catch {
      alert("Failed to create payout. Please try again.");
    } finally {
      setPayingSingle(null);
    }
  }, [router]);

  const handleExecuteBatch = useCallback(async () => {
    if (requestedPayouts.length === 0) return;
    if (!confirm(`Execute ${requestedPayouts.length} payout(s) via Mercury ACH?`)) return;

    setExecutingBatch(true);
    try {
      const res = await fetch("/api/admin/payouts/execute-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Failed");
      router.refresh();
    } catch {
      alert("Failed to execute payout batch. Please try again.");
    } finally {
      setExecutingBatch(false);
    }
  }, [requestedPayouts.length, router]);

  const handleUpdateStatus = useCallback(async (payoutId: string, newStatus: PayoutStatus) => {
    if (!confirm(`Mark this payout as "${newStatus}"?`)) return;

    setUpdatingId(payoutId);
    try {
      const res = await fetch("/api/admin/payouts/update-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payout_id: payoutId, status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed");
      router.refresh();
    } catch {
      alert("Failed to update payout status. Please try again.");
    } finally {
      setUpdatingId(null);
    }
  }, [router]);

  const handleCheckMercury = useCallback(async () => {
    setCheckingMercury(true);
    try {
      const res = await fetch("/api/cron/check-mercury-payouts");
      const data = await res.json();
      if (data.updated > 0) {
        router.refresh();
      } else {
        alert(`Checked ${data.checked} payout(s) — no status changes yet.`);
      }
    } catch {
      alert("Failed to check Mercury status.");
    } finally {
      setCheckingMercury(false);
    }
  }, [router]);

  const statusBadge = (status: PayoutStatus) => {
    const cls =
      status === "completed"  ? "badge-accent" :
      status === "processing" ? "badge-amber"  :
      status === "failed"     ? "badge-red"    : "badge-amber";
    return <span className={`badge ${cls}`}>{status}</span>;
  };

  const selectedTotal = pendingPayouts
    .filter((p) => selected.has(p.affiliate_id))
    .reduce((s, p) => s + p.approved_balance, 0);

  return (
    <div className="space-y-6">
      {/* Pending approved earnings ready for payout */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-200/60 flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Approved Balances</h3>
            <p className="text-xs text-brand-400 mt-0.5">
              Select affiliates to include in the payout batch
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <span className="text-xs text-brand-400">
                {selected.size} selected &middot; {fmt.currency(selectedTotal)}
              </span>
            )}
            <button
              onClick={handleCreateBatch}
              disabled={selected.size === 0 || creatingBatch}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700
                         rounded-lg px-3 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creatingBatch ? <Spinner /> : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              )}
              Create Batch ({selected.size})
            </button>
          </div>
        </div>

        {pendingPayouts.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-brand-400">No approved balances ready for payout.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-surface-200/60 bg-surface-50/60">
                  <th className="th w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-surface-200 text-brand-600 focus:ring-brand-600/20 cursor-pointer"
                    />
                  </th>
                  <th className="th">Affiliate</th>
                  <th className="th text-right">Approved Balance</th>
                  <th className="th w-24"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-200/60">
                {pendingPayouts.map((p) => {
                  const isSelected = selected.has(p.affiliate_id);
                  const isPaying = payingSingle === p.affiliate_id;
                  return (
                    <tr
                      key={p.affiliate_id}
                      className={`transition-colors cursor-pointer ${
                        isSelected ? "bg-brand-50/40" : "hover:bg-surface-100/40"
                      }`}
                      onClick={() => toggleSelect(p.affiliate_id)}
                    >
                      <td className="td" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(p.affiliate_id)}
                          className="w-4 h-4 rounded border-surface-200 text-brand-600 focus:ring-brand-600/20 cursor-pointer"
                        />
                      </td>
                      <td className="td">
                        <span className="text-sm font-medium text-gray-900">{p.affiliate_name}</span>
                      </td>
                      <td className="td text-right">
                        <span className="text-sm font-bold text-accent tabular-nums">{fmt.currency(p.approved_balance)}</span>
                      </td>
                      <td className="td" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handlePaySingle(p.affiliate_id, p.affiliate_name, p.approved_balance)}
                          disabled={isPaying || creatingBatch}
                          className="flex items-center gap-1 text-[10px] font-medium text-white bg-accent hover:bg-accent/90
                                     rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isPaying ? <Spinner /> : (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                            </svg>
                          )}
                          Pay
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payout batch tracking */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-200/60 flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Payout History</h3>
            <p className="text-xs text-brand-400 mt-0.5">{payouts.length} payouts</p>
          </div>
          <div className="flex items-center gap-2">
            {processingPayouts.length > 0 && (
              <button
                onClick={handleCheckMercury}
                disabled={checkingMercury}
                className="flex items-center gap-1.5 text-xs font-medium text-brand-600 border border-brand-200 hover:border-brand-400
                           rounded-lg px-3 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-white"
              >
                {checkingMercury ? <Spinner /> : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                  </svg>
                )}
                Check Mercury ({processingPayouts.length})
              </button>
            )}
            {requestedPayouts.length > 0 && (
              <button
                onClick={handleExecuteBatch}
                disabled={executingBatch}
                className="flex items-center gap-1.5 text-xs font-medium text-white bg-accent hover:bg-accent/90
                           rounded-lg px-3 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {executingBatch ? <Spinner /> : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                )}
                Execute Requested ({requestedPayouts.length})
              </button>
            )}
          </div>
        </div>

        {payouts.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-brand-400">No payouts created yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-surface-200/60 bg-surface-50/60">
                  <th className="th">Affiliate</th>
                  <th className="th">Amount</th>
                  <th className="th hidden sm:table-cell">Period</th>
                  <th className="th">Status</th>
                  <th className="th hidden md:table-cell">Reference</th>
                  <th className="th hidden md:table-cell">Created</th>
                  <th className="th">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-200/60">
                {payouts.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-100/40 transition-colors">
                    <td className="td">
                      <span className="text-sm font-medium text-gray-900">{p.affiliate_name}</span>
                    </td>
                    <td className="td">
                      <span className="text-sm font-bold text-gray-900 tabular-nums">{fmt.currency(p.amount)}</span>
                    </td>
                    <td className="td hidden sm:table-cell">
                      <span className="text-xs text-brand-400">{p.period ?? "\u2014"}</span>
                    </td>
                    <td className="td">{statusBadge(p.status)}</td>
                    <td className="td hidden md:table-cell">
                      <span className="text-xs text-brand-400 font-mono truncate max-w-[140px] block">
                        {p.provider_reference_id ?? "\u2014"}
                      </span>
                    </td>
                    <td className="td hidden md:table-cell">
                      <span className="text-xs text-brand-400">{fmt.date(p.created_at)}</span>
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-1">
                        {(p.status === "processing" || p.status === "requested") && (
                          <>
                            <button
                              onClick={() => handleUpdateStatus(p.id, "completed")}
                              disabled={updatingId === p.id}
                              className="text-[10px] font-medium text-accent border border-accent/30 hover:border-accent
                                         rounded px-2 py-1 transition-all disabled:opacity-50"
                            >
                              {updatingId === p.id ? "..." : "Complete"}
                            </button>
                            <button
                              onClick={() => handleUpdateStatus(p.id, "failed")}
                              disabled={updatingId === p.id}
                              className="text-[10px] font-medium text-red-500 border border-red-200 hover:border-red-400
                                         rounded px-2 py-1 transition-all disabled:opacity-50"
                            >
                              {updatingId === p.id ? "..." : "Failed"}
                            </button>
                          </>
                        )}
                        {p.status === "failed" && (
                          <button
                            onClick={() => handleUpdateStatus(p.id, "requested")}
                            disabled={updatingId === p.id}
                            className="text-[10px] font-medium text-amber-600 border border-amber-200 hover:border-amber-400
                                       rounded px-2 py-1 transition-all disabled:opacity-50"
                          >
                            {updatingId === p.id ? "..." : "Retry"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-5 py-3 border-t border-surface-200/60 bg-surface-50/60">
          <p className="text-xs text-brand-400">{payouts.length} payouts total</p>
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
