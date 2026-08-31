"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/fmt";
import Money from "./Money";
import type { BatchSummary } from "./BatchReviewSection";

interface Props {
  batches: BatchSummary[];
}

export default function RequestedBatchesSection({ batches }: Props) {
  const router = useRouter();
  const [busyBatchId, setBusyBatchId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reverifyingAffId, setReverifyingAffId] = useState<string | null>(null);
  const [reverifyMsg, setReverifyMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [addressModal, setAddressModal] = useState<{ affiliate_id: string; affiliate_name: string } | null>(null);

  async function handleReverify(affiliateId: string, affiliateName: string) {
    if (!confirm(`Re-verify bank details for ${affiliateName} from PandaDoc?\n\nThis will fetch the latest signed agreement and overwrite the address on file.`)) return;
    setReverifyingAffId(affiliateId);
    setReverifyMsg(null);
    try {
      const res = await fetch("/api/admin/affiliates/refetch-bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ affiliate_id: affiliateId, confirm: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.saved === false) {
        throw new Error(body?.message ?? body?.error ?? `Re-verify failed (${res.status})`);
      }
      setReverifyMsg({ kind: "ok", text: `Re-verified ${affiliateName} — address pulled from PandaDoc. Try Execute again.` });
      router.refresh();
    } catch (e) {
      setReverifyMsg({ kind: "err", text: `${affiliateName}: ${e instanceof Error ? e.message : "Re-verify failed"}` });
    } finally {
      setReverifyingAffId(null);
    }
  }

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
        <h2 className="text-sm font-bold ad-text-3 uppercase tracking-wider">Ready to execute</h2>
        <p className="text-xs ad-text-3 mt-0.5">{batches.length} batch{batches.length === 1 ? "" : "es"} approved · awaiting Mercury</p>
      </div>

      {error && (
        <div className="ad-card p-4 bg-[rgba(242,112,110,0.12)] border-2 border-[rgba(242,112,110,0.4)]">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-[var(--ad-neg)] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.732 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-bold text-[var(--ad-neg)]">Mercury execute failed</p>
              <p className="text-xs text-[var(--ad-neg)] mt-1 whitespace-pre-wrap">{error}</p>
              <button onClick={() => setError(null)} className="text-[10px] text-[var(--ad-neg)] underline mt-2">Dismiss</button>
            </div>
          </div>
        </div>
      )}

      {reverifyMsg && (
        <div className={`card p-3 ${reverifyMsg.kind === "ok" ? "bg-[rgba(52,211,153,0.10)] border border-[rgba(52,211,153,0.28)]" : "bg-[rgba(242,112,110,0.10)] border border-[rgba(242,112,110,0.28)]"}`}>
          <p className={`text-xs ${reverifyMsg.kind === "ok" ? "text-[var(--ad-pos)]" : "text-[var(--ad-neg)]"}`}>{reverifyMsg.text}</p>
          <button onClick={() => setReverifyMsg(null)} className="text-[10px] underline mt-1 ad-text-3">Dismiss</button>
        </div>
      )}

      <div className="space-y-3">
        {batches.map((b) => {
          const missingCount = b.payouts.filter((p) => !p.has_address).length;
          return (
          <div key={b.batch_id} className="ad-card overflow-hidden">
            <div className="p-4 flex items-center justify-between gap-3 border-b border-[var(--ad-border)]">
              <div className="min-w-0">
                <p className="text-sm font-semibold ad-text-1">Period {b.period}</p>
                <p className="text-[10px] ad-text-3 mt-0.5">
                  {b.payout_count} payout{b.payout_count === 1 ? "" : "s"}
                  {missingCount > 0 && (
                    <span className="ml-2 text-[#F4C152] font-semibold">· {missingCount} missing address</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <Money value={b.total_amount} className="text-base font-bold ad-text-1" />
                <button
                  onClick={() => handleExecute(b)}
                  disabled={busyBatchId === b.batch_id}
                  className="ad-btn-primary text-xs rounded-xl px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >{busyBatchId === b.batch_id ? "Executing…" : "Execute via Mercury"}</button>
              </div>
            </div>

            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[var(--ad-inset)] ad-text-3 uppercase tracking-wider text-[10px]">
                  <th className="ad-th text-left">Affiliate</th>
                  <th className="ad-th text-right">Amount</th>
                  <th className="ad-th text-left">Address</th>
                  <th className="ad-th text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ad-border)]">
                {b.payouts.map((p) => (
                  <tr key={p.id} className="hover:bg-[var(--ad-surface-2)]">
                    <td className="ad-td">
                      <span className="text-sm ad-text-1">{p.affiliate_name}</span>
                    </td>
                    <td className="ad-td text-right"><Money value={p.amount} className="ad-text-2" /></td>
                    <td className="ad-td">
                      {p.has_address ? (
                        <span className="text-[10px] text-[var(--ad-pos)]">✓ Complete</span>
                      ) : (
                        <span className="text-[10px] text-[#F4C152] font-semibold">✗ Missing</span>
                      )}
                    </td>
                    <td className="ad-td text-right">
                      <div className="flex items-center justify-end gap-2">
                        {p.pandadoc_id && (
                          <button
                            onClick={() => handleReverify(p.affiliate_id, p.affiliate_name)}
                            disabled={reverifyingAffId === p.affiliate_id}
                            title="Re-fetch bank details + address from PandaDoc and save"
                            className={`text-[10px] font-semibold underline decoration-dotted disabled:opacity-50 disabled:cursor-not-allowed ${
                              p.has_address ? "ad-accent-text" : "text-[#F4C152] hover:opacity-80"
                            }`}
                          >
                            {reverifyingAffId === p.affiliate_id ? "Re-verifying…" : "Re-verify from PandaDoc"}
                          </button>
                        )}
                        {!p.has_address && (
                          <button
                            onClick={() => setAddressModal({ affiliate_id: p.affiliate_id, affiliate_name: p.affiliate_name })}
                            title="Manually enter address — use when PandaDoc Re-verify fails"
                            className="text-[10px] font-semibold ad-accent-text hover:underline decoration-dotted"
                          >
                            Enter address manually
                          </button>
                        )}
                        {p.has_address && !p.pandadoc_id && (
                          <span className="text-[10px] ad-text-3">No PandaDoc</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          );
        })}
      </div>

      {addressModal && (
        <AddressModal
          affiliateId={addressModal.affiliate_id}
          affiliateName={addressModal.affiliate_name}
          onClose={() => setAddressModal(null)}
          onSaved={() => {
            setAddressModal(null);
            setReverifyMsg({ kind: "ok", text: `Address saved for ${addressModal.affiliate_name}. Try Execute again.` });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function AddressModal({
  affiliateId,
  affiliateName,
  onClose,
  onSaved,
}: {
  affiliateId: string;
  affiliateName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSave =
    address1.trim().length >= 2 &&
    city.trim().length >= 2 &&
    /^[A-Za-z]{2}$/.test(region.trim()) &&
    /^\d{5}(-\d{4})?$/.test(postalCode.trim());

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/affiliates/${affiliateId}/address`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address1: address1.trim(),
          address2: address2.trim() || null,
          city: city.trim(),
          region: region.trim().toUpperCase(),
          postal_code: postalCode.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `Save failed (${res.status})`);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={() => !busy && onClose()} />
      <div className="drawer-panel max-w-md">
        <div className="mb-4">
          <p className="text-[10px] font-bold ad-text-3 uppercase tracking-wider">Manual address</p>
          <h2 className="text-lg font-bold ad-text-1 mt-1">Enter address for {affiliateName}</h2>
          <p className="text-xs ad-text-3 mt-1">Required by Mercury to create the ACH recipient. Saved to the affiliate&apos;s default payout account.</p>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-bold ad-text-3 uppercase tracking-wider">Address Line 1</label>
            <input value={address1} onChange={(e) => setAddress1(e.target.value)} placeholder="304 S. Jones Blvd" className="ad-input w-full px-3 py-2 rounded-xl text-sm mt-1" />
          </div>
          <div>
            <label className="text-[10px] font-bold ad-text-3 uppercase tracking-wider">Address Line 2 (optional)</label>
            <input value={address2} onChange={(e) => setAddress2(e.target.value)} placeholder="Suite 100" className="ad-input w-full px-3 py-2 rounded-xl text-sm mt-1" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="text-[10px] font-bold ad-text-3 uppercase tracking-wider">City</label>
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Las Vegas" className="ad-input w-full px-3 py-2 rounded-xl text-sm mt-1" />
            </div>
            <div>
              <label className="text-[10px] font-bold ad-text-3 uppercase tracking-wider">State</label>
              <input value={region} onChange={(e) => setRegion(e.target.value.toUpperCase().slice(0, 2))} placeholder="NV" maxLength={2} className="ad-input w-full px-3 py-2 rounded-xl text-sm mt-1 uppercase tabular-nums" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold ad-text-3 uppercase tracking-wider">ZIP Code</label>
            <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="89107" maxLength={10} className="ad-input w-full px-3 py-2 rounded-xl text-sm mt-1 tabular-nums" />
          </div>
        </div>
        {err && (
          <div className="mt-3 bg-[rgba(242,112,110,0.10)] border border-[rgba(242,112,110,0.28)] rounded-xl px-3 py-2 text-xs text-[var(--ad-neg)]">{err}</div>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="text-xs font-semibold ad-text-2 px-3 py-2">Cancel</button>
          <button
            onClick={save}
            disabled={!canSave || busy}
            className="ad-btn-primary text-xs px-4 py-2 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Saving…" : "Save address"}
          </button>
        </div>
      </div>
    </>
  );
}
