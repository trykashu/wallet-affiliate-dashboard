"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/fmt";
import TierBadge from "@/components/ui/TierBadge";
import { COMMISSION_RATES } from "@/lib/tier";
import type { EarningStatus, AffiliateTier } from "@/types/database";

function isContractSigned(status: string | null): boolean {
  return status === "Completed" || status === "signed";
}

function contractLabel(status: string | null): string {
  if (!status || status === "Not Created") return "No contract";
  if (status === "Completed" || status === "signed") return "Signed";
  if (status === "Pending Partner Signature") return "Awaiting partner";
  if (status === "Pending Kashu Signature") return "Awaiting Kashu";
  if (status === "Declined") return "Declined";
  return status;
}

function contractBadgeClass(status: string | null): string {
  const base = "text-[10px] font-semibold px-2 py-0.5 rounded-full border";
  if (status === "Completed" || status === "signed") {
    return `${base} text-emerald-700 bg-emerald-50 border-emerald-200`;
  }
  if (status === "Declined") {
    return `${base} text-red-700 bg-red-50 border-red-200`;
  }
  if (!status || status === "Not Created") {
    return `${base} text-brand-400 bg-surface-100 border-surface-200`;
  }
  // Pending Partner / Pending Kashu
  return `${base} text-amber-700 bg-amber-50 border-amber-200`;
}

function formatMonthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  if (!y || !m) return yyyyMm;
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

export interface AdminEarning {
  id: string;
  created_at: string;
  affiliate_id: string;
  affiliate_name: string;
  referred_user_name: string;
  transaction_fee_amount: number;
  tier_at_earning: AffiliateTier;
  amount: number;
  status: EarningStatus;
  tpv: number | null;
  funnel_percent: number | null;
  contract_status: string | null;
  transaction_date: string | null;
  payout_id: string | null;
  affiliate_is_payable: boolean;
}

export default function AdminEarningsTable({
  earnings,
  availableMonths,
}: {
  earnings: AdminEarning[];
  availableMonths: string[];
}) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<EarningStatus | "all" | "blocked">("all");
  const [month, setMonth] = useState<string>(() => availableMonths[0] ?? "all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState(false);

  // Submit-for-review drawer state
  const [showSubmitDrawer, setShowSubmitDrawer] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitPeriod, setSubmitPeriod] = useState<string>(
    () => availableMonths[0] ?? new Date().toISOString().slice(0, 7)
  );
  const [submitNotes, setSubmitNotes] = useState<string>("");

  const filtered = useMemo(() => {
    let list = earnings;
    if (month !== "all") {
      list = list.filter((e) => e.transaction_date?.startsWith(month));
    }
    if (statusFilter === "all") return list;
    if (statusFilter === "blocked") {
      return list.filter((e) => e.status === "pending" && !isContractSigned(e.contract_status));
    }
    return list.filter((e) => e.status === statusFilter);
  }, [earnings, month, statusFilter]);

  // Earnings the user is allowed to tick: pending (for Approve) OR approved+unlinked+payable+signed (for Submit)
  const eligibleForSelectionIds = useMemo(
    () =>
      filtered
        .filter((e) => {
          if (e.status === "pending") return isContractSigned(e.contract_status);
          if (e.status === "approved") {
            return (
              !e.payout_id &&
              e.affiliate_is_payable &&
              isContractSigned(e.contract_status)
            );
          }
          return false;
        })
        .map((e) => e.id),
    [filtered]
  );
  const eligibleForSelectionSet = useMemo(
    () => new Set(eligibleForSelectionIds),
    [eligibleForSelectionIds]
  );

  // Subset for the Approve Selected button — pending only
  const eligiblePendingIds = useMemo(
    () =>
      filtered
        .filter((e) => e.status === "pending" && isContractSigned(e.contract_status))
        .map((e) => e.id),
    [filtered]
  );

  const blockedPendingCount = useMemo(
    () => filtered.filter((e) => e.status === "pending" && !isContractSigned(e.contract_status)).length,
    [filtered]
  );

  // Currently-selected approved earnings ready to submit
  const selectedSubmittable = useMemo(
    () =>
      filtered.filter(
        (e) =>
          selected.has(e.id) &&
          e.status === "approved" &&
          !e.payout_id &&
          e.affiliate_is_payable &&
          isContractSigned(e.contract_status),
      ),
    [filtered, selected],
  );

  // Currently-selected pending earnings (for the Approve button count)
  const selectedPendingCount = useMemo(
    () =>
      filtered.filter(
        (e) => selected.has(e.id) && e.status === "pending" && isContractSigned(e.contract_status),
      ).length,
    [filtered, selected],
  );

  const submitPreview = useMemo(() => {
    const byAffiliate = new Map<string, { affiliate_id: string; affiliate_name: string; count: number; total: number }>();
    for (const e of selectedSubmittable) {
      const existing = byAffiliate.get(e.affiliate_id);
      if (existing) {
        existing.count += 1;
        existing.total += Number(e.amount) || 0;
      } else {
        byAffiliate.set(e.affiliate_id, {
          affiliate_id: e.affiliate_id,
          affiliate_name: e.affiliate_name,
          count: 1,
          total: Number(e.amount) || 0,
        });
      }
    }
    return Array.from(byAffiliate.values()).sort((a, b) => b.total - a.total);
  }, [selectedSubmittable]);

  const submitTotal = useMemo(
    () => submitPreview.reduce((s, r) => s + r.total, 0),
    [submitPreview],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selected.size === eligibleForSelectionIds.length && eligibleForSelectionIds.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(eligibleForSelectionIds));
    }
  }, [eligibleForSelectionIds, selected.size]);

  const handleBulkApprove = useCallback(async () => {
    // Only act on pending selections; ignore approved ones the user may also have ticked.
    const pendingIds = filtered
      .filter(
        (e) => selected.has(e.id) && e.status === "pending" && isContractSigned(e.contract_status),
      )
      .map((e) => e.id);
    if (pendingIds.length === 0) return;
    if (!confirm(`Approve ${pendingIds.length} earning(s)?`)) return;

    setApproving(true);
    try {
      const res = await fetch("/api/admin/earnings/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ earning_ids: pendingIds }),
      });
      if (!res.ok) throw new Error("Failed");
      setSelected(new Set());
      router.refresh();
    } catch {
      alert("Failed to approve earnings. Please try again.");
    } finally {
      setApproving(false);
    }
  }, [filtered, selected, router]);

  const openSubmitDrawer = useCallback(() => {
    if (month !== "all") setSubmitPeriod(month);
    setShowSubmitDrawer(true);
    setSubmitError(null);
  }, [month]);

  const handleSubmitBatch = useCallback(async () => {
    if (selectedSubmittable.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/admin/payouts/create-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          earning_ids: selectedSubmittable.map((e) => e.id),
          period: submitPeriod,
          notes: submitNotes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? body?.error ?? `Submit failed (${res.status})`);
      }
      setShowSubmitDrawer(false);
      setSubmitNotes("");
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }, [selectedSubmittable, submitPeriod, submitNotes, router]);

  const statusBadge = (status: EarningStatus) => {
    const cls =
      status === "approved" ? "badge-accent" :
      status === "paid"     ? "badge-accent" :
      status === "reversed" ? "badge-red"    : "badge-amber";
    return <span className={`badge ${cls}`}>{status}</span>;
  };

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-surface-200/60 flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">All Earnings</h3>
          <p className="text-xs text-brand-400 mt-0.5">
            {statusFilter !== "all" || month !== "all"
              ? `${filtered.length} of ${earnings.length}`
              : earnings.length}{" "}
            earnings
          </p>
          {blockedPendingCount > 0 && (
            <p className="text-[10px] text-amber-700 mt-0.5">
              {blockedPendingCount} pending blocked by unsigned contract
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="text-xs rounded-lg border border-surface-200 bg-white text-gray-900 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-600/30"
          >
            <option value="all">All months</option>
            {availableMonths.map((m) => (
              <option key={m} value={m}>{formatMonthLabel(m)}</option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as EarningStatus | "all" | "blocked")}
            className="text-xs rounded-lg border border-surface-200 bg-white text-gray-900 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-600/30"
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="reversed">Reversed</option>
            <option value="blocked">Blocked by contract</option>
          </select>

          {eligiblePendingIds.length > 0 && (
            <button
              onClick={handleBulkApprove}
              disabled={selectedPendingCount === 0 || approving}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-accent hover:bg-accent/90
                         rounded-lg px-3 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {approving ? (
                <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              Approve Selected ({selectedPendingCount})
            </button>
          )}

          <button
            onClick={openSubmitDrawer}
            disabled={selectedSubmittable.length === 0 || submitting}
            className="flex items-center gap-1.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl px-3 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9l9-6 9 6m-9-3v18m-6-3h12" />
            </svg>
            Submit for review ({selectedSubmittable.length})
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-surface-200/60 bg-surface-50/60">
              {eligibleForSelectionIds.length > 0 && (
                <th className="th w-10">
                  <input
                    type="checkbox"
                    checked={selected.size === eligibleForSelectionIds.length && eligibleForSelectionIds.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-surface-200"
                  />
                </th>
              )}
              <th className="th">Tx Date</th>
              <th className="th hidden sm:table-cell">Affiliate</th>
              <th className="th hidden md:table-cell">Contract</th>
              <th className="th hidden md:table-cell">User</th>
              <th className="th hidden xl:table-cell">Tier</th>
              <th className="th text-right">TPV</th>
              <th className="th text-right hidden lg:table-cell">Funnel %</th>
              <th className="th text-right hidden lg:table-cell">Cash Collected</th>
              <th className="th text-right hidden lg:table-cell">Comm %</th>
              <th className="th text-right">Commission</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-200/60">
            {filtered.map((e) => {
              const blocked = e.status === "pending" && !isContractSigned(e.contract_status);
              const isSelectable = eligibleForSelectionSet.has(e.id);
              return (
                <tr
                  key={e.id}
                  className={`hover:bg-surface-100/40 transition-colors ${blocked ? "opacity-60" : ""}`}
                >
                  {eligibleForSelectionIds.length > 0 && (
                    <td className="td w-10">
                      {isSelectable ? (
                        <input
                          type="checkbox"
                          checked={selected.has(e.id)}
                          onChange={() => toggleSelect(e.id)}
                          className="rounded border-surface-200"
                        />
                      ) : e.status === "pending" ? (
                        <span title="Contract not signed — cannot approve" className="inline-flex w-4 h-4 items-center justify-center text-brand-400">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round"
                              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
                          </svg>
                        </span>
                      ) : null}
                    </td>
                  )}
                  <td className="td">
                    <span className="text-xs text-brand-400">
                      {e.transaction_date ? fmt.date(e.transaction_date) : <span className="text-brand-400/60">—</span>}
                    </span>
                  </td>
                  <td className="td hidden sm:table-cell">
                    <span className="text-xs text-gray-700 font-medium">{e.affiliate_name}</span>
                  </td>
                  <td className="td hidden md:table-cell">
                    <span className={contractBadgeClass(e.contract_status)}>
                      {contractLabel(e.contract_status)}
                    </span>
                  </td>
                  <td className="td hidden md:table-cell">
                    <span className="text-xs text-gray-600">{e.referred_user_name}</span>
                  </td>
                  <td className="td hidden xl:table-cell">
                    <TierBadge tier={e.tier_at_earning} />
                  </td>
                  <td className="td text-right">
                    <span className="text-xs text-gray-700 tabular-nums">
                      {e.tpv != null ? fmt.currency(e.tpv) : <span className="text-brand-400">&mdash;</span>}
                    </span>
                  </td>
                  <td className="td text-right hidden lg:table-cell">
                    <span className="text-xs text-brand-400 tabular-nums">
                      {e.funnel_percent != null
                        ? `${Number(e.funnel_percent).toFixed(Number(e.funnel_percent) % 1 === 0 ? 0 : 2).replace(/\.?0+$/, "")}%`
                        : "—"}
                    </span>
                  </td>
                  <td className="td text-right hidden lg:table-cell">
                    <span className="text-xs text-gray-700 tabular-nums">{fmt.currency(Number(e.transaction_fee_amount) || 0)}</span>
                  </td>
                  <td className="td text-right hidden lg:table-cell">
                    <span className="text-xs text-brand-400 tabular-nums">
                      {(COMMISSION_RATES[e.tier_at_earning] * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="td text-right">
                    <span className="text-sm font-bold text-gray-900 tabular-nums">{fmt.currency(e.amount)}</span>
                  </td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      {statusBadge(e.status)}
                      {e.payout_id && (
                        <span className="badge badge-amber text-[10px]" title="In a payout batch">In batch</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={eligibleForSelectionIds.length > 0 ? 12 : 11} className="px-5 py-10 text-center text-sm text-brand-400">
                  No earnings match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 border-t border-surface-200/60 bg-surface-50/60">
        <p className="text-xs text-brand-400">
          {statusFilter !== "all" || month !== "all"
            ? `${filtered.length} of ${earnings.length}`
            : earnings.length}{" "}
          earnings total
        </p>
      </div>

      {/* Submit-for-review drawer */}
      {showSubmitDrawer && (
        <>
          <div className="drawer-backdrop" onClick={() => !submitting && setShowSubmitDrawer(false)} />
          <div className="drawer-panel">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Payout batch</p>
                <h2 className="text-xl font-bold text-gray-900 mt-1">Submit for Finance review</h2>
              </div>
              <button
                onClick={() => !submitting && setShowSubmitDrawer(false)}
                className="text-sm text-brand-400 hover:text-gray-900"
                aria-label="Close drawer"
              >Close</button>
            </div>

            {submitError && (
              <div className="card p-3 mb-4 bg-red-50 border-red-200">
                <p className="text-xs text-red-700">{submitError}</p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Period</label>
                <input
                  type="month"
                  value={submitPeriod}
                  onChange={(e) => setSubmitPeriod(e.target.value)}
                  disabled={submitting}
                  className="mt-1 input-base w-full"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Notes (optional)</label>
                <textarea
                  value={submitNotes}
                  onChange={(e) => setSubmitNotes(e.target.value.slice(0, 500))}
                  disabled={submitting}
                  rows={3}
                  placeholder="Anything Finance should know about this batch…"
                  className="mt-1 input-base w-full resize-none"
                />
                <p className="text-[10px] text-brand-400 mt-1 tabular-nums">{submitNotes.length}/500</p>
              </div>

              <div>
                <p className="text-[10px] font-bold text-brand-400 uppercase tracking-wider mb-2">Preview by affiliate</p>
                <div className="card divide-y divide-surface-200/60 overflow-hidden">
                  {submitPreview.map((row) => (
                    <div key={row.affiliate_id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{row.affiliate_name}</p>
                        <p className="text-[10px] text-brand-400">{row.count} earning{row.count === 1 ? "" : "s"}</p>
                      </div>
                      <span className="text-sm font-bold text-gray-900 tabular-nums">{fmt.currency(row.total)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-3 px-1">
                  <span className="text-xs font-semibold text-brand-400 uppercase tracking-wider">Total</span>
                  <span className="text-base font-bold text-gray-900 tabular-nums">{fmt.currency(submitTotal)}</span>
                </div>
              </div>

              <div className="pt-3 border-t border-surface-200/60 flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowSubmitDrawer(false)}
                  disabled={submitting}
                  className="text-xs font-semibold text-brand-400 hover:text-gray-900 px-3 py-2"
                >Cancel</button>
                <button
                  onClick={handleSubmitBatch}
                  disabled={submitting || selectedSubmittable.length === 0}
                  className="flex items-center gap-1.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? "Submitting…" : "Send to Finance"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
