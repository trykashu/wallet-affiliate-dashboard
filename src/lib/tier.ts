/**
 * Wallet Affiliate tier logic — Gold/Platinum.
 *
 * Fee structure:
 *   Kashu charges a flat fee on TPV (default 8.5%, configurable to 7.5%).
 *   Affiliates earn a percentage of Kashu's fee (NOT of TPV).
 *
 * Gold:     5% of Kashu's fee
 * Platinum: 10% of Kashu's fee
 *
 * Example (Gold, $2500 TPV, 8.5% fee):
 *   Kashu fee  = $2500 × 0.085 = $212.50
 *   Affiliate  = $212.50 × 0.05 = $10.63
 */

import type { AffiliateTier } from "@/types/database";

export const TIER_THRESHOLDS = { platinum: 100_000 } as const;

/** Kashu's fee as a percentage of TPV. */
export const KASHU_FEE_RATES = {
  default: 0.085,  // 8.5%
  reduced: 0.075,  // 7.5%
} as const;

export type KashuFeeRate = keyof typeof KASHU_FEE_RATES;

/** Affiliate commission rates — percentage of Kashu's fee. */
export const COMMISSION_RATES: Record<AffiliateTier, number> = {
  gold: 0.05,     // 5% of Kashu's fee
  platinum: 0.10,  // 10% of Kashu's fee
};

/** Determine the tier based on total referred transaction volume. */
export function getTierForVolume(referredVolume: number): AffiliateTier {
  if (referredVolume >= TIER_THRESHOLDS.platinum) return "platinum";
  return "gold";
}

/** Get the commission rate for a given tier. */
export function getCommissionRate(tier: AffiliateTier): number {
  return COMMISSION_RATES[tier];
}

/** Calculate Kashu's fee from a TPV amount. */
export function calculateKashuFee(tpv: number, feeRate: KashuFeeRate = "default"): number {
  return tpv * KASHU_FEE_RATES[feeRate];
}

/**
 * Calculate the affiliate earning from a transaction.
 *
 * @param tpv - Total processed volume (the transaction amount)
 * @param tier - Affiliate tier (gold or platinum)
 * @param feeRate - Kashu fee rate (default 8.5%, reduced 7.5%)
 * @returns The affiliate earning amount (rounded to 2 decimals)
 *
 * Example: calculateEarning(2500, "gold") → 10.63
 *   Kashu fee = 2500 × 0.085 = 212.50
 *   Earning   = 212.50 × 0.05 = 10.625 → 10.63
 */
export function calculateEarning(
  tpv: number,
  tier: AffiliateTier,
  feeRate: KashuFeeRate = "default"
): number {
  const kashuFee = calculateKashuFee(tpv, feeRate);
  return Math.round(kashuFee * getCommissionRate(tier) * 100) / 100;
}
