"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/fmt";
import { DIRECT_KEY, type SubRollupRow } from "@/lib/sub-affiliates/rollup";

interface Props {
  rows: SubRollupRow[];
  showEarnings: boolean;
  canEditLabels: boolean;
}

export default function SubAffiliateRoster({ rows, showEarnings, canEditLabels }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft]     = useState("");
  const [saving, setSaving]   = useState(false);

  async function saveLabel(subId: string) {
    setSaving(true);
    try {
      const res = await fetch("/api/sub-affiliates/label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sub_affiliate_id: subId, label: draft.trim() }),
      });
      if (res.ok) {
        setEditing(null);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="card p-16 text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-2xl bg-surface-100 flex items-center justify-center">
          <svg className="w-6 h-6 text-brand-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128H5.228A2 2 0 013 17.208V5.792A2 2 0 015.228 3.872h13.544A2 2 0 0121 5.792v3.284M15 19.128a9.38 9.38 0 00-2.625.372M12 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-900">No referred users yet</p>
        <p className="text-xs text-brand-400 mt-1">Sub-affiliates appear here once tagged sign-ups arrive.</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-surface-200/60">
        <h3 className="text-sm font-semibold text-gray-900">
          Sub-Affiliate Roster
          <span className="ml-2 text-xs font-normal text-brand-400">
            {rows.filter((r) => r.subId !== DIRECT_KEY).length} tagged
          </span>
        </h3>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-surface-200/60 bg-surface-100/40">
              <th className="th">Sub-Affiliate</th>
              <th className="th text-right">Users</th>
              <th className="th text-right hidden sm:table-cell">Transacted</th>
              <th className="th text-right hidden md:table-cell">Conversion</th>
              <th className="th text-right">Volume</th>
              {showEarnings && <th className="th text-right">Earnings</th>}
              <th className="th text-right hidden lg:table-cell">Last Activity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-200/60">
            {rows.map((r) => {
              const isDirect = r.subId === DIRECT_KEY;
              return (
                <tr key={r.subId} className="hover:bg-surface-50/80 transition-colors duration-100">
                  <td className="td">
                    {isDirect ? (
                      <span className="text-sm font-medium text-brand-400">Direct (untagged)</span>
                    ) : editing === r.subId ? (
                      <form
                        onSubmit={(e) => { e.preventDefault(); saveLabel(r.subId); }}
                        className="flex items-center gap-2"
                      >
                        <input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          maxLength={120}
                          placeholder="Name this sub-affiliate"
                          className="input-base rounded-xl text-sm px-2.5 py-1 w-44"
                        />
                        <button type="submit" disabled={saving} className="btn-primary text-xs px-2.5 py-1 rounded-xl">
                          {saving ? "…" : "Save"}
                        </button>
                        <button type="button" onClick={() => setEditing(null)} className="text-xs text-brand-400 hover:text-gray-900 transition-colors">
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate" title={r.label ?? r.subId}>
                            {r.label ?? r.subId}
                          </p>
                          {r.label && (
                            <p className="text-[10px] text-brand-400 tabular-nums truncate" title={r.subId}>{r.subId}</p>
                          )}
                        </div>
                        {canEditLabels && (
                          <button
                            onClick={() => { setEditing(r.subId); setDraft(r.label ?? ""); }}
                            className="text-[10px] text-brand-400 hover:text-brand-600 font-medium flex-shrink-0 transition-colors"
                            aria-label={`Edit label for ${r.subId}`}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="td text-right tabular-nums">{fmt.count(r.userCount)}</td>
                  <td className="td text-right tabular-nums hidden sm:table-cell">{fmt.count(r.transactedCount)}</td>
                  <td className="td text-right tabular-nums hidden md:table-cell">{fmt.percent(r.conversionPct / 100)}</td>
                  <td className="td text-right text-sm font-semibold text-gray-900 tabular-nums">{fmt.currency(r.volume)}</td>
                  {showEarnings && (
                    <td className="td text-right text-sm font-semibold text-accent tabular-nums">{fmt.currency(r.earningsTotal)}</td>
                  )}
                  <td className="td text-right text-xs text-brand-400 tabular-nums hidden lg:table-cell">
                    {r.lastActivity ? fmt.date(r.lastActivity) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
