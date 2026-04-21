import type { AffiliateTier } from "@/types/database";

interface Props {
  tier: AffiliateTier;
  size?: "sm" | "md";
}

const TIER_CONFIG: Record<AffiliateTier, { label: string; classes: string; dot: string }> = {
  gold: {
    label:   "Gold",
    classes: "bg-amber-400/10 text-amber-400 border-amber-400/20",
    dot:     "bg-amber-400",
  },
  platinum: {
    label:   "Platinum",
    classes: "bg-gradient-to-r from-slate-100 to-slate-200 text-slate-700 border-slate-300",
    dot:     "bg-gradient-to-br from-slate-400 to-slate-600",
  },
};

export default function TierBadge({ tier, size = "sm" }: Props) {
  const config = TIER_CONFIG[tier];
  const sizeClass = size === "md"
    ? "text-xs px-2.5 py-1 gap-1.5"
    : "text-[10px] px-2 py-0.5 gap-1";

  return (
    <span
      className={`inline-flex items-center rounded-md border font-medium ${config.classes} ${sizeClass}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${config.dot}`} />
      {config.label}
    </span>
  );
}
