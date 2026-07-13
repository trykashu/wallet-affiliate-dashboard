"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface DelegateRow {
  id: string;
  delegate_name: string;
  delegate_email: string;
  delegate_user_id: string | null;
  accepted_at: string | null;
  can_view_earnings: boolean;
  can_view_payouts: boolean;
}

export default function DelegateAccessCard({ initialDelegates }: { initialDelegates: DelegateRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [viewEarnings, setViewEarnings] = useState(false);
  const [viewPayouts, setViewPayouts] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSuccess(null); setSubmitting(true);
    try {
      const res = await fetch("/api/dashboard/delegates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delegate_name: name,
          delegate_email: email,
          can_view_earnings: viewEarnings,
          can_view_payouts: viewPayouts,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "Could not send invite."); return; }
      setSuccess(`Invite sent to ${email}.`);
      setName(""); setEmail(""); setViewEarnings(false); setViewPayouts(false);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function updatePerm(id: string, patch: Partial<Pick<DelegateRow, "can_view_earnings" | "can_view_payouts">>) {
    setBusyId(id); setError(null);
    try {
      const res = await fetch(`/api/dashboard/delegates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error ?? "Update failed."); return; }
      router.refresh();
    } catch { setError("Network error."); }
    finally { setBusyId(null); }
  }

  async function revoke(id: string, delegateName: string) {
    if (!confirm(`Revoke ${delegateName}'s access? They will immediately lose access to your dashboard.`)) return;
    setBusyId(id); setError(null);
    try {
      const res = await fetch(`/api/dashboard/delegates/${id}`, { method: "DELETE" });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error ?? "Revoke failed."); return; }
      router.refresh();
    } catch { setError("Network error."); }
    finally { setBusyId(null); }
  }

  return (
    <div className="card p-6 flex flex-col gap-5">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Delegate Access</h3>
        <p className="text-xs text-brand-400 mt-0.5">
          Invite a teammate to view your referrals and conversions. They won&apos;t see earnings or
          payout details unless you allow it.
        </p>
      </div>

      <form onSubmit={invite} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input className="input-base" placeholder="Teammate name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input className="input-base" type="email" placeholder="teammate@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={viewEarnings} onChange={(e) => setViewEarnings(e.target.checked)} />
            Can view earnings
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={viewPayouts} onChange={(e) => setViewPayouts(e.target.checked)} />
            Can view payouts
          </label>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-accent">{success}</p>}
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Sending…" : "Send invite"}
        </button>
      </form>

      {initialDelegates.length > 0 ? (
        <div className="border-t border-surface-200/60 pt-4 space-y-3">
          {initialDelegates.map((d) => (
            <div key={d.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{d.delegate_name}</p>
                <p className="text-xs text-brand-400 truncate">{d.delegate_email}</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className={d.accepted_at ? "badge-accent" : "badge-amber"}>
                  {d.accepted_at ? "Active" : "Pending"}
                </span>
                <label className="flex items-center gap-1.5 text-xs text-gray-600">
                  <input type="checkbox" checked={d.can_view_earnings} disabled={busyId === d.id}
                    onChange={(e) => updatePerm(d.id, { can_view_earnings: e.target.checked })} />
                  Earnings
                </label>
                <label className="flex items-center gap-1.5 text-xs text-gray-600">
                  <input type="checkbox" checked={d.can_view_payouts} disabled={busyId === d.id}
                    onChange={(e) => updatePerm(d.id, { can_view_payouts: e.target.checked })} />
                  Payouts
                </label>
                <button type="button" onClick={() => revoke(d.id, d.delegate_name)} disabled={busyId === d.id}
                  className="text-xs font-semibold text-red-600 hover:text-red-700">
                  Revoke
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-brand-400 border-t border-surface-200/60 pt-4">No delegates yet.</p>
      )}
    </div>
  );
}
