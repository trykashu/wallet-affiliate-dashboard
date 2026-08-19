import type { AffiliateTier } from "@/types/database";

interface Props {
  tier: AffiliateTier;
  size?: "sm" | "md";
}

/**
 * Dark-theme tier badge for the admin panel. Forked from the shared
 * ui/TierBadge (whose platinum gradient reads as a light chip on dark) so the
 * affiliate-facing badge stays untouched.
 */
const TIER_CONFIG: Record<AffiliateTier, { label: string; color: string; bg: string; border: string; dot: string }> = {
  gold:     { label: "Gold",     color: "#F4C152", bg: "rgba(244,193,82,0.10)", border: "rgba(244,193,82,0.26)", dot: "#F4C152" },
  platinum: { label: "Platinum", color: "var(--ad-text-1)", bg: "var(--ad-surface-2)", border: "var(--ad-border-strong)", dot: "#9CA2AE" },
  custom:   { label: "Custom",   color: "var(--ad-accent-strong)", bg: "var(--ad-accent-soft)", border: "var(--ad-accent-border)", dot: "var(--ad-accent)" },
  master:   { label: "Master",   color: "#7DD3FC", bg: "rgba(125,211,252,0.10)", border: "rgba(125,211,252,0.26)", dot: "#7DD3FC" },
};

export default function AdminTierBadge({ tier, size = "sm" }: Props) {
  const c = TIER_CONFIG[tier];
  const sizeClass = size === "md" ? "text-xs px-2.5 py-1 gap-1.5" : "text-[10px] px-2 py-0.5 gap-1";
  return (
    <span
      className={`inline-flex items-center rounded-md border font-medium ${sizeClass}`}
      style={{ color: c.color, backgroundColor: c.bg, borderColor: c.border }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.dot }} />
      {c.label}
    </span>
  );
}
