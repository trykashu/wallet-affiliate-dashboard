/**
 * Funnel stage colors for the 8-stage wallet user funnel.
 *
 * Pre-signup stages use gray tones; post-signup stages use a green gradient.
 * For whitelabel-branded affiliates, callers may pass `accentHex` to derive
 * a partner-themed gradient from the partner's accent color (computed in JS,
 * NOT via CSS vars — canvas/hex-parsing consumers depend on real `#RRGGBB`).
 */

import type { FunnelStatusSlug } from "@/types/database";

const FUNNEL_COLORS: Record<FunnelStatusSlug, string> = {
  waitlist:          "#E5E7EB", // gray-200
  booked_call:       "#D1D5DB", // gray-300
  sent_onboarding:   "#9CA3AF", // gray-400
  signed_up:         "#BBF7D0", // green-200
  transaction_run:   "#4ADE80", // green-400
  funds_in_wallet:   "#22C55E", // green-500
  ach_initiated:     "#16A34A", // green-600
  funds_in_bank:     "#00DE8F", // Kashu mint
};

const LABEL_COLOR_OVERRIDES: Partial<Record<FunnelStatusSlug, string>> = {
  waitlist:        "#374151",
  booked_call:     "#374151",
  sent_onboarding: "#ffffff",
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

/* ── Brand-aware derivation ──────────────────────────────── */

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function mixWithWhite(rgb: [number, number, number], whitePct: number): string {
  const [r, g, b] = rgb;
  const w = whitePct;
  return rgbToHex(r * (1 - w) + 255 * w, g * (1 - w) + 255 * w, b * (1 - w) + 255 * w);
}

function mixWithBlack(rgb: [number, number, number], blackPct: number): string {
  const [r, g, b] = rgb;
  const k = blackPct;
  return rgbToHex(r * (1 - k), g * (1 - k), b * (1 - k));
}

/**
 * Derive a 5-step gradient from light pastel → bright accent for the
 * post-signup stages, mirroring Kashu's green gradient. Pre-signup stages
 * stay gray regardless of brand (they're semantically "not active yet").
 */
function deriveBrandColors(
  accentHex: string,
): Partial<Record<FunnelStatusSlug, string>> {
  const rgb = parseHex(accentHex);
  return {
    signed_up:       mixWithWhite(rgb, 0.75),  // light pastel
    transaction_run: mixWithWhite(rgb, 0.50),
    funds_in_wallet: mixWithWhite(rgb, 0.25),
    ach_initiated:   mixWithBlack(rgb, 0.10),  // slightly darker than accent
    funds_in_bank:   accentHex,                // pure accent (terminal stage)
  };
}

function deriveLabelOverride(accentHex: string): string {
  // Dark variant of accent — used as text on the light pastel signed_up bg.
  return mixWithBlack(parseHex(accentHex), 0.30);
}

/* ── Public API ──────────────────────────────────────────── */

/** Get the background color for a funnel stage. Pass `accentHex` for brand-themed gradient. */
export function funnelColor(slug: FunnelStatusSlug, accentHex?: string): string {
  if (accentHex) {
    const branded = deriveBrandColors(accentHex);
    if (branded[slug]) return branded[slug] as string;
  }
  return FUNNEL_COLORS[slug] ?? "#E5E7EB";
}

/** Get the label text color for a funnel stage. Pass `accentHex` for brand-themed dark variant on signed_up. */
export function funnelLabelColor(slug: FunnelStatusSlug, accentHex?: string): string {
  if (accentHex && slug === "signed_up") {
    return deriveLabelOverride(accentHex);
  }
  return LABEL_COLOR_OVERRIDES[slug] ?? "#ffffff";
}

/** Get the human-readable label for a funnel stage. */
export function funnelLabel(slug: FunnelStatusSlug): string {
  return FUNNEL_LABELS[slug] ?? slug;
}
