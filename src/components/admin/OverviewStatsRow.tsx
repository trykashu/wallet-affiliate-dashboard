"use client";

import { useState } from "react";
import { fmt } from "@/lib/fmt";
import StatDrillDrawer, {
  formatCount,
  formatCurrency,
  type StatKey,
  type StatRow,
} from "./StatDrillDrawer";

interface Props {
  totalAffiliates: number;
  totalAffiliatesSub: string;
  totalUsers: number;
  totalUsersSub: string;
  totalVolume: number;
  totalVolumeSub: string;
  totalEarnings: number;
  totalEarningsSub: string;
  topAffiliates: StatRow[];
  topByUsers: StatRow[];
  topByVolume: StatRow[];
  topByEarnings: StatRow[];
}

export default function OverviewStatsRow({
  totalAffiliates, totalAffiliatesSub,
  totalUsers, totalUsersSub,
  totalVolume, totalVolumeSub,
  totalEarnings, totalEarningsSub,
  topAffiliates, topByUsers, topByVolume, topByEarnings,
}: Props) {
  const [open, setOpen] = useState<StatKey | null>(null);

  const drawerConfig = (() => {
    switch (open) {
      case "affiliates":
        return {
          rows: topAffiliates,
          headlineLabel: "Total Affiliates",
          headlineValue: fmt.count(totalAffiliates),
          emptyHint: "No signed affiliates yet.",
          formatValue: () => "", // affiliates stat row has no numeric value; use sub only
        };
      case "users":
        return {
          rows: topByUsers,
          headlineLabel: "Total Referred Users",
          headlineValue: fmt.count(totalUsers),
          emptyHint: "No referred users yet.",
          formatValue: formatCount,
        };
      case "volume":
        return {
          rows: topByVolume,
          headlineLabel: "Total Referred Volume",
          headlineValue: fmt.currencyCompact(totalVolume),
          emptyHint: "No volume recorded yet.",
          formatValue: formatCurrency,
        };
      case "earnings":
        return {
          rows: topByEarnings,
          headlineLabel: "Total Earnings",
          headlineValue: fmt.currencyCompact(totalEarnings),
          emptyHint: "No earnings recorded yet.",
          formatValue: formatCurrency,
        };
      default:
        return null;
    }
  })();

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCardButton
          label="Total Affiliates"
          value={fmt.count(totalAffiliates)}
          sub={totalAffiliatesSub}
          accentColor="brand"
          onClick={() => setOpen("affiliates")}
        />
        <StatCardButton
          label="Total Referred Users"
          value={fmt.count(totalUsers)}
          sub={totalUsersSub}
          accentColor="accent"
          onClick={() => setOpen("users")}
        />
        <StatCardButton
          label="Total Referred Volume"
          value={fmt.currencyCompact(totalVolume)}
          sub={totalVolumeSub}
          accentColor="accent"
          onClick={() => setOpen("volume")}
        />
        <StatCardButton
          label="Total Earnings"
          value={fmt.currencyCompact(totalEarnings)}
          sub={totalEarningsSub}
          accentColor="brand"
          onClick={() => setOpen("earnings")}
        />
      </div>

      {drawerConfig && (
        <StatDrillDrawer
          open={open}
          onClose={() => setOpen(null)}
          rows={drawerConfig.rows}
          headlineLabel={drawerConfig.headlineLabel}
          headlineValue={drawerConfig.headlineValue}
          emptyHint={drawerConfig.emptyHint}
          formatValue={drawerConfig.formatValue}
        />
      )}
    </>
  );
}

function StatCardButton({
  label, value, sub, accentColor, onClick,
}: {
  label: string;
  value: string;
  sub: string;
  accentColor: "brand" | "accent";
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="stat-card accent-top text-left hover:shadow-card-md hover:-translate-y-0.5 transition-all group"
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">{label}</p>
        <svg className="w-3.5 h-3.5 text-brand-400 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 8.25L21 12m0 0l-3.75 3.75M21 12H3" />
        </svg>
      </div>
      <p className={`text-display-sm font-bold tabular-nums mt-1 ${
        accentColor === "accent" ? "text-accent" : "text-gray-900"
      }`}>
        {value}
      </p>
      <p className="text-[10px] text-brand-400 mt-1.5 leading-relaxed">{sub}</p>
    </button>
  );
}
