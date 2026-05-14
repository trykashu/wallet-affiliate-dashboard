"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/fmt";
import type { BatchSummary } from "./BatchReviewSection";

interface Props {
  batches: BatchSummary[];
}

export default function RequestedBatchesSection({ batches }: Props) {
  const router = useRouter();
  const [busyBatchId, setBusyBatchId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExecute(batch: BatchSummary) {
    if (!confirm(
      `Execute ${batch.payout_count} payout(s) totaling ${fmt.currency(batch.total_amount)} via Mercury?\n\nThis sends real ACH transfers.`
    )) return;
    setBusyBatchId(batch.batch_id);
    setError(null);
    try {
      const res = await fetch("/api/admin/payouts/execute-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch_id: batch.batch_id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? body?.error ?? `Execute failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Execute failed");
    } finally {
      setBusyBatchId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-bold text-brand-400 uppercase tracking-wider">Ready to execute</h2>
        <p className="text-xs text-brand-400 mt-0.5">{batches.length} batch{batches.length === 1 ? "" : "es"} approved · awaiting Mercury</p>
      </div>

      {error && (
        <div className="card p-3 bg-red-50 border-red-200">
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      <div className="space-y-3">
        {batches.map((b) => (
          <div key={b.batch_id} className="card p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">Period {b.period}</p>
              <p className="text-[10px] text-brand-400 mt-0.5">
                {b.payout_count} payout{b.payout_count === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className="text-base font-bold text-gray-900 tabular-nums">{fmt.currency(b.total_amount)}</span>
              <button
                onClick={() => handleExecute(b)}
                disabled={busyBatchId === b.batch_id}
                className="text-xs font-semibold text-white bg-accent hover:bg-accent/90 rounded-xl px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >{busyBatchId === b.batch_id ? "Executing…" : "Execute via Mercury"}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
