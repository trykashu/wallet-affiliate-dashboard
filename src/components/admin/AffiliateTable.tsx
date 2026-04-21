"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/fmt";
import TierBadge from "@/components/ui/TierBadge";
import InviteAffiliateModal from "@/components/admin/InviteAffiliateModal";
import type { AffiliateWithCounts } from "@/app/admin/affiliates/page";
import type { AffiliateStatus, AffiliateTier } from "@/types/database";

type SortKey = "users" | "volume" | "earnings" | "joined";

export default function AffiliateTable({ affiliates }: { affiliates: AffiliateWithCounts[] }) {
  const router = useRouter();
  const [sortKey,   setSortKey]   = useState<SortKey>("users");
  const [sortDir,   setSortDir]   = useState<"desc" | "asc">("desc");
  const [search,    setSearch]    = useState("");
  const [statusFilter, setStatusFilter] = useState<AffiliateStatus | "all">("all");
  const [tierFilter,   setTierFilter]   = useState<AffiliateTier | "all">("all");
  const [bankFilter,   setBankFilter]   = useState<"all" | "yes" | "no">("all");
  const [viewingAs,    setViewingAs]    = useState<string | null>(null);
  const [togglingStatus, setTogglingStatus] = useState<string | null>(null);
  const [overridingTier, setOverridingTier] = useState<string | null>(null);
  const [inviteOpen,     setInviteOpen]     = useState(false);

  // -- Actions --

  const handleViewAs = useCallback(async (affiliateId: string, affiliateName: string) => {
    setViewingAs(affiliateId);
    try {
      const res = await fetch("/api/admin/view-as", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ affiliate_id: affiliateId, affiliate_name: affiliateName }),
      });
      if (!res.ok) throw new Error("Failed");
      router.push("/dashboard");
    } catch {
      setViewingAs(null);
      alert("Could not enter view-as mode. Please try again.");
    }
  }, [router]);

  const handleToggleStatus = useCallback(async (affiliateId: string, currentStatus: AffiliateStatus) => {
    const newStatus = currentStatus === "active" ? "suspended" : "active";
    const action = newStatus === "suspended" ? "suspend" : "reactivate";
    if (!confirm(`Are you sure you want to ${action} this affiliate?`)) return;

    setTogglingStatus(affiliateId);
    try {
      const res = await fetch("/api/admin/update-affiliate-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ affiliate_id: affiliateId, status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed");
      router.refresh();
    } catch {
      alert("Failed to update affiliate status. Please try again.");
    } finally {
      setTogglingStatus(null);
    }
  }, [router]);

  const handleOverrideTier = useCallback(async (affiliateId: string, currentTier: AffiliateTier) => {
    const newTier: AffiliateTier = currentTier === "gold" ? "platinum" : "gold";
    if (!confirm(`Override tier to ${newTier}?`)) return;

    setOverridingTier(affiliateId);
    try {
      const res = await fetch("/api/admin/override-tier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ affiliate_id: affiliateId, tier: newTier }),
      });
      if (!res.ok) throw new Error("Failed");
      router.refresh();
    } catch {
      alert("Failed to override tier. Please try again.");
    } finally {
      setOverridingTier(null);
    }
  }, [router]);

  // -- Sort / Filter --

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  const filtered = useMemo(() => {
    let list = affiliates;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a) =>
        a.agent_name.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        (a.business_name ?? "").toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") list = list.filter((a) => a.status === statusFilter);
    if (tierFilter !== "all")   list = list.filter((a) => a.tier === tierFilter);
    if (bankFilter !== "all")   list = list.filter((a) => bankFilter === "yes" ? a.hasBankAccount : !a.hasBankAccount);
    return list;
  }, [affiliates, search, statusFilter, tierFilter, bankFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let aVal: number, bVal: number;
      if (sortKey === "users")    { aVal = a.referredUserCount; bVal = b.referredUserCount; }
      else if (sortKey === "volume")   { aVal = a.volume; bVal = b.volume; }
      else if (sortKey === "earnings") { aVal = a.totalEarnings; bVal = b.totalEarnings; }
      else { aVal = new Date(a.created_at).getTime(); bVal = new Date(b.created_at).getTime(); }
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
  }, [filtered, sortKey, sortDir]);

  function SortBtn({ col, label }: { col: SortKey; label: string }) {
    const active = sortKey === col;
    return (
      <button
        onClick={() => toggleSort(col)}
        className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.1em] transition-colors ${
          active ? "text-accent" : "text-brand-400 hover:text-brand-600"
        }`}
      >
        {label}
        <span className="text-[10px]">{active ? (sortDir === "desc" ? "\u2193" : "\u2191") : ""}</span>
      </button>
    );
  }

  return (
    <>
      <div className="card overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-surface-200/60 flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Affiliate Roster</h3>
            <p className="text-xs text-brand-400 mt-0.5">
              {search || statusFilter !== "all" || tierFilter !== "all" || bankFilter !== "all"
                ? `${sorted.length} of ${affiliates.length}`
                : affiliates.length} affiliates
            </p>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[140px] max-w-xs">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-400 pointer-events-none" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                type="text"
                placeholder="Search affiliates..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-brand-600/30 focus:border-brand-400"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AffiliateStatus | "all")}
              className="text-xs rounded-lg border border-gray-200 bg-white text-gray-900 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-600/30"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="suspended">Suspended</option>
            </select>
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value as AffiliateTier | "all")}
              className="text-xs rounded-lg border border-gray-200 bg-white text-gray-900 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-600/30"
            >
              <option value="all">All tiers</option>
              <option value="gold">Gold</option>
              <option value="platinum">Platinum</option>
            </select>
            <select
              value={bankFilter}
              onChange={(e) => setBankFilter(e.target.value as "all" | "yes" | "no")}
              className="text-xs rounded-lg border border-gray-200 bg-white text-gray-900 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-600/30"
            >
              <option value="all">Bank: All</option>
              <option value="yes">Bank: On file</option>
              <option value="no">Bank: Missing</option>
            </select>
            <button
              onClick={() => setInviteOpen(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-accent hover:bg-accent/90
                         rounded-lg px-3 py-2 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Invite Affiliate
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-surface-200/60 bg-surface-50/60">
                <th className="th">Affiliate</th>
                <th className="th hidden sm:table-cell">Status</th>
                <th className="th hidden md:table-cell">Tier</th>
                <th className="th"><SortBtn col="users" label="Users" /></th>
                <th className="th hidden lg:table-cell"><SortBtn col="volume" label="Volume" /></th>
                <th className="th hidden lg:table-cell"><SortBtn col="earnings" label="Earnings" /></th>
                <th className="th hidden md:table-cell"><SortBtn col="joined" label="Joined" /></th>
                <th className="th hidden sm:table-cell">Bank</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-200/60">
              {sorted.map((aff) => (
                <tr key={aff.id} className="hover:bg-surface-100/40 transition-colors">
                  <td className="td">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-brand-600 border border-brand-700 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-bold text-white">
                          {aff.agent_name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{aff.agent_name}</p>
                        {aff.business_name && (
                          <p className="text-xs text-brand-400 truncate">{aff.business_name}</p>
                        )}
                        <p className="text-xs text-brand-400 truncate mt-0.5">{aff.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="td hidden sm:table-cell">
                    <span className={`badge ${
                      aff.status === "active"    ? "badge-accent" :
                      aff.status === "suspended" ? "badge-red"    : "badge-amber"
                    }`}>
                      {aff.status}
                    </span>
                  </td>
                  <td className="td hidden md:table-cell">
                    <div className="flex items-center gap-1.5">
                      <TierBadge tier={aff.tier} />
                      {aff.tier_override && (
                        <span className="text-[9px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 py-0.5 font-semibold">
                          OVERRIDE
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="td">
                    <span className="text-sm font-bold text-gray-900 tabular-nums">{fmt.count(aff.referredUserCount)}</span>
                  </td>
                  <td className="td hidden lg:table-cell">
                    <span className="text-sm font-medium text-gray-900 tabular-nums">{fmt.currencyCompact(aff.volume)}</span>
                  </td>
                  <td className="td hidden lg:table-cell">
                    <span className="text-sm font-medium text-gray-900 tabular-nums">{fmt.currency(aff.totalEarnings)}</span>
                  </td>
                  <td className="td text-xs text-brand-400 hidden md:table-cell">
                    {fmt.date(aff.created_at)}
                  </td>
                  <td className="td hidden sm:table-cell">
                    {aff.hasBankAccount ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                        On file
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        Missing
                      </span>
                    )}
                  </td>
                  <td className="td">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* View As */}
                      <button
                        onClick={() => handleViewAs(aff.id, aff.agent_name)}
                        disabled={viewingAs === aff.id}
                        className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700
                                   border border-brand-200 hover:border-brand-400 rounded-lg px-2.5 py-1.5
                                   transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-white"
                      >
                        {viewingAs === aff.id ? (
                          <Spinner />
                        ) : (
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        )}
                        View
                      </button>

                      {/* Override Tier */}
                      <button
                        onClick={() => handleOverrideTier(aff.id, aff.tier)}
                        disabled={overridingTier === aff.id}
                        className="flex items-center gap-1 text-xs font-medium text-amber-600 hover:text-amber-700
                                   border border-amber-200 hover:border-amber-400 rounded-lg px-2.5 py-1.5
                                   transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-white"
                      >
                        {overridingTier === aff.id ? <Spinner /> : (
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        )}
                        Tier
                      </button>

                      {/* Activate / Suspend */}
                      <button
                        onClick={() => handleToggleStatus(aff.id, aff.status)}
                        disabled={togglingStatus === aff.id}
                        className={`flex items-center gap-1 text-xs font-medium rounded-lg px-2.5 py-1.5 transition-all
                                   disabled:opacity-50 disabled:cursor-not-allowed border ${
                          aff.status === "active"
                            ? "text-red-600 border-red-200 hover:border-red-400 hover:bg-red-50 bg-white"
                            : "text-accent border-accent/30 hover:border-accent hover:bg-accent/5 bg-white"
                        }`}
                      >
                        {togglingStatus === aff.id ? <Spinner /> : aff.status === "active" ? (
                          <>
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                            Suspend
                          </>
                        ) : (
                          <>
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Activate
                          </>
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-3 border-t border-surface-200/60 bg-surface-50/60">
          <p className="text-xs text-brand-400">
            {search || statusFilter !== "all" || tierFilter !== "all" || bankFilter !== "all"
              ? `${sorted.length} of ${affiliates.length}`
              : affiliates.length} affiliates total
          </p>
        </div>
      </div>

      {inviteOpen && (
        <InviteAffiliateModal
          onClose={() => setInviteOpen(false)}
          onSuccess={() => {
            setInviteOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
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
