"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/fmt";
import AdminTierBadge from "@/components/admin/AdminTierBadge";
import Money from "./Money";
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
    return `${base} text-[var(--ad-pos)] bg-[rgba(52,211,153,0.10)] border-[rgba(52,211,153,0.28)]`;
  }
  if (status === "Declined") {
    return `${base} text-[var(--ad-neg)] bg-[rgba(242,112,110,0.10)] border-[rgba(242,112,110,0.28)]`;
  }
  if (!status || status === "Not Created") {
    return `${base} text-[var(--ad-text-3)] bg-[var(--ad-surface-2)] border-[var(--ad-border)]`;
  }
  // Pending Partner / Pending Kashu
  return `${base} text-[#F4C152] bg-[rgba(244,193,82,0.10)] border-[rgba(244,193,82,0.26)]`;
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

  // Pending + contract-signed earnings are the only selectable rows (for Approve Selected).
  const eligiblePendingIds = useMemo(
    () =>
      filtered
        .filter((e) => e.status === "pending" && isContractSigned(e.contract_status))
        .map((e) => e.id),
    [filtered]
  );
  const eligiblePendingSet = useMemo(
    () => new Set(eligiblePendingIds),
    [eligiblePendingIds]
  );

  const blockedPendingCount = useMemo(
    () => filtered.filter((e) => e.status === "pending" && !isContractSigned(e.contract_status)).length,
    [filtered]
  );

  const selectedPendingCount = useMemo(
    () =>
      filtered.filter(
        (e) => selected.has(e.id) && e.status === "pending" && isContractSigned(e.contract_status),
      ).length,
    [filtered, selected],
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
    if (selected.size === eligiblePendingIds.length && eligiblePendingIds.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(eligiblePendingIds));
    }
  }, [eligiblePendingIds, selected.size]);

  const handleBulkApprove = useCallback(async () => {
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

  const statusBadge = (status: EarningStatus) => {
    const cls =
      status === "approved" ? "ad-badge-pos" :
      status === "paid"     ? "ad-badge-neutral" :
      status === "reversed" ? "ad-badge-neg"  : "ad-badge-amber";
    return <span className={`ad-badge ${cls}`}>{status}</span>;
  };

  return (
    <div className="ad-card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[var(--ad-border)] flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h3 className="text-sm font-semibold ad-text-1">All Earnings</h3>
          <p className="text-[11px] ad-text-3 mt-0.5">
            {statusFilter !== "all" || month !== "all"
              ? `${filtered.length} of ${earnings.length}`
              : earnings.length}{" "}
            earnings
          </p>
          {blockedPendingCount > 0 && (
            <p className="text-[10px] text-[#F4C152] mt-0.5">
              {blockedPendingCount} pending blocked by unsigned contract
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="text-xs ad-select px-2.5 py-1.5"
          >
            <option value="all">All months</option>
            {availableMonths.map((m) => (
              <option key={m} value={m}>{formatMonthLabel(m)}</option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as EarningStatus | "all" | "blocked")}
            className="text-xs ad-select px-2.5 py-1.5"
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
              className="ad-btn-primary flex items-center gap-1.5"
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
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-[var(--ad-border)] bg-[var(--ad-inset)]">
              {eligiblePendingIds.length > 0 && (
                <th className="ad-th w-10">
                  <input
                    type="checkbox"
                    checked={selected.size === eligiblePendingIds.length && eligiblePendingIds.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-[var(--ad-border)] accent-[#00DE8F]"
                  />
                </th>
              )}
              <th className="ad-th">Tx Date</th>
              <th className="ad-th hidden sm:table-cell">Affiliate</th>
              <th className="ad-th hidden md:table-cell">Contract</th>
              <th className="ad-th hidden md:table-cell">User</th>
              <th className="ad-th hidden xl:table-cell">Tier</th>
              <th className="ad-th text-right">TPV</th>
              <th className="ad-th text-right hidden lg:table-cell">Collected %</th>
              <th className="ad-th text-right hidden lg:table-cell">Cash Collected</th>
              <th className="ad-th text-right hidden lg:table-cell">Comm %</th>
              <th className="ad-th text-right">Commission</th>
              <th className="ad-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ad-border)]">
            {filtered.map((e) => {
              const blocked = e.status === "pending" && !isContractSigned(e.contract_status);
              const isSelectable = eligiblePendingSet.has(e.id);
              return (
                <tr
                  key={e.id}
                  className={`hover:bg-[var(--ad-surface-2)] transition-colors ${blocked ? "opacity-60" : ""}`}
                >
                  {eligiblePendingIds.length > 0 && (
                    <td className="ad-td w-10">
                      {isSelectable ? (
                        <input
                          type="checkbox"
                          checked={selected.has(e.id)}
                          onChange={() => toggleSelect(e.id)}
                          className="rounded border-[var(--ad-border)] accent-[#00DE8F]"
                        />
                      ) : e.status === "pending" ? (
                        <span title="Contract not signed — cannot approve" className="inline-flex w-4 h-4 items-center justify-center ad-text-3">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round"
                              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
                          </svg>
                        </span>
                      ) : null}
                    </td>
                  )}
                  <td className="ad-td">
                    <span className="text-xs ad-text-3">
                      {e.transaction_date ? fmt.date(e.transaction_date) : <span className="ad-text-3">—</span>}
                    </span>
                  </td>
                  <td className="ad-td hidden sm:table-cell">
                    <span className="text-xs ad-text-2 font-medium">{e.affiliate_name}</span>
                  </td>
                  <td className="ad-td hidden md:table-cell">
                    <span className={contractBadgeClass(e.contract_status)}>
                      {contractLabel(e.contract_status)}
                    </span>
                  </td>
                  <td className="ad-td hidden md:table-cell">
                    <span className="text-xs ad-text-3">{e.referred_user_name}</span>
                  </td>
                  <td className="ad-td hidden xl:table-cell">
                    <AdminTierBadge tier={e.tier_at_earning} />
                  </td>
                  <td className="ad-td text-right">
                    <span className="text-xs ad-text-2 tabular-nums">
                      {e.tpv != null ? <Money value={e.tpv} compact /> : <span className="ad-text-3">&mdash;</span>}
                    </span>
                  </td>
                  <td className="ad-td text-right hidden lg:table-cell">
                    <span className="text-xs ad-text-3 tabular-nums">
                      {/* Effective rate Kashu actually collected, derived from the
                          booked fee — NOT the funnel list price, which is 8.5% on
                          every row and hides per-deal discounts and overrides. */}
                      {e.tpv != null && e.tpv > 0 && e.transaction_fee_amount != null
                        ? `${((Number(e.transaction_fee_amount) / Number(e.tpv)) * 100).toFixed(2).replace(/\.?0+$/, "")}%`
                        : "—"}
                    </span>
                  </td>
                  <td className="ad-td text-right hidden lg:table-cell">
                    <Money value={Number(e.transaction_fee_amount) || 0} className="text-xs ad-text-2" />
                  </td>
                  <td className="ad-td text-right hidden lg:table-cell">
                    <span className="text-xs ad-text-3 tabular-nums">
                      {/* Effective commission rate. Under marginal banding this is
                          not the tier rate: a transaction straddling the $100k
                          threshold lands between 5% and 10%. */}
                      {Number(e.transaction_fee_amount) > 0
                        ? `${((Number(e.amount) / Number(e.transaction_fee_amount)) * 100).toFixed(2).replace(/\.?0+$/, "")}%`
                        : "—"}
                    </span>
                  </td>
                  <td className="ad-td text-right">
                    <Money value={e.amount} className="text-sm font-bold ad-text-1" />
                  </td>
                  <td className="ad-td">
                    <div className="flex items-center gap-2">
                      {statusBadge(e.status)}
                      {e.payout_id && (
                        <span className="ad-badge ad-badge-amber text-[10px]" title="In a payout batch">In batch</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={eligiblePendingIds.length > 0 ? 12 : 11} className="px-5 py-10 text-center text-sm ad-text-3">
                  No earnings match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 border-t border-[var(--ad-border)] bg-[var(--ad-inset)]">
        <p className="text-xs ad-text-3">
          {statusFilter !== "all" || month !== "all"
            ? `${filtered.length} of ${earnings.length}`
            : earnings.length}{" "}
          earnings total
        </p>
      </div>
    </div>
  );
}
