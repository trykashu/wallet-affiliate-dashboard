"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/fmt";
import Money from "./Money";

export interface BatchSummary {
  batch_id: string;
  period: string;
  submitted_by: string;
  submitted_at: string;
  review_notes: string | null;
  payout_count: number;
  total_amount: number;
  payouts: Array<{
    id: string;
    affiliate_id: string;
    affiliate_name: string;
    amount: number;
    pandadoc_id: string | null;
    has_address: boolean;
  }>;
}

interface Props {
  batches: BatchSummary[];
  isFinance: boolean;
}

export default function BatchReviewSection({ batches, isFinance }: Props) {
  const router = useRouter();
  const [busyBatchId, setBusyBatchId] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<BatchSummary | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleApprove(batch: BatchSummary) {
    if (!isFinance) return;
    if (!confirm(`Approve batch with ${batch.payout_count} payout(s) totaling ${fmt.currency(batch.total_amount)}?`)) return;
    setBusyBatchId(batch.batch_id);
    setError(null);
    try {
      const res = await fetch("/api/admin/payouts/approve-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch_id: batch.batch_id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? body?.error ?? `Approve failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setBusyBatchId(null);
    }
  }

  async function handleReject() {
    if (!isFinance || !rejectModal) return;
    if (!rejectNotes.trim()) {
      setError("Notes are required to reject.");
      return;
    }
    setBusyBatchId(rejectModal.batch_id);
    setError(null);
    try {
      const res = await fetch("/api/admin/payouts/reject-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch_id: rejectModal.batch_id, notes: rejectNotes.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? body?.error ?? `Reject failed (${res.status})`);
      }
      setRejectModal(null);
      setRejectNotes("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reject failed");
    } finally {
      setBusyBatchId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold ad-text-3 uppercase tracking-wider">Awaiting Finance review</h2>
          <p className="text-xs ad-text-3 mt-0.5">{batches.length} batch{batches.length === 1 ? "" : "es"} pending</p>
        </div>
      </div>

      {error && (
        <div className="ad-card p-3 bg-[rgba(242,112,110,0.10)] border border-[rgba(242,112,110,0.28)]">
          <p className="text-xs text-[var(--ad-neg)]">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {batches.map((b) => (
          <div key={b.batch_id} className="ad-card p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold ad-text-1">Period {b.period}</p>
                <p className="text-[10px] ad-text-3 mt-0.5">
                  Submitted by {b.submitted_by} · {fmt.relative(b.submitted_at)}
                </p>
              </div>
              <Money value={b.total_amount} className="text-base font-bold ad-text-1 flex-shrink-0" />
            </div>

            {b.review_notes && (
              <div className="bg-[var(--ad-inset)] border border-[var(--ad-border)] rounded-xl p-3">
                <p className="text-[10px] font-bold ad-text-3 uppercase tracking-wider mb-1">Notes from AM</p>
                <p className="text-xs ad-text-2 whitespace-pre-wrap leading-relaxed">{b.review_notes}</p>
              </div>
            )}

            <div className="divide-y divide-[var(--ad-border)] -mx-2">
              {b.payouts.map((p) => (
                <div key={p.id} className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-xs ad-text-2 truncate">{p.affiliate_name}</span>
                  <Money value={p.amount} className="text-xs font-semibold ad-text-1" />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--ad-border)]">
              <button
                onClick={() => isFinance && setRejectModal(b)}
                disabled={!isFinance || busyBatchId === b.batch_id}
                title={isFinance ? "Reject this batch" : "Finance team only"}
                className="ad-act ad-act-neg text-xs px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >Reject</button>
              <button
                onClick={() => handleApprove(b)}
                disabled={!isFinance || busyBatchId === b.batch_id}
                title={isFinance ? "Approve & queue for Mercury" : "Finance team only"}
                className="ad-btn-primary text-xs px-3 py-1.5 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
              >{busyBatchId === b.batch_id ? "Working…" : "Approve"}</button>
            </div>
          </div>
        ))}
      </div>

      {rejectModal && (
        <>
          <div className="drawer-backdrop" onClick={() => busyBatchId === null && setRejectModal(null)} />
          <div className="drawer-panel">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold ad-text-1">Reject batch</h3>
              <button
                onClick={() => busyBatchId === null && setRejectModal(null)}
                className="text-sm ad-text-3 hover:text-[var(--ad-text)]"
                aria-label="Close drawer"
              >Close</button>
            </div>
            <p className="text-xs ad-text-3 mb-4">
              {rejectModal.payout_count} payout(s) totaling {fmt.currency(rejectModal.total_amount)} for period {rejectModal.period}.
              Earnings will be unlinked from this batch and become available for a future submission.
            </p>
            <label className="text-[10px] font-bold ad-text-3 uppercase tracking-wider">Reason (required)</label>
            <textarea
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value.slice(0, 500))}
              disabled={busyBatchId !== null}
              rows={4}
              placeholder="Why is this batch being rejected?"
              className="mt-1 ad-input w-full resize-none"
            />
            <p className="text-[10px] ad-text-3 mt-1 tabular-nums">{rejectNotes.length}/500</p>
            <div className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--ad-border)] mt-4">
              <button
                onClick={() => busyBatchId === null && setRejectModal(null)}
                disabled={busyBatchId !== null}
                className="text-xs font-semibold ad-text-3 hover:text-[var(--ad-text)] px-3 py-2"
              >Cancel</button>
              <button
                onClick={handleReject}
                disabled={busyBatchId !== null || !rejectNotes.trim()}
                className="text-xs font-semibold text-white bg-[var(--ad-neg)] hover:opacity-90 rounded-xl px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >{busyBatchId !== null ? "Rejecting…" : "Confirm reject"}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
