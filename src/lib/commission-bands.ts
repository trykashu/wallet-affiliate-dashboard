/**
 * Marginal (banded) affiliate commission.
 *
 * A partner earns 5% of Kashu's collected fee on referred volume up to
 * $100,000, and 10% on volume beyond it. This is a MARGINAL rate, not a flat
 * one: crossing $100k does not retroactively re-price earlier transactions, and
 * the single transaction that crosses the boundary is split proportionally.
 *
 * Consequences worth knowing:
 *   - For gold/platinum the stored `tier` no longer determines the rate;
 *     cumulative volume does. The tier remains a display label and still
 *     governs master/custom.
 *   - Banding is driven by the same volume that feeds
 *     affiliates.referred_volume_total: Transfer-In, excluding self-referrals.
 *     Volume that earned no commission (e.g. outside the one-month window)
 *     still counts toward the band, because it is still referred volume.
 */
import type { AffiliateTier } from "@/types/database";
import { COMMISSION_RATES, type CustomCommission } from "@/lib/tier";

export const PLATINUM_VOLUME_THRESHOLD = 100_000;

const BAND_RATE_BELOW = COMMISSION_RATES.gold;      // 5%
const BAND_RATE_ABOVE = COMMISSION_RATES.platinum;  // 10%

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface VolumeTxn {
  airtableRecordId: string;
  affiliateId: string;
  amount: number;
  transactionDate: string | null;
  transactionType: string;
  selfReferral: boolean;
}

/**
 * Map of transaction record id -> that affiliate's cumulative qualifying
 * volume BEFORE the transaction. Ordered by transaction date; ties fall back to
 * record id so the result is stable across runs.
 */
export function buildCumulativeVolumeIndex(txns: VolumeTxn[]): Map<string, number> {
  const byAffiliate = new Map<string, VolumeTxn[]>();
  for (const t of txns) {
    if (t.transactionType !== "Transfer In") continue;
    if (t.selfReferral) continue;
    if (!(Number(t.amount) > 0)) continue;
    const list = byAffiliate.get(t.affiliateId) ?? [];
    list.push(t);
    byAffiliate.set(t.affiliateId, list);
  }
  const index = new Map<string, number>();
  for (const list of byAffiliate.values()) {
    list.sort((a, b) => {
      const d = String(a.transactionDate ?? "").localeCompare(String(b.transactionDate ?? ""));
      return d !== 0 ? d : a.airtableRecordId.localeCompare(b.airtableRecordId);
    });
    let cumulative = 0;
    for (const t of list) {
      index.set(t.airtableRecordId, cumulative);
      cumulative += Number(t.amount) || 0;
    }
  }
  return index;
}

/**
 * Commission for one transaction, given the collected fee and the affiliate's
 * cumulative volume before it.
 *
 * `master` and `custom` are negotiated rates and are never banded.
 */
export function calculateBandedEarning(
  collectedFee: number,
  tpv: number,
  cumulativeVolumeBefore: number,
  tier: AffiliateTier,
  customCommission?: CustomCommission,
): number {
  if (tier === "custom") {
    if (!customCommission) return 0;
    const base = customCommission.basis === "tpv" ? tpv : collectedFee;
    return round2(base * customCommission.rate);
  }
  if (tier === "master") return round2(collectedFee * COMMISSION_RATES.master);

  if (!(tpv > 0)) return 0;
  const remainingBelow = Math.max(0, PLATINUM_VOLUME_THRESHOLD - cumulativeVolumeBefore);
  const below = Math.min(tpv, remainingBelow);
  const above = tpv - below;
  const feeBelow = collectedFee * (below / tpv);
  const feeAbove = collectedFee * (above / tpv);
  return round2(feeBelow * BAND_RATE_BELOW + feeAbove * BAND_RATE_ABOVE);
}
