/**
 * Wallet Affiliate tier logic — Gold/Platinum.
 *
 * Gold:     default tier, 5% commission on transaction fees
 * Platinum: >= $250K referred volume, 10% commission on transaction fees
 */

import type { AffiliateTier } from "@/types/database";

export const TIER_THRESHOLDS = { platinum: 250_000 } as const;

export const COMMISSION_RATES: Record<AffiliateTier, number> = {
  gold: 0.05,
  platinum: 0.10,
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

/**
 * Calculate the earning from a single transaction fee.
 * earning = transactionFee * commissionRate
 */
export function calculateEarning(transactionFee: number, tier: AffiliateTier): number {
  return transactionFee * getCommissionRate(tier);
}
