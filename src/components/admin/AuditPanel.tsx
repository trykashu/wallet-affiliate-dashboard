"use client";

import { useCallback, useState } from "react";
import { fmt } from "@/lib/fmt";

interface OrphanRow {
  ptl_id: string;
  user_email: string;
  amount: number;
  transaction_id: string;
  transaction_date: string;
}
interface DriftRow {
  ptl_id: string;
  transaction_id: string;
  ptl_amount: number;
  ut_amount: number;
  delta: number;
}
interface MissingRow {
  ut_id: string;
  user_email: string;
  referrer: string;
  amount: number;
  transaction_id: string;
  transaction_date: string;
}
interface MonthAudit {
  month: string;
  ptl_count: number;
  ptl_sum: number;
  ut_match_sum: number;
  orphans: OrphanRow[];
  drifts: DriftRow[];
  missing: MissingRow[];
}
interface AuditResponse {
  ok: boolean;
  generated_at: string;
  totals: { orphans: number; drifts: number; missing: number };
  months: MonthAudit[];
}

export default function AuditPanel() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AuditResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<Record<string, "loading" | "done" | string>>({});

  const runAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/audit-ptl", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Audit failed (${res.status})`);
      setResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audit failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const createMissing = useCallback(async (utId: string) => {
    setCreating((s) => ({ ...s, [utId]: "loading" }));
    try {
      const res = await fetch("/api/admin/audit-ptl/create-row", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ut_record_id: utId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Create failed (${res.status})`);
      setCreating((s) => ({ ...s, [utId]: "done" }));
    } catch (e) {
      setCreating((s) => ({ ...s, [utId]: e instanceof Error ? e.message : "Create failed" }));
    }
  }, []);

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">PTL ↔ UT Audit</h3>
          <p className="text-[10px] text-brand-400 mt-0.5 uppercase tracking-wider font-medium">
            Cross-checks Partner Transaction Log against User Transactions
          </p>
        </div>
        <button
          onClick={runAudit}
          disabled={loading}
          className="btn-primary text-xs"
        >
          {loading ? "Auditing…" : "Trigger UTX / PTX Audit"}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg mb-3">
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <SummaryCard label="Orphan PTL rows" value={result.totals.orphans} color="red" />
            <SummaryCard label="Amount drifts" value={result.totals.drifts} color="amber" />
            <SummaryCard label="Missing from PTL" value={result.totals.missing} color="amber" />
          </div>
          <p className="text-[10px] text-brand-400">
            Generated {new Date(result.generated_at).toLocaleString()}
          </p>

          {result.months.length === 0 && (
            <p className="text-xs text-brand-400">No months to report.</p>
          )}

          {result.months.map((m) => {
            const hasIssues = m.orphans.length > 0 || m.drifts.length > 0 || m.missing.length > 0;
            return (
              <details key={m.month} open={hasIssues} className="border border-surface-200/60 rounded-xl overflow-hidden">
                <summary className="cursor-pointer px-4 py-3 bg-surface-50/60 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-900">{m.month}</span>
                  <span className="text-[10px] text-brand-400 font-medium">
                    {m.ptl_count} PTL rows · {fmt.currency(m.ptl_sum)}
                    {hasIssues && (
                      <span className="ml-2 text-red-600 font-semibold">
                        {m.orphans.length + m.drifts.length + m.missing.length} issue
                        {m.orphans.length + m.drifts.length + m.missing.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                </summary>

                {hasIssues ? (
                  <div className="p-4 space-y-4">
                    {m.orphans.length > 0 && (
                      <Section title={`Orphan PTL rows (${m.orphans.length})`} hint="PTL row has no matching UT — refund, typo, or manual entry">
                        <table className="w-full text-xs">
                          <thead className="text-brand-400 text-[10px] uppercase tracking-wider">
                            <tr><th className="text-left py-1">Email</th><th className="text-left">TxnID</th><th className="text-right">Amount</th><th className="text-left pl-3">Date</th><th className="text-left pl-3">PTL ID</th></tr>
                          </thead>
                          <tbody>
                            {m.orphans.map((o) => (
                              <tr key={o.ptl_id} className="border-t border-surface-200/60">
                                <td className="py-1">{o.user_email}</td>
                                <td className="font-mono text-[10px]">{o.transaction_id}</td>
                                <td className="text-right tabular-nums">{fmt.currency(o.amount)}</td>
                                <td className="pl-3 text-brand-400">{o.transaction_date.slice(0, 10)}</td>
                                <td className="pl-3 font-mono text-[10px] text-brand-400">{o.ptl_id}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </Section>
                    )}

                    {m.drifts.length > 0 && (
                      <Section title={`Amount drifts (${m.drifts.length})`} hint="PTL Amount differs from UT Amount">
                        <table className="w-full text-xs">
                          <thead className="text-brand-400 text-[10px] uppercase tracking-wider">
                            <tr><th className="text-left py-1">TxnID</th><th className="text-right">PTL</th><th className="text-right">UT</th><th className="text-right">Δ</th><th className="text-left pl-3">PTL ID</th></tr>
                          </thead>
                          <tbody>
                            {m.drifts.map((d) => (
                              <tr key={d.ptl_id} className="border-t border-surface-200/60">
                                <td className="py-1 font-mono text-[10px]">{d.transaction_id}</td>
                                <td className="text-right tabular-nums">{fmt.currency(d.ptl_amount)}</td>
                                <td className="text-right tabular-nums">{fmt.currency(d.ut_amount)}</td>
                                <td className={`text-right tabular-nums font-semibold ${d.delta > 0 ? "text-amber-600" : "text-red-600"}`}>{fmt.currency(d.delta)}</td>
                                <td className="pl-3 font-mono text-[10px] text-brand-400">{d.ptl_id}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </Section>
                    )}

                    {m.missing.length > 0 && (
                      <Section title={`Missing from PTL (${m.missing.length})`} hint="UT Transfer In with referrer but no PTL row — affiliate under-paid">
                        <table className="w-full text-xs">
                          <thead className="text-brand-400 text-[10px] uppercase tracking-wider">
                            <tr><th className="text-left py-1">Email</th><th className="text-left">Referrer</th><th className="text-left">TxnID</th><th className="text-right">Amount</th><th className="text-left pl-3">Date</th><th className="text-right pl-3">Action</th></tr>
                          </thead>
                          <tbody>
                            {m.missing.map((mr) => {
                              const state = creating[mr.ut_id];
                              return (
                                <tr key={mr.ut_id} className="border-t border-surface-200/60">
                                  <td className="py-1">{mr.user_email}</td>
                                  <td className="font-mono text-[10px]">{mr.referrer}</td>
                                  <td className="font-mono text-[10px]">{mr.transaction_id}</td>
                                  <td className="text-right tabular-nums">{fmt.currency(mr.amount)}</td>
                                  <td className="pl-3 text-brand-400">{mr.transaction_date.slice(0, 10)}</td>
                                  <td className="pl-3 text-right">
                                    {state === "done" ? (
                                      <span className="text-[10px] text-accent font-semibold">✓ Created</span>
                                    ) : state === "loading" ? (
                                      <span className="text-[10px] text-brand-400">Creating…</span>
                                    ) : state ? (
                                      <span className="text-[10px] text-red-600" title={state}>Error</span>
                                    ) : (
                                      <button
                                        onClick={() => createMissing(mr.ut_id)}
                                        className="text-[10px] font-semibold text-brand-600 hover:text-brand-700 underline decoration-dotted"
                                      >
                                        Create in PTL
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </Section>
                    )}
                  </div>
                ) : (
                  <p className="px-4 py-3 text-xs text-accent">✓ Clean — PTL and UT match.</p>
                )}
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: "red" | "amber" | "accent" }) {
  const cls =
    color === "red" ? "text-red-600" :
    color === "amber" ? "text-amber-600" :
    "text-accent";
  return (
    <div className="bg-surface-100/60 border border-surface-200/60 rounded-xl px-3 py-3">
      <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium mb-1">{label}</p>
      <p className={`text-stat font-bold tabular-nums ${value > 0 ? cls : "text-gray-900"}`}>{value}</p>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-900 mb-1">{title}</p>
      <p className="text-[10px] text-brand-400 mb-2">{hint}</p>
      {children}
    </div>
  );
}
