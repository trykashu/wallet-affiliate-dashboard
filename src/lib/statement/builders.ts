import type { AffiliateTier } from "@/types/database";
import { COMMISSION_RATES } from "@/lib/tier";

export function buildStatementNumber(period: string, affiliateId: string): string {
  return `KS-${period}-${affiliateId.slice(0, 6).toUpperCase()}`;
}

export function formatPeriodLabel(period: string): string {
  const parts = period.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  if (!Number.isFinite(y) || !Number.isFinite(m) || m! < 1 || m! > 12) return period;
  return new Date(y!, m! - 1, 1).toLocaleString("en-US", {
    year: "numeric",
    month: "long",
  });
}

export function commissionRatePct(
  tier: AffiliateTier,
  customRate: number | null,
): number {
  if (customRate != null) return Math.round(customRate * 1000) / 10; // 0.075 → 7.5
  return Math.round(COMMISSION_RATES[tier] * 1000) / 10; // gold 5, platinum 10, master 20
}
