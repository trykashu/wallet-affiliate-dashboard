"use client";

import { useMemo, useState } from "react";
import { fmt } from "@/lib/fmt";
import Money from "./Money";

export interface TopAffiliateRow {
  affiliate_id: string;
  agent_name: string;
  business_name: string | null;
  volume: number;
  earnings: number;
  users: number;
  agreement_status: string;
}

type SortKey = "volume" | "earnings";

function statusBadge(status: string): { cls: string; label: string } {
  switch (status) {
    case "Completed":
      return { cls: "ad-badge-pos", label: "Signed" };
    case "Pending Partner Signature":
      return { cls: "ad-badge-amber", label: "Pending" };
    case "Declined":
      return { cls: "ad-badge-neg", label: "Declined" };
    default:
      return { cls: "ad-badge-neutral", label: "Not created" };
  }
}

export default function TopAffiliatesTable({ rows }: { rows: TopAffiliateRow[] }) {
  const [sort, setSort] = useState<SortKey>("volume");
  const [selected, setSelected] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => b[sort] - a[sort]),
    [rows, sort]
  );

  return (
    <div className="ad-card overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between gap-4" style={{ borderBottom: "1px solid var(--ad-border)" }}>
        <div>
          <h3 className="text-sm font-semibold ad-text-1">Top Affiliates</h3>
          <p className="text-[11px] ad-text-3 mt-0.5">Ranked by {sort === "volume" ? "referred volume" : "commission"}</p>
        </div>
        {/* Sort toggle — segmented control */}
        <div className="flex items-center gap-1 p-0.5 rounded-full" style={{ backgroundColor: "var(--ad-inset)", border: "1px solid var(--ad-border)" }}>
          {(["volume", "earnings"] as SortKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className="text-[11px] font-medium px-3 py-1 rounded-full transition-colors"
              style={
                sort === k
                  ? { backgroundColor: "var(--ad-accent-soft)", color: "var(--ad-accent-strong)" }
                  : { color: "var(--ad-text-3)" }
              }
            >
              {k === "volume" ? "Volume" : "Commission"}
            </button>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm ad-text-3">No affiliate activity recorded yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th className="ad-th w-10 text-right">#</th>
                <th className="ad-th">Affiliate</th>
                <th className="ad-th text-right">Users</th>
                <th className="ad-th text-right">Volume</th>
                <th className="ad-th text-right">Commission</th>
                <th className="ad-th">Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const badge = statusBadge(r.agreement_status);
                const isSel = selected === r.affiliate_id;
                return (
                  <tr
                    key={r.affiliate_id}
                    onClick={() => setSelected(isSel ? null : r.affiliate_id)}
                    className={`ad-row cursor-pointer ${isSel ? "ad-row-selected" : ""}`}
                  >
                    <td className="ad-td text-right tabular-nums ad-text-3">{i + 1}</td>
                    <td className="ad-td">
                      <p className="text-sm font-medium ad-text-1 truncate max-w-[200px]">{r.agent_name}</p>
                      {r.business_name && <p className="text-[11px] ad-text-3 truncate max-w-[200px]">{r.business_name}</p>}
                    </td>
                    <td className="ad-td text-right tabular-nums">{fmt.count(r.users)}</td>
                    <td className="ad-td text-right ad-text-1"><Money value={r.volume} compact /></td>
                    <td className="ad-td text-right ad-text-1"><Money value={r.earnings} compact /></td>
                    <td className="ad-td">
                      <span className={`ad-badge ${badge.cls}`}>{badge.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
