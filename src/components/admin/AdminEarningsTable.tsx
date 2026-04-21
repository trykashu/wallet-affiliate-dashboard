"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/fmt";
import TierBadge from "@/components/ui/TierBadge";
import type { EarningStatus, AffiliateTier } from "@/types/database";

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
}

export default function AdminEarningsTable({ earnings }: { earnings: AdminEarning[] }) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<EarningStatus | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState(false);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return earnings;
    return earnings.filter((e) => e.status === statusFilter);
  }, [earnings, statusFilter]);

  const pendingIds = useMemo(
    () => filtered.filter((e) => e.status === "pending").map((e) => e.id),
    [filtered]
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
    if (selected.size === pendingIds.length && pendingIds.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pendingIds));
    }
  }, [pendingIds, selected.size]);

  const handleBulkApprove = useCallback(async () => {
    if (selected.size === 0) return;
    if (!confirm(`Approve ${selected.size} earning(s)?`)) return;

    setApproving(true);
    try {
      const res = await fetch("/api/admin/earnings/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ earning_ids: Array.from(selected) }),
      });
      if (!res.ok) throw new Error("Failed");
      setSelected(new Set());
      router.refresh();
    } catch {
      alert("Failed to approve earnings. Please try again.");
    } finally {
      setApproving(false);
    }
  }, [selected, router]);

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
            {statusFilter !== "all"
              ? `${filtered.length} of ${earnings.length}`
              : earnings.length}{" "}
            earnings
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as EarningStatus | "all")}
            className="text-xs rounded-lg border border-surface-200 bg-white text-gray-900 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-600/30"
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="reversed">Reversed</option>
          </select>

          {pendingIds.length > 0 && (
            <button
              onClick={handleBulkApprove}
              disabled={selected.size === 0 || approving}
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
              Approve Selected ({selected.size})
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-surface-200/60 bg-surface-50/60">
              {pendingIds.length > 0 && (
                <th className="th w-10">
                  <input
                    type="checkbox"
                    checked={selected.size === pendingIds.length && pendingIds.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-surface-200"
                  />
                </th>
              )}
              <th className="th">Date</th>
              <th className="th hidden sm:table-cell">Affiliate</th>
              <th className="th hidden md:table-cell">User</th>
              <th className="th hidden lg:table-cell">Tier</th>
              <th className="th">Commission</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-200/60">
            {filtered.map((e) => (
              <tr key={e.id} className="hover:bg-surface-100/40 transition-colors">
                {pendingIds.length > 0 && (
                  <td className="td w-10">
                    {e.status === "pending" ? (
                      <input
                        type="checkbox"
                        checked={selected.has(e.id)}
                        onChange={() => toggleSelect(e.id)}
                        className="rounded border-surface-200"
                      />
                    ) : null}
                  </td>
                )}
                <td className="td">
                  <span className="text-xs text-brand-400">{fmt.date(e.created_at)}</span>
                </td>
                <td className="td hidden sm:table-cell">
                  <span className="text-xs text-gray-700 font-medium">{e.affiliate_name}</span>
                </td>
                <td className="td hidden md:table-cell">
                  <span className="text-xs text-gray-600">{e.referred_user_name}</span>
                </td>
                <td className="td hidden lg:table-cell">
                  <TierBadge tier={e.tier_at_earning} />
                </td>
                <td className="td">
                  <span className="text-sm font-bold text-gray-900 tabular-nums">{fmt.currency(e.amount)}</span>
                </td>
                <td className="td">
                  {statusBadge(e.status)}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={pendingIds.length > 0 ? 7 : 6} className="px-5 py-10 text-center text-sm text-brand-400">
                  No earnings match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 border-t border-surface-200/60 bg-surface-50/60">
        <p className="text-xs text-brand-400">
          {statusFilter !== "all"
            ? `${filtered.length} of ${earnings.length}`
            : earnings.length}{" "}
          earnings total
        </p>
      </div>
    </div>
  );
}
