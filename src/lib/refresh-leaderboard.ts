/**
 * Shared leaderboard refresh logic.
 * Used by both admin endpoint and cron job.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { TIER_THRESHOLDS } from "@/lib/tier";
import type { AffiliateTier } from "@/types/database";

function currentPeriod(): string {
  const now = new Date();
  const year  = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `monthly_${year}_${month}`;
}

function computeTier(volume: number, tierOverride: boolean): AffiliateTier {
  if (tierOverride || volume >= TIER_THRESHOLDS.platinum) return "platinum";
  return "gold";
}

export interface RefreshResult {
  period: string;
  refreshed: number;
  upgrades: number;
  error?: string;
}

export async function refreshLeaderboard(): Promise<RefreshResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  // Fetch all active affiliates
  const { data: affiliates, error: affiliatesError } = await db
    .from("affiliates")
    .select("id, tier, tier_override, agent_name, referred_volume_total, created_at")
    .eq("status", "active");

  if (affiliatesError || !affiliates) {
    return { period: "", refreshed: 0, upgrades: 0, error: "Failed to fetch affiliates" };
  }

  const affiliateIds: string[] = affiliates.map((a: { id: string }) => a.id);
  if (affiliateIds.length === 0) {
    return { period: currentPeriod(), refreshed: 0, upgrades: 0 };
  }

  // Aggregate referred users per affiliate
  const { data: userAgg } = await db
    .from("referred_users")
    .select("affiliate_id, status_slug")
    .in("affiliate_id", affiliateIds);

  const usersByAffiliate: Record<string, { total: number; completed: number }> = {};
  for (const u of userAgg ?? []) {
    if (!usersByAffiliate[u.affiliate_id]) {
      usersByAffiliate[u.affiliate_id] = { total: 0, completed: 0 };
    }
    usersByAffiliate[u.affiliate_id].total += 1;
    if (u.status_slug === "funds_in_bank") {
      usersByAffiliate[u.affiliate_id].completed += 1;
    }
  }

  // Aggregate earnings per affiliate
  const { data: earningsAgg } = await db
    .from("earnings")
    .select("affiliate_id, amount")
    .in("affiliate_id", affiliateIds)
    .in("status", ["approved", "paid"]);

  const earningsByAffiliate: Record<string, number> = {};
  for (const e of earningsAgg ?? []) {
    earningsByAffiliate[e.affiliate_id] = (earningsByAffiliate[e.affiliate_id] ?? 0) + Number(e.amount);
  }

  // Build volume + created_at maps
  const volumeMap: Record<string, number> = {};
  const createdAtMap: Record<string, string> = {};
  for (const a of affiliates) {
    volumeMap[a.id] = Number(a.referred_volume_total ?? 0);
    createdAtMap[a.id] = a.created_at;
  }

  // Sort: volume DESC -> earnings DESC -> created_at ASC
  const ranked = affiliateIds
    .map((id) => ({
      id,
      total:    usersByAffiliate[id]?.total    ?? 0,
      completed: usersByAffiliate[id]?.completed ?? 0,
      volume:   volumeMap[id] ?? 0,
      earnings: earningsByAffiliate[id] ?? 0,
      createdAt: createdAtMap[id] ?? "",
    }))
    .sort((a, b) => {
      if (b.volume !== a.volume) return b.volume - a.volume;
      if (b.earnings !== a.earnings) return b.earnings - a.earnings;
      return a.createdAt.localeCompare(b.createdAt);
    });

  const totalAffiliates = ranked.length;
  const period = currentPeriod();

  // Upsert leaderboard snapshots
  const snapshots = ranked.map((a, i) => {
    const rank = i + 1;
    const conversionRate = a.total > 0 ? (a.completed / a.total) * 100 : 0;
    const percentile = totalAffiliates > 1
      ? ((rank - 1) / (totalAffiliates - 1)) * 100
      : 100;
    return {
      period,
      affiliate_id:       a.id,
      rank,
      referred_user_count: a.total,
      referred_volume:     a.volume,
      total_earnings:      a.earnings,
      conversion_rate:     Math.round(conversionRate * 100) / 100,
      percentile:          Math.round(percentile * 100) / 100,
    };
  });

  const { error: upsertError } = await db
    .from("leaderboard_snapshots")
    .upsert(snapshots, { onConflict: "period,affiliate_id" });

  if (upsertError) {
    return { period, refreshed: 0, upgrades: 0, error: "Upsert failed" };
  }

  // Update tiers + send upgrade notifications
  const notifications: object[] = [];
  for (const snap of snapshots) {
    const affiliate = affiliates.find((a: { id: string }) => a.id === snap.affiliate_id);
    if (!affiliate) continue;

    const newTier = computeTier(snap.referred_volume, affiliate.tier_override);
    const prevTier: AffiliateTier = affiliate.tier ?? "gold";

    if (prevTier !== newTier) {
      await db.from("affiliates").update({ tier: newTier }).eq("id", snap.affiliate_id);

      const TIER_ORDER: Record<string, number> = { gold: 1, platinum: 2 };
      if ((TIER_ORDER[newTier] ?? 1) > (TIER_ORDER[prevTier] ?? 1)) {
        notifications.push({
          affiliate_id: snap.affiliate_id,
          type:         "tier_upgrade",
          title:        `You've reached ${newTier.charAt(0).toUpperCase() + newTier.slice(1)} tier!`,
          body:         `Congrats! Your volume has earned you a tier upgrade from ${prevTier} to ${newTier}.`,
          metadata:     { from_tier: prevTier, to_tier: newTier, period },
        });
      }
    }
  }

  if (notifications.length > 0) {
    await db.from("notifications").insert(notifications);
  }

  return { period, refreshed: snapshots.length, upgrades: notifications.length };
}
