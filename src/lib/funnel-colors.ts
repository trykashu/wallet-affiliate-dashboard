/**
 * Funnel stage colors for the 8-stage wallet user funnel.
 * Pre-signup stages use gray tones; post-signup stages use green gradient.
 */

import type { FunnelStatusSlug } from "@/types/database";

const FUNNEL_COLORS: Record<FunnelStatusSlug, string> = {
  waitlist:          "#E5E7EB", // gray-200 — waiting
  booked_call:       "#D1D5DB", // gray-300 — scheduled
  sent_onboarding:   "#9CA3AF", // gray-400 — onboarding sent
  signed_up:         "#BBF7D0", // green-200
  transaction_run:   "#4ADE80", // green-400
  funds_in_wallet:   "#22C55E", // green-500
  ach_initiated:     "#16A34A", // green-600
  funds_in_bank:     "#00DE8F", // Kashu mint
};

/** Light stages need dark text for legibility */
const LABEL_COLOR_OVERRIDES: Partial<Record<FunnelStatusSlug, string>> = {
  waitlist:        "#374151", // gray-700
  booked_call:     "#374151", // gray-700
  sent_onboarding: "#ffffff", // white on gray-400
  signed_up:       "#15803D",
};

const FUNNEL_LABELS: Record<FunnelStatusSlug, string> = {
  waitlist:          "Waitlist",
  booked_call:       "Booked Call",
  sent_onboarding:   "Sent Onboarding",
  signed_up:         "Signed Up",
  transaction_run:   "Transaction Run",
  funds_in_wallet:   "Funds in Wallet",
  ach_initiated:     "ACH Initiated",
  funds_in_bank:     "Funds in Bank",
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
