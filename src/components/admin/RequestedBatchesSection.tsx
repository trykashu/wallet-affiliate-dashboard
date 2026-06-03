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
        const detail = body?.detail ? ` — ${body.detail}` : "";
        const msg = `${body?.message ?? body?.error ?? `Execute failed (${res.status})`}${detail}`;
        // Force-visible: scroll to top + alert backstop so a missed banner
        // can't masquerade as "nothing happened".
        if (typeof window !== "undefined") {
          window.scrollTo({ top: 0, behavior: "smooth" });
          alert(`Mercury execute failed:\n\n${msg}`);
        }
        throw new Error(msg);
      }
      const body = await res.json().catch(() => ({}));
      if (body?.errors && Array.isArray(body.errors) && body.errors.length > 0) {
        const summary = `Executed ${body.executed_count ?? 0}, ${body.errors.length} failed:\n• ${body.errors.slice(0, 5).join("\n• ")}`;
        if (typeof window !== "undefined") alert(summary);
        setError(summary);
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
        <div className="card p-4 bg-red-50 border-red-300 border-2">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.732 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-bold text-red-700">Mercury execute failed</p>
              <p className="text-xs text-red-700 mt-1 whitespace-pre-wrap">{error}</p>
              <button onClick={() => setError(null)} className="text-[10px] text-red-700 underline mt-2">Dismiss</button>
            </div>
          </div>
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
