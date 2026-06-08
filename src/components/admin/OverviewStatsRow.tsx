"use client";

import { useState } from "react";
import { fmt } from "@/lib/fmt";
import Money from "./Money";
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
  /** Month-over-month % deltas (null = no comparable base / not derivable). */
  affiliatesDelta: number | null;
  usersDelta: number | null;
  volumeDelta: number | null;
  earningsDelta: number | null;
  topAffiliates: StatRow[];
  topByUsers: StatRow[];
  topByVolume: StatRow[];
  topByEarnings: StatRow[];
  /** Additions-by-month series shown in the drill drawers. */
  affiliatesTrend: { label: string; value: number }[];
  usersTrend: { label: string; value: number }[];
}

type CardKind = "count" | "currency";

export default function OverviewStatsRow({
  totalAffiliates, totalAffiliatesSub,
  totalUsers, totalUsersSub,
  totalVolume, totalVolumeSub,
  totalEarnings, totalEarningsSub,
  affiliatesDelta, usersDelta, volumeDelta, earningsDelta,
  topAffiliates, topByUsers, topByVolume, topByEarnings,
  affiliatesTrend, usersTrend,
}: Props) {
  const [open, setOpen] = useState<StatKey | null>(null);

  const cards: {
    key: StatKey;
    label: string;
    value: number;
    kind: CardKind;
    sub: string;
    delta: number | null;
  }[] = [
    { key: "affiliates", label: "Total Affiliates",      value: totalAffiliates, kind: "count",    sub: totalAffiliatesSub, delta: affiliatesDelta },
    { key: "users",      label: "Total Referred Users",  value: totalUsers,      kind: "count",    sub: totalUsersSub,      delta: usersDelta },
    { key: "volume",     label: "Total Referred Volume", value: totalVolume,     kind: "currency", sub: totalVolumeSub,     delta: volumeDelta },
    { key: "earnings",   label: "Total Earnings",        value: totalEarnings,   kind: "currency", sub: totalEarningsSub,   delta: earningsDelta },
  ];

  const drawerConfig = (() => {
    switch (open) {
      case "affiliates":
        return {
          rows: topAffiliates,
          headlineLabel: "Total Affiliates",
          headlineValue: fmt.count(totalAffiliates),
          emptyHint: "No signed affiliates yet.",
          formatValue: () => "",
          listLabel: "Recently added",
          trend: affiliatesTrend,
          trendCaption: "Affiliates added",
        };
      case "users":
        return {
          rows: topByUsers,
          headlineLabel: "Total Referred Users",
          headlineValue: fmt.count(totalUsers),
          emptyHint: "No referred users yet.",
          formatValue: formatCount,
          listLabel: "Top contributors",
          trend: usersTrend,
          trendCaption: "Users added",
        };
      case "volume":
        return {
          rows: topByVolume,
          headlineLabel: "Total Referred Volume",
          headlineValue: fmt.currencyCompact(totalVolume),
          emptyHint: "No volume recorded yet.",
          formatValue: formatCurrency,
          listLabel: "Top contributors",
          trend: undefined as { label: string; value: number }[] | undefined,
          trendCaption: undefined as string | undefined,
        };
      case "earnings":
        return {
          rows: topByEarnings,
          headlineLabel: "Total Earnings",
          headlineValue: fmt.currencyCompact(totalEarnings),
          emptyHint: "No earnings recorded yet.",
          formatValue: formatCurrency,
          listLabel: "Top contributors",
          trend: undefined as { label: string; value: number }[] | undefined,
          trendCaption: undefined as string | undefined,
        };
      default:
        return null;
    }
  })();

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <StatCardButton
            key={c.key}
            label={c.label}
            value={c.value}
            kind={c.kind}
            sub={c.sub}
            delta={c.delta}
            selected={open === c.key}
            onClick={() => setOpen(c.key)}
          />
        ))}
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
          listLabel={drawerConfig.listLabel}
          trend={drawerConfig.trend}
          trendCaption={drawerConfig.trendCaption}
        />
      )}
    </>
  );
}

function DeltaChip({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span className={`ad-badge ${up ? "ad-badge-pos" : "ad-badge-neg"}`}>
      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
        {up ? (
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        )}
      </svg>
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function StatCardButton({
  label, value, kind, sub, delta, selected, onClick,
}: {
  label: string;
  value: number;
  kind: CardKind;
  sub: string;
  delta: number | null;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`ad-card ad-card-interactive text-left p-5 group ${selected ? "ad-row-selected" : ""}`}
    >
      <div className="flex items-center justify-between">
        <p className="ad-label">{label}</p>
        <svg
          className="w-3.5 h-3.5 ad-text-3 opacity-0 group-hover:opacity-100 transition-opacity"
          fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 8.25L21 12m0 0l-3.75 3.75M21 12H3" />
        </svg>
      </div>

      <p className="mt-2.5 text-[26px] sm:text-[30px] font-semibold ad-text-1 leading-none">
        {kind === "currency"
          ? <Money value={value} />
          : <span className="ad-num">{fmt.count(value)}</span>}
      </p>

      <div className="mt-2.5 flex items-center gap-2">
        {delta !== null && <DeltaChip pct={delta} />}
        {delta !== null && <span className="text-[10px] ad-text-3">vs last mo.</span>}
      </div>

      <p className="text-[10px] ad-text-3 mt-2 leading-relaxed">{sub}</p>
    </button>
  );
}
