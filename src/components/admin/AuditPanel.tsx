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
  commission_status: string;
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
interface AnnealSummary { create: number; correct: number; skip_paid_drifts: number; skip_orphans: number; }
interface AnnealApplyResult { created: number; corrected: number; already_existed: number; failed: Array<{ id: string; reason: string }>; skipped: { paidDrifts: number; orphans: number }; }

export default function AuditPanel() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AuditResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<Record<string, "loading" | "done" | string>>({});
  const [annealPhase, setAnnealPhase] = useState<"idle" | "previewing" | "preview" | "applying" | "done">("idle");
  const [annealPreview, setAnnealPreview] = useState<AnnealSummary | null>(null);
  const [annealResult, setAnnealResult] = useState<AnnealApplyResult | null>(null);
  const [annealError, setAnnealError] = useState<string | null>(null);

  const runAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAnnealPhase("idle");
    setAnnealResult(null);
    setAnnealPreview(null);
    setAnnealError(null);
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

  const previewAnneal = useCallback(async () => {
    setAnnealPhase("previewing");
    setAnnealError(null);
    setAnnealResult(null);
    try {
      const res = await fetch("/api/admin/audit-ptl/anneal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Preview failed (${res.status})`);
      setAnnealPreview(body.summary as AnnealSummary);
      setAnnealPhase("preview");
    } catch (e) {
      setAnnealError(e instanceof Error ? e.message : "Preview failed");
      setAnnealPhase("idle");
    }
  }, []);

  const applyAnneal = useCallback(async () => {
    setAnnealPhase("applying");
    setAnnealError(null);
    try {
      const res = await fetch("/api/admin/audit-ptl/anneal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Anneal failed (${res.status})`);
      setAnnealResult(body.result as AnnealApplyResult);
      setAnnealPhase("done");
      await runAudit();           // re-audit to show the now-clean state
    } catch (e) {
      setAnnealError(e instanceof Error ? e.message : "Anneal failed");
      setAnnealPhase("preview");
    }
  }, [runAudit]);

  const actionable = result
    ? result.totals.missing + result.months.reduce((n, m) => n + m.drifts.filter((d) => {
        const s = (d.commission_status ?? "").trim().toLowerCase();
        return s === "" || s === "owed";
      }).length, 0)
    : 0;

  return (
    <div className="ad-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold ad-text-1">PTL ↔ UT Audit</h3>
          <p className="text-[10px] ad-text-3 mt-0.5 uppercase tracking-wider font-medium">
            Cross-checks Partner Transaction Log against User Transactions
          </p>
        </div>
        <button
          onClick={runAudit}
          disabled={loading}
          className="ad-btn-primary text-xs"
        >
          {loading ? "Auditing…" : "Trigger UTX / PTX Audit"}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-[rgba(242,112,110,0.10)] border border-[rgba(242,112,110,0.28)] rounded-lg mb-3">
          <p className="text-xs text-[var(--ad-neg)]">{error}</p>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <SummaryCard label="Orphan PTL rows" value={result.totals.orphans} color="red" />
            <SummaryCard label="Amount drifts" value={result.totals.drifts} color="amber" />
            <SummaryCard label="Missing from PTL" value={result.totals.missing} color="amber" />
          </div>

          {annealError && (
            <div className="p-3 bg-[rgba(242,112,110,0.10)] border border-[rgba(242,112,110,0.28)] rounded-lg">
              <p className="text-xs text-[var(--ad-neg)]">{annealError}</p>
            </div>
          )}

          {actionable > 0 && annealPhase !== "done" && (
            <div className="flex flex-wrap items-center gap-3 p-3 ad-inset">
              {annealPhase === "preview" && annealPreview ? (
                <>
                  <p className="text-xs ad-text-1 flex-1">
                    Will <strong>create {annealPreview.create}</strong> PTL row{annealPreview.create === 1 ? "" : "s"} and{" "}
                    <strong>correct {annealPreview.correct}</strong> unpaid drift{annealPreview.correct === 1 ? "" : "s"}.{" "}
                    <span className="ad-text-3">
                      Skipping {annealPreview.skip_paid_drifts} paid drift{annealPreview.skip_paid_drifts === 1 ? "" : "s"} + {annealPreview.skip_orphans} orphan{annealPreview.skip_orphans === 1 ? "" : "s"}.
                    </span>
                  </p>
                  <button onClick={applyAnneal} disabled={annealPhase !== "preview"} className="ad-btn-primary text-xs">
                    Confirm &amp; anneal
                  </button>
                  <button onClick={() => setAnnealPhase("idle")} className="text-xs ad-text-3 hover:text-[var(--ad-text)]">
                    Cancel
                  </button>
                </>
              ) : annealPhase === "applying" ? (
                <p className="text-xs ad-text-3">Annealing…</p>
              ) : (
                <>
                  <p className="text-xs ad-text-1 flex-1">
                    {actionable} discrepanc{actionable === 1 ? "y" : "ies"} can be auto-fixed from User Transactions.
                  </p>
                  <button onClick={previewAnneal} disabled={annealPhase === "previewing"} className="ad-btn-primary text-xs">
                    {annealPhase === "previewing" ? "Checking…" : "Anneal the fixes"}
                  </button>
                </>
              )}
            </div>
          )}

          {annealResult && annealPhase === "done" && (
            <div className="p-3 bg-[rgba(52,211,153,0.10)] border border-[rgba(52,211,153,0.28)] rounded-xl">
              <p className="text-xs ad-text-1">
                ✓ Created {annealResult.created} · corrected {annealResult.corrected}
                {annealResult.already_existed > 0 && (
                  <span className="ad-text-3"> · {annealResult.already_existed} already existed</span>
                )}
                {annealResult.failed.length > 0 && (
                  <span className="text-[var(--ad-neg)]"> · {annealResult.failed.length} failed</span>
                )}
                <span className="ad-text-3"> · skipped {annealResult.skipped.paidDrifts} paid + {annealResult.skipped.orphans} orphans</span>
              </p>
              {annealResult.failed.length > 0 && (
                <ul className="mt-1 text-[10px] text-[var(--ad-neg)] list-disc pl-4">
                  {annealResult.failed.map((f) => <li key={f.id}>{f.id}: {f.reason}</li>)}
                </ul>
              )}
            </div>
          )}

          <p className="text-[10px] ad-text-3">
            Generated {new Date(result.generated_at).toLocaleString()}
          </p>

          {result.months.length === 0 && (
            <p className="text-xs ad-text-3">No months to report.</p>
          )}

          {result.months.map((m) => {
            const hasIssues = m.orphans.length > 0 || m.drifts.length > 0 || m.missing.length > 0;
            return (
              <details key={m.month} open={hasIssues} className="border border-[var(--ad-border)] rounded-xl overflow-hidden">
                <summary className="cursor-pointer px-4 py-3 bg-[var(--ad-inset)] flex items-center justify-between">
                  <span className="text-sm font-semibold ad-text-1">{m.month}</span>
                  <span className="text-[10px] ad-text-3 font-medium">
                    {m.ptl_count} PTL rows · {fmt.currency(m.ptl_sum)}
                    {hasIssues && (
                      <span className="ml-2 text-[var(--ad-neg)] font-semibold">
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
                          <thead className="ad-text-3 text-[10px] uppercase tracking-wider">
                            <tr><th className="text-left py-1">Email</th><th className="text-left">TxnID</th><th className="text-right">Amount</th><th className="text-left pl-3">Date</th><th className="text-left pl-3">PTL ID</th></tr>
                          </thead>
                          <tbody>
                            {m.orphans.map((o) => (
                              <tr key={o.ptl_id} className="border-t border-[var(--ad-border)]">
                                <td className="py-1">{o.user_email}</td>
                                <td className="font-mono text-[10px]">{o.transaction_id}</td>
                                <td className="text-right tabular-nums">{fmt.currency(o.amount)}</td>
                                <td className="pl-3 ad-text-3">{o.transaction_date.slice(0, 10)}</td>
                                <td className="pl-3 font-mono text-[10px] ad-text-3">{o.ptl_id}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </Section>
                    )}

                    {m.drifts.length > 0 && (
                      <Section title={`Amount drifts (${m.drifts.length})`} hint="PTL Amount differs from UT Amount">
                        <table className="w-full text-xs">
                          <thead className="ad-text-3 text-[10px] uppercase tracking-wider">
                            <tr><th className="text-left py-1">TxnID</th><th className="text-right">PTL</th><th className="text-right">UT</th><th className="text-right">Δ</th><th className="text-left pl-3">PTL ID</th></tr>
                          </thead>
                          <tbody>
                            {m.drifts.map((d) => (
                              <tr key={d.ptl_id} className="border-t border-[var(--ad-border)]">
                                <td className="py-1 font-mono text-[10px]">{d.transaction_id}</td>
                                <td className="text-right tabular-nums">{fmt.currency(d.ptl_amount)}</td>
                                <td className="text-right tabular-nums">{fmt.currency(d.ut_amount)}</td>
                                <td className={`text-right tabular-nums font-semibold ${d.delta > 0 ? "text-[#F4C152]" : "text-[var(--ad-neg)]"}`}>{fmt.currency(d.delta)}</td>
                                <td className="pl-3 font-mono text-[10px] ad-text-3">{d.ptl_id}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </Section>
                    )}

                    {m.missing.length > 0 && (
                      <Section title={`Missing from PTL (${m.missing.length})`} hint="UT Transfer In with referrer but no PTL row — affiliate under-paid">
                        <table className="w-full text-xs">
                          <thead className="ad-text-3 text-[10px] uppercase tracking-wider">
                            <tr><th className="text-left py-1">Email</th><th className="text-left">Referrer</th><th className="text-left">TxnID</th><th className="text-right">Amount</th><th className="text-left pl-3">Date</th><th className="text-right pl-3">Action</th></tr>
                          </thead>
                          <tbody>
                            {m.missing.map((mr) => {
                              const state = creating[mr.ut_id];
                              return (
                                <tr key={mr.ut_id} className="border-t border-[var(--ad-border)]">
                                  <td className="py-1">{mr.user_email}</td>
                                  <td className="font-mono text-[10px]">{mr.referrer}</td>
                                  <td className="font-mono text-[10px]">{mr.transaction_id}</td>
                                  <td className="text-right tabular-nums">{fmt.currency(mr.amount)}</td>
                                  <td className="pl-3 ad-text-3">{mr.transaction_date.slice(0, 10)}</td>
                                  <td className="pl-3 text-right">
                                    {state === "done" ? (
                                      <span className="text-[10px] text-[var(--ad-pos)] font-semibold">✓ Created</span>
                                    ) : state === "loading" ? (
                                      <span className="text-[10px] ad-text-3">Creating…</span>
                                    ) : state ? (
                                      <span className="text-[10px] text-[var(--ad-neg)]" title={state}>Error</span>
                                    ) : (
                                      <button
                                        onClick={() => createMissing(mr.ut_id)}
                                        className="text-[10px] font-semibold ad-accent-text underline decoration-dotted"
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
                  <p className="px-4 py-3 text-xs text-[var(--ad-pos)]">✓ Clean — PTL and UT match.</p>
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
    color === "red" ? "text-[var(--ad-neg)]" :
    color === "amber" ? "text-[#F4C152]" :
    "text-[var(--ad-pos)]";
  return (
    <div className="ad-inset px-3 py-3">
      <p className="text-[10px] ad-text-3 uppercase tracking-wider font-medium mb-1">{label}</p>
      <p className={`text-stat font-bold tabular-nums ${value > 0 ? cls : "ad-text-1"}`}>{value}</p>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold ad-text-1 mb-1">{title}</p>
      <p className="text-[10px] ad-text-3 mb-2">{hint}</p>
      {children}
    </div>
  );
}
