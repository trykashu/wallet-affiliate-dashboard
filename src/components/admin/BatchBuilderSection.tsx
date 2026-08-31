"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/fmt";
import { COMMISSION_RATES } from "@/lib/tier";
import Money from "./Money";
import BankPreviewDrawer, { type BankPreview } from "@/components/admin/BankPreviewDrawer";

export interface BatchBuilderEarning {
  id: string;
  affiliate_id: string;
  amount: number;                       // commission owed for this earning
  cash_collected: number;               // Kashu fee on the underlying txn
  tpv: number;                          // underlying transaction Total Payment Volume
  transaction_date: string | null;      // YYYY-MM-DD or null
  tier_at_earning: "gold" | "platinum" | "custom" | "master";
  custom_commission_rate: number | null;        // e.g. 0.075 for 7.5%
  custom_commission_basis: "tpv" | "kashu_fee" | null;
}

export interface BatchBuilderAffiliate {
  affiliate_id: string;
  affiliate_name: string;
  business_name: string | null;
  is_payable: boolean;        // has at least one verified payout_account
  contract_signed: boolean;   // agreement_status in ('Completed','signed')
  pandadoc_id: string | null;
  bank_review_reasons: string[];
}

interface Props {
  earnings: BatchBuilderEarning[];
  affiliates: BatchBuilderAffiliate[];
  availableMonths: string[];
}

interface AffiliateRow {
  affiliate_id: string;
  affiliate_name: string;
  business_name: string | null;
  is_payable: boolean;
  contract_signed: boolean;
  pandadoc_id: string | null;
  bank_review_reasons: string[];
  count: number;
  total: number;             // commission owed (sum of earning.amount)
  cash_collected: number;    // sum of Kashu fees on underlying txns
  tpv: number;               // sum of underlying TPV
  earning_ids: string[];
  /** Dominant tier across this affiliate's earnings in this month; "mixed" if not all the same. */
  tier: "gold" | "platinum" | "custom" | "master" | "mixed";
  /** Numeric rate as a fraction (e.g. 0.05 = 5%). Null if mixed. */
  rate: number | null;
  /** What the rate applies to. */
  basis: "tpv" | "kashu_fee" | "mixed" | null;
}

function rateForEarning(e: BatchBuilderEarning): { rate: number; basis: "tpv" | "kashu_fee" } {
  if (e.tier_at_earning === "platinum") return { rate: 0.10, basis: "kashu_fee" };
  if (e.tier_at_earning === "gold")     return { rate: 0.05, basis: "kashu_fee" };
  if (e.tier_at_earning === "master")   return { rate: COMMISSION_RATES.master, basis: "kashu_fee" };
  // custom
  return {
    rate: e.custom_commission_rate ?? 0,
    basis: e.custom_commission_basis ?? "kashu_fee",
  };
}

function rateLabel(rate: number | null, basis: "tpv" | "kashu_fee" | "mixed" | null): string {
  if (rate === null || basis === null) return "—";
  if (basis === "mixed") return "Mixed";
  const pct = (rate * 100).toFixed(2).replace(/\.?0+$/, "");
  return basis === "tpv" ? `${pct}% TPV` : `${pct}% fee`;
}

function tierBadgeClass(tier: AffiliateRow["tier"]): string {
  if (tier === "platinum") return "bg-[var(--ad-surface-2)] text-[var(--ad-text-1)] border-[var(--ad-border-strong)]";
  if (tier === "custom")   return "bg-[var(--ad-accent-soft)] text-[var(--ad-accent-strong)] border-[var(--ad-accent-border)]";
  if (tier === "master")   return "bg-[rgba(125,211,252,0.10)] text-[#7DD3FC] border-[rgba(125,211,252,0.26)]";
  if (tier === "mixed")    return "bg-[rgba(244,193,82,0.10)] text-[#F4C152] border-[rgba(244,193,82,0.26)]";
  return "bg-[rgba(244,193,82,0.10)] text-[#F4C152] border-[rgba(244,193,82,0.26)]"; // gold default
}
function tierLabel(tier: AffiliateRow["tier"]): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export default function BatchBuilderSection({ earnings, affiliates, availableMonths }: Props) {
  const router = useRouter();
  const [month, setMonth] = useState<string>(() => availableMonths[0] ?? "");
  const [selectedAffiliates, setSelectedAffiliates] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [previewState, setPreviewState] = useState<{
    affiliate_id: string;
    affiliate_name: string;
    pandadoc_id: string | null;
    preview: BankPreview | null;
    loading: boolean;
    submitting: boolean;
    error: string | null;
  } | null>(null);
  const [refetchError, setRefetchError] = useState<string | null>(null);

  async function openRefetchPreview(row: { affiliate_id: string; affiliate_name: string; pandadoc_id: string | null }) {
    setPreviewState({
      affiliate_id: row.affiliate_id,
      affiliate_name: row.affiliate_name,
      pandadoc_id: row.pandadoc_id,
      preview: null,
      loading: true,
      submitting: false,
      error: null,
    });
    setRefetchError(null);
    try {
      const res = await fetch("/api/admin/affiliates/refetch-bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ affiliate_id: row.affiliate_id, confirm: false }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.preview) {
        setPreviewState((prev) => prev ? { ...prev, loading: false, error: body?.message ?? `Fetch failed (${res.status})` } : null);
        return;
      }
      setPreviewState((prev) => prev ? { ...prev, loading: false, preview: body.preview as BankPreview } : null);
    } catch (e) {
      setPreviewState((prev) => prev ? { ...prev, loading: false, error: e instanceof Error ? e.message : "Fetch failed" } : null);
    }
  }

  async function confirmRefetch() {
    const current = previewState;
    if (!current) return;
    setPreviewState({ ...current, submitting: true, error: null });
    try {
      const res = await fetch("/api/admin/affiliates/refetch-bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ affiliate_id: current.affiliate_id, confirm: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.saved) {
        setPreviewState((prev) => prev ? { ...prev, submitting: false, error: body?.message ?? `Save failed (${res.status})` } : null);
        return;
      }
      setPreviewState(null);
      router.refresh();
    } catch (e) {
      setPreviewState((prev) => prev ? { ...prev, submitting: false, error: e instanceof Error ? e.message : "Save failed" } : null);
    }
  }

  const affMap = useMemo(() => {
    const m = new Map<string, BatchBuilderAffiliate>();
    for (const a of affiliates) m.set(a.affiliate_id, a);
    return m;
  }, [affiliates]);

  const rows: AffiliateRow[] = useMemo(() => {
    if (!month) return [];
    const grouped = new Map<string, AffiliateRow>();
    for (const e of earnings) {
      if (!e.transaction_date) continue;
      if (!e.transaction_date.startsWith(month)) continue;
      const aff = affMap.get(e.affiliate_id);
      const { rate, basis } = rateForEarning(e);
      const existing = grouped.get(e.affiliate_id);
      if (existing) {
        existing.count += 1;
        existing.total += Number(e.amount) || 0;
        existing.cash_collected += Number(e.cash_collected) || 0;
        existing.tpv += Number(e.tpv) || 0;
        existing.earning_ids.push(e.id);
        // Detect drift across earnings for the same affiliate
        if (existing.tier !== "mixed" && existing.tier !== e.tier_at_earning) {
          existing.tier = "mixed";
          existing.rate = null;
          existing.basis = "mixed";
        } else if (existing.rate !== null && Math.abs(existing.rate - rate) > 1e-9) {
          existing.rate = null;
          existing.basis = "mixed";
          existing.tier = "mixed";
        }
      } else {
        grouped.set(e.affiliate_id, {
          affiliate_id: e.affiliate_id,
          affiliate_name: aff?.affiliate_name ?? "Unknown",
          business_name: aff?.business_name ?? null,
          is_payable: aff?.is_payable ?? false,
          contract_signed: aff?.contract_signed ?? false,
          pandadoc_id: aff?.pandadoc_id ?? null,
          bank_review_reasons: aff?.bank_review_reasons ?? [],
          count: 1,
          total: Number(e.amount) || 0,
          cash_collected: Number(e.cash_collected) || 0,
          tpv: Number(e.tpv) || 0,
          earning_ids: [e.id],
          tier: e.tier_at_earning,
          rate,
          basis,
        });
      }
    }
    return Array.from(grouped.values()).sort((a, b) => b.total - a.total);
  }, [earnings, month, affMap]);

  const submittableRows = useMemo(
    () => rows.filter((r) => r.is_payable && r.contract_signed && selectedAffiliates.has(r.affiliate_id)),
    [rows, selectedAffiliates]
  );

  const submittableEarningIds = useMemo(
    () => submittableRows.flatMap((r) => r.earning_ids),
    [submittableRows]
  );

  const submittableTotal = useMemo(
    () => submittableRows.reduce((s, r) => s + r.total, 0),
    [submittableRows]
  );

  const submittableTpv = useMemo(
    () => submittableRows.reduce((s, r) => s + r.tpv, 0),
    [submittableRows]
  );

  const submittableCashCollected = useMemo(
    () => submittableRows.reduce((s, r) => s + r.cash_collected, 0),
    [submittableRows]
  );

  const allEligibleAffiliateIds = useMemo(
    () => new Set(rows.filter((r) => r.is_payable && r.contract_signed).map((r) => r.affiliate_id)),
    [rows]
  );

  function toggleAffiliate(id: string) {
    setSelectedAffiliates((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedAffiliates.size === allEligibleAffiliateIds.size && allEligibleAffiliateIds.size > 0) {
      setSelectedAffiliates(new Set());
    } else {
      setSelectedAffiliates(new Set(allEligibleAffiliateIds));
    }
  }

  function openDrawer() {
    if (submittableEarningIds.length === 0) return;
    setError(null);
    setDrawerOpen(true);
  }

  async function handleSubmit() {
    if (submittableEarningIds.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payouts/create-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          earning_ids: submittableEarningIds,
          period: month,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? body?.error ?? `Submit failed (${res.status})`);
      }
      setDrawerOpen(false);
      setNotes("");
      setSelectedAffiliates(new Set());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  const allSelected = selectedAffiliates.size > 0 && selectedAffiliates.size === allEligibleAffiliateIds.size;

  if (availableMonths.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-bold ad-text-3 uppercase tracking-wider">Prepare batch</h2>
          <p className="text-xs ad-text-3 mt-0.5">Approved earnings grouped by affiliate for the chosen month.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={month}
            onChange={(e) => { setMonth(e.target.value); setSelectedAffiliates(new Set()); }}
            className="text-xs ad-select px-2.5 py-1.5"
          >
            {availableMonths.map((m) => (
              <option key={m} value={m}>{formatMonthLabel(m)}</option>
            ))}
          </select>
          <button
            onClick={openDrawer}
            disabled={submittableEarningIds.length === 0 || submitting}
            className="ad-btn-primary text-xs rounded-xl px-3 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Submit for review ({submittableRows.length})
          </button>
        </div>
      </div>

      {error && (
        <div className="ad-card p-3 bg-[rgba(242,112,110,0.10)] border border-[rgba(242,112,110,0.28)]">
          <p className="text-xs text-[var(--ad-neg)]">{error}</p>
        </div>
      )}

      {refetchError && (
        <div className="ad-card p-3 bg-[rgba(242,112,110,0.10)] border border-[rgba(242,112,110,0.28)]">
          <p className="text-xs text-[var(--ad-neg)]">{refetchError}</p>
          <button onClick={() => setRefetchError(null)} className="text-[10px] text-[var(--ad-neg)] underline mt-1">Dismiss</button>
        </div>
      )}

      {/* Running batch total — updates as AM selects/deselects. Shows the
          full TPV → Kashu Fee → Commission chain so the calculation is
          transparent at a glance. */}
      <div className="ad-card p-4 space-y-3 bg-[var(--ad-inset)] border border-[var(--ad-border)]">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <p className="text-[10px] ad-text-3 uppercase tracking-wider font-medium">Volume Referred (TPV)</p>
            <p className="text-stat font-bold ad-text-1"><Money value={submittableTpv} /></p>
          </div>
          <div className="hidden md:flex items-center justify-center ad-text-3">→</div>
          <div>
            <p className="text-[10px] ad-text-3 uppercase tracking-wider font-medium">Cash Collected (Kashu Fee)</p>
            <p className="text-stat font-bold ad-text-1"><Money value={submittableCashCollected} /></p>
          </div>
          <div className="hidden md:flex items-center justify-center ad-text-3">→</div>
          <div>
            <p className="text-[10px] ad-text-3 uppercase tracking-wider font-medium">Commission Owed</p>
            <p className="text-display-sm font-bold ad-pos"><Money value={submittableTotal} /></p>
          </div>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-[var(--ad-border)]">
          <div className="flex items-center gap-4 text-[10px] ad-text-3">
            <span><span className="font-semibold ad-text-1 tabular-nums">{submittableRows.length}</span> affiliates</span>
            <span>·</span>
            <span><span className="font-semibold ad-text-1 tabular-nums">{submittableEarningIds.length}</span> earnings</span>
            {submittableRows.length > 0 && (
              <>
                <span>·</span>
                <span>Avg <span className="font-semibold ad-text-1">{fmt.currency(submittableTotal / submittableRows.length)}</span> per affiliate</span>
              </>
            )}
          </div>
          {submittableCashCollected > 0 && (
            <p className="text-[10px] ad-text-3">
              Effective rate: <span className="font-semibold ad-text-1 tabular-nums">{((submittableTotal / submittableCashCollected) * 100).toFixed(2)}% of fee</span>
            </p>
          )}
        </div>
      </div>

      <div className="ad-card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-6 text-center text-sm ad-text-3">
            No approved + unbatched earnings in {formatMonthLabel(month)}.
          </div>
        ) : (
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-[var(--ad-border)] bg-[var(--ad-inset)]">
                <th className="ad-th w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded border-[var(--ad-border)] accent-[#00DE8F]"
                    aria-label="Select all"
                  />
                </th>
                <th className="ad-th">Affiliate</th>
                <th className="ad-th">Tier</th>
                <th className="ad-th text-right">Rate</th>
                <th className="ad-th text-right hidden md:table-cell">Volume (TPV)</th>
                <th className="ad-th text-right hidden md:table-cell">Cash Collected</th>
                <th className="ad-th text-right hidden xl:table-cell">Earnings</th>
                <th className="ad-th text-right">Commission</th>
                <th className="ad-th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ad-border)]">
              {rows.map((r) => {
                const eligible = r.is_payable && r.contract_signed;
                const checked = selectedAffiliates.has(r.affiliate_id);
                return (
                  <tr key={r.affiliate_id} className={`hover:bg-[var(--ad-surface-2)] transition-colors ${!eligible ? "opacity-60" : ""}`}>
                    <td className="ad-td w-10">
                      {eligible ? (
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAffiliate(r.affiliate_id)}
                          className="rounded border-[var(--ad-border)] accent-[#00DE8F]"
                          aria-label={`Select ${r.affiliate_name}`}
                        />
                      ) : (
                        <span title={!r.contract_signed ? "Contract not signed" : "No verified payout account"}
                              className="inline-flex w-4 h-4 items-center justify-center ad-text-3">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round"
                              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
                          </svg>
                        </span>
                      )}
                    </td>
                    <td className="ad-td">
                      <p className="text-sm font-semibold ad-text-1 truncate">{r.affiliate_name}</p>
                      {r.business_name && <p className="text-[10px] ad-text-3 truncate">{r.business_name}</p>}
                    </td>
                    <td className="ad-td">
                      <span className={`inline-flex items-center text-[10px] font-semibold border rounded-full px-2 py-0.5 ${tierBadgeClass(r.tier)}`}>
                        {tierLabel(r.tier)}
                      </span>
                    </td>
                    <td className="ad-td text-right text-xs tabular-nums ad-text-2">{rateLabel(r.rate, r.basis)}</td>
                    <td className="ad-td text-right text-xs ad-text-2 tabular-nums hidden md:table-cell">{fmt.currency(r.tpv)}</td>
                    <td className="ad-td text-right text-xs ad-text-2 tabular-nums hidden md:table-cell">{fmt.currency(r.cash_collected)}</td>
                    <td className="ad-td text-right text-xs ad-text-2 tabular-nums hidden xl:table-cell">{fmt.count(r.count)}</td>
                    <td className="ad-td text-right"><Money value={r.total} className="text-sm font-bold ad-text-1" /></td>
                    <td className="ad-td">
                      {!r.contract_signed && (
                        <span className="ad-badge ad-badge-neg text-[10px]">Contract pending</span>
                      )}
                      {r.contract_signed && !r.is_payable && (
                        <div className="flex items-center gap-2">
                          <span className="ad-badge ad-badge-amber text-[10px]">No bank on file</span>
                          {r.pandadoc_id && (
                            <button
                              onClick={() => openRefetchPreview({ affiliate_id: r.affiliate_id, affiliate_name: r.affiliate_name, pandadoc_id: r.pandadoc_id })}
                              disabled={previewState?.affiliate_id === r.affiliate_id}
                              title="Re-fetch bank details from PandaDoc"
                              className="text-[10px] font-semibold ad-accent-text hover:underline decoration-dotted disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {previewState?.affiliate_id === r.affiliate_id ? "…" : "Refetch"}
                            </button>
                          )}
                        </div>
                      )}
                      {eligible && (
                        <div className="flex items-center gap-2">
                          <span className="ad-badge ad-badge-pos text-[10px]">Ready</span>
                          {r.bank_review_reasons.length > 0 && (
                            <span
                              title={r.bank_review_reasons.join(" · ")}
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#F4C152] bg-[rgba(244,193,82,0.10)] border border-[rgba(244,193,82,0.26)] rounded-full px-2 py-0.5"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.732 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
                              Review
                            </span>
                          )}
                          {r.pandadoc_id && (
                            <button
                              onClick={() => openRefetchPreview({ affiliate_id: r.affiliate_id, affiliate_name: r.affiliate_name, pandadoc_id: r.pandadoc_id })}
                              disabled={previewState?.affiliate_id === r.affiliate_id}
                              title="Re-verify bank details against PandaDoc"
                              className="text-[10px] font-semibold ad-accent-text hover:underline decoration-dotted disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {previewState?.affiliate_id === r.affiliate_id ? "…" : "Re-verify"}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {drawerOpen && (
        <>
          <div className="drawer-backdrop" onClick={() => !submitting && setDrawerOpen(false)} />
          <div className="drawer-panel">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-[10px] font-bold ad-text-3 uppercase tracking-wider">Payout batch</p>
                <h2 className="text-xl font-bold ad-text-1 mt-1">Submit for Finance review</h2>
              </div>
              <button
                onClick={() => !submitting && setDrawerOpen(false)}
                className="text-sm ad-text-3 hover:text-[var(--ad-text)]"
                aria-label="Close drawer"
              >Close</button>
            </div>

            <div className="space-y-4">
              <div className="ad-card p-4 bg-[var(--ad-inset)]">
                <p className="text-[10px] font-bold ad-text-3 uppercase tracking-wider mb-2">Summary</p>
                <div className="flex items-center justify-between">
                  <p className="text-sm ad-text-1">{submittableRows.length} affiliate{submittableRows.length === 1 ? "" : "s"}, {submittableEarningIds.length} earning{submittableEarningIds.length === 1 ? "" : "s"}</p>
                  <p className="text-base font-bold ad-text-1"><Money value={submittableTotal} /></p>
                </div>
                <p className="text-[10px] ad-text-3 mt-2">Period: {formatMonthLabel(month)}</p>
              </div>

              <div>
                <label className="text-[10px] font-bold ad-text-3 uppercase tracking-wider">Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value.slice(0, 500))}
                  disabled={submitting}
                  rows={3}
                  placeholder="Anything Finance should know about this batch…"
                  className="mt-1 ad-input w-full resize-none"
                />
                <p className="text-[10px] ad-text-3 mt-1 tabular-nums">{notes.length}/500</p>
              </div>

              {error && (
                <div className="ad-card p-3 bg-[rgba(242,112,110,0.10)] border border-[rgba(242,112,110,0.28)]">
                  <p className="text-xs text-[var(--ad-neg)]">{error}</p>
                </div>
              )}

              <div className="pt-3 border-t border-[var(--ad-border)] flex items-center justify-end gap-2">
                <button
                  onClick={() => setDrawerOpen(false)}
                  disabled={submitting}
                  className="text-xs font-semibold ad-text-3 hover:text-[var(--ad-text)] px-3 py-2"
                >Cancel</button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting || submittableEarningIds.length === 0}
                  className="ad-btn-primary text-xs rounded-xl px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >{submitting ? "Submitting…" : "Send to Finance"}</button>
              </div>
            </div>
          </div>
        </>
      )}

      <BankPreviewDrawer
        open={previewState !== null}
        affiliateName={previewState?.affiliate_name ?? null}
        pandadocId={previewState?.pandadoc_id ?? null}
        preview={previewState?.preview ?? null}
        loading={previewState?.loading ?? false}
        submitting={previewState?.submitting ?? false}
        error={previewState?.error ?? null}
        onClose={() => { if (previewState?.submitting !== true) setPreviewState(null); }}
        onConfirm={confirmRefetch}
      />
    </div>
  );
}

function formatMonthLabel(yyyyMm: string): string {
  if (!yyyyMm) return "—";
  const [y, m] = yyyyMm.split("-").map(Number);
  if (!y || !m) return yyyyMm;
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { year: "numeric", month: "long" });
}
