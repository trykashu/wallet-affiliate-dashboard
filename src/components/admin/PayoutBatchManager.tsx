"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/fmt";
import Money from "./Money";
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

export default function PayoutBatchManager({
  payouts,
}: {
  payouts: PayoutRow[];
}) {
  const router = useRouter();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [checkingMercury, setCheckingMercury] = useState(false);
  const [statementId, setStatementId] = useState<string | null>(null);
  const [statementError, setStatementError] = useState<string | null>(null);

  const processingPayouts = payouts.filter((p) => p.status === "processing");

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

  const handleGenerateStatement = useCallback(async (payoutId: string) => {
    setStatementId(payoutId);
    setStatementError(null);
    try {
      const res = await fetch(`/api/admin/payouts/${payoutId}/statement`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Generation failed (${res.status})`);
      const cleanUrl = typeof body.url === "string" ? body.url.replace(/\s/g, "") : body.url;
      window.open(cleanUrl, "_blank");
      router.refresh();
    } catch (e) {
      setStatementError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setStatementId(null);
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
      status === "completed"  ? "ad-badge-pos" :
      status === "processing" ? "ad-badge-amber"  :
      status === "failed"     ? "ad-badge-neg"    : "ad-badge-amber";
    return <span className={`ad-badge ${cls}`}>{status}</span>;
  };

  return (
    <div className="space-y-6">
      {statementError && (
        <div className="ad-card p-3 bg-[rgba(242,112,110,0.10)] border border-[rgba(242,112,110,0.28)]">
          <p className="text-xs text-[var(--ad-neg)]">{statementError}</p>
          <button
            onClick={() => setStatementError(null)}
            className="text-[10px] text-[var(--ad-neg)] underline mt-1"
          >Dismiss</button>
        </div>
      )}

      {/* Payout batch tracking */}
      <div className="ad-card overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--ad-border)] flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h3 className="text-sm font-semibold ad-text-1">Payout History</h3>
            <p className="text-xs ad-text-3 mt-0.5">{payouts.length} payouts</p>
          </div>
          <div className="flex items-center gap-2">
            {processingPayouts.length > 0 && (
              <button
                onClick={handleCheckMercury}
                disabled={checkingMercury}
                className="ad-act"
              >
                {checkingMercury ? <Spinner /> : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                  </svg>
                )}
                Check Mercury ({processingPayouts.length})
              </button>
            )}
          </div>
        </div>

        {payouts.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm ad-text-3">No payouts created yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-[var(--ad-border)] bg-[var(--ad-inset)]">
                  <th className="ad-th">Affiliate</th>
                  <th className="ad-th">Amount</th>
                  <th className="ad-th hidden sm:table-cell">Period</th>
                  <th className="ad-th">Status</th>
                  <th className="ad-th hidden md:table-cell">Reference</th>
                  <th className="ad-th hidden md:table-cell">Created</th>
                  <th className="ad-th hidden lg:table-cell text-center">Statement</th>
                  <th className="ad-th">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ad-border)]">
                {payouts.map((p) => (
                  <tr key={p.id} className="hover:bg-[var(--ad-surface-2)] transition-colors">
                    <td className="ad-td">
                      <span className="text-sm font-medium ad-text-1">{p.affiliate_name}</span>
                    </td>
                    <td className="ad-td">
                      <Money value={p.amount} className="text-sm font-bold ad-text-1" />
                    </td>
                    <td className="ad-td hidden sm:table-cell">
                      <span className="text-xs ad-text-3">{p.period ?? "—"}</span>
                    </td>
                    <td className="ad-td">{statusBadge(p.status)}</td>
                    <td className="ad-td hidden md:table-cell">
                      <span className="text-xs ad-text-3 font-mono truncate max-w-[140px] block">
                        {p.provider_reference_id ?? "—"}
                      </span>
                    </td>
                    <td className="ad-td hidden md:table-cell">
                      <span className="text-xs ad-text-3">{fmt.date(p.created_at)}</span>
                    </td>
                    <td className="ad-td hidden lg:table-cell text-center">
                      {p.status === "completed" || p.status === "processing" ? (
                        <button
                          onClick={() => handleGenerateStatement(p.id)}
                          disabled={statementId === p.id}
                          title="Render statement PDF and upload to Supabase + Airtable"
                          className="text-[10px] font-semibold ad-accent-text hover:underline decoration-dotted disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {statementId === p.id ? "…" : "Generate"}
                        </button>
                      ) : (
                        <span className="text-[10px] ad-text-3">—</span>
                      )}
                    </td>
                    <td className="ad-td">
                      <div className="flex items-center gap-1">
                        {(p.status === "processing" || p.status === "requested") && (
                          <>
                            <button
                              onClick={() => handleUpdateStatus(p.id, "completed")}
                              disabled={updatingId === p.id}
                              className="ad-act ad-act-pos text-[10px]
                                         rounded px-2 py-1 transition-all disabled:opacity-50"
                            >
                              {updatingId === p.id ? "..." : "Complete"}
                            </button>
                            <button
                              onClick={() => handleUpdateStatus(p.id, "failed")}
                              disabled={updatingId === p.id}
                              className="ad-act ad-act-neg text-[10px]
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
                            className="ad-act ad-act-amber text-[10px]
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

        <div className="px-5 py-3 border-t border-[var(--ad-border)] bg-[var(--ad-inset)]">
          <p className="text-xs ad-text-3">{payouts.length} payouts total</p>
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
