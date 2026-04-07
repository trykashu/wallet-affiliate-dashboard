/**
 * Funnel stage colors for the 5-stage wallet user funnel.
 * Green-based gradient matching the Kashu brand palette.
 */

import type { FunnelStatusSlug } from "@/types/database";

const FUNNEL_COLORS: Record<FunnelStatusSlug, string> = {
  signed_up:        "#BBF7D0", // green-200
  transaction_run:  "#4ADE80", // green-400
  funds_in_wallet:  "#22C55E", // green-500
  ach_initiated:    "#16A34A", // green-600
  funds_in_bank:    "#00DE8F", // Kashu mint
};

/** Light stages need dark text for legibility */
const LABEL_COLOR_OVERRIDES: Partial<Record<FunnelStatusSlug, string>> = {
  signed_up: "#15803D",
};

const FUNNEL_LABELS: Record<FunnelStatusSlug, string> = {
  signed_up:        "Signed Up",
  transaction_run:  "Transaction Run",
  funds_in_wallet:  "Funds in Wallet",
  ach_initiated:    "ACH Initiated",
  funds_in_bank:    "Funds in Bank",
};

/** Get the background color for a funnel stage. */
export function funnelColor(slug: FunnelStatusSlug): string {
  return FUNNEL_COLORS[slug] ?? "#E5E7EB";
}

/** Get the label text color for a funnel stage (dark override for light stages). */
export function funnelLabelColor(slug: FunnelStatusSlug): string {
  return LABEL_COLOR_OVERRIDES[slug] ?? "#ffffff";
}

/** Get the human-readable label for a funnel stage. */
export function funnelLabel(slug: FunnelStatusSlug): string {
  return FUNNEL_LABELS[slug] ?? slug;
}
