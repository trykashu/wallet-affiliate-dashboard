import { getAffiliateContext } from "@/lib/affiliate-context";
import type { ReferredUser, FunnelEvent, LeaderboardSnapshot } from "@/types/database";
import ConversionFunnel from "@/components/dashboard/ConversionFunnel";
import DropOffAnalysis from "@/components/dashboard/DropOffAnalysis";
import LeaderboardCard from "@/components/dashboard/LeaderboardCard";
import LeaderboardTable from "@/components/dashboard/LeaderboardTable";

export const dynamic = "force-dynamic";

function currentPeriod(): string {
  const now = new Date();
  const year  = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `monthly_${year}_${month}`;
}

function previousPeriod(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year  = prev.getFullYear();
  const month = String(prev.getMonth() + 1).padStart(2, "0");
  return `monthly_${year}_${month}`;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const ctx = await getAffiliateContext();
  if (!ctx) return null;
  const { db, affiliate, affiliateId } = ctx;

  // Resolve period from search params
  const params = await searchParams;
  const period = params.period ?? currentPeriod();
  const prevPeriod = previousPeriod();

  // ── 1. Fetch referred users ─────────────────────────────────
  const { data: usersRaw } = await db
    .from("referred_users")
    .select("*")
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false });
  const users: ReferredUser[] = (usersRaw ?? []) as ReferredUser[];

  // ── 2. Fetch funnel events ──────────────────────────────────
  const userIds = users.map((u) => u.id);
  let events: FunnelEvent[] = [];
  if (userIds.length > 0) {
    const { data: eventsRaw } = await db
      .from("funnel_events")
      .select("id, referred_user_id, from_status, to_status, created_at")
      .in("referred_user_id", userIds)
      .order("created_at", { ascending: true });
    events = (eventsRaw ?? []) as FunnelEvent[];
  }

  // ── 3. Compute stage durations from funnel_events ───────────
  // Average time users spend at each stage before transitioning
  const stageDurations = computeStageDurations(events);

  // ── 4. Fetch leaderboard data ───────────────────────────────
  // Current period snapshots (top 20 + current affiliate)
  const { data: snapshotsRaw } = await db
    .from("leaderboard_snapshots")
    .select("*")
    .eq("period", period)
    .order("rank", { ascending: true })
    .limit(20);
  const allSnapshots: LeaderboardSnapshot[] = (snapshotsRaw ?? []) as LeaderboardSnapshot[];

  // Ensure current affiliate is in the list
  const currentInList = allSnapshots.some((s) => s.affiliate_id === affiliateId);
  let mySnapshot: LeaderboardSnapshot | null = allSnapshots.find((s) => s.affiliate_id === affiliateId) ?? null;

  if (!currentInList) {
    const { data: mySnapshotRaw } = await db
      .from("leaderboard_snapshots")
      .select("*")
      .eq("period", period)
      .eq("affiliate_id", affiliateId)
      .single();
    if (mySnapshotRaw) {
      mySnapshot = mySnapshotRaw as LeaderboardSnapshot;
      allSnapshots.push(mySnapshot);
      allSnapshots.sort((a, b) => a.rank - b.rank);
    }
  }

  // Previous period snapshots for rank changes
  const { data: prevSnapshotsRaw } = await db
    .from("leaderboard_snapshots")
    .select("*")
    .eq("period", prevPeriod);
  const prevSnapshots: LeaderboardSnapshot[] = (prevSnapshotsRaw ?? []) as LeaderboardSnapshot[];

  const prevRank = prevSnapshots.find((s) => s.affiliate_id === affiliateId)?.rank ?? null;

  // Total affiliate count for leaderboard
  const { count: totalAffiliates } = await db
    .from("affiliates")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");

  // Available periods
  const { data: periodRows } = await db
    .from("leaderboard_snapshots")
    .select("period")
    .order("period", { ascending: false });
  const periodStrings = (periodRows ?? []).map((r: { period: string }) => r.period) as string[];
  const periods: string[] = [...new Set(periodStrings)];

  return (
    <>
      <div className="animate-reveal-up">
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-brand-400 mt-1">
          Funnel performance, drop-off analysis, and leaderboard rankings.
        </p>
      </div>

      {/* Conversion Funnel */}
      <ConversionFunnel users={users} events={events} stageDurations={stageDurations} />

      {/* Drop-Off Analysis */}
      <DropOffAnalysis users={users} events={events} />

      {/* Leaderboard section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-1">
          <LeaderboardCard
            snapshot={mySnapshot}
            tier={affiliate.tier}
            referredVolume={affiliate.referred_volume_total}
            totalAffiliates={totalAffiliates ?? 0}
            prevRank={prevRank}
          />
        </div>
        <div className="lg:col-span-2">
          <LeaderboardTable
            snapshots={allSnapshots}
            previousSnapshots={prevSnapshots}
            currentAffiliateId={affiliateId}
            totalCount={totalAffiliates ?? 0}
            periods={periods}
            currentPeriod={period}
          />
        </div>
      </div>
    </>
  );
}

/**
 * Compute average time users spend at each stage before transitioning.
 * Returns array of { status_slug, avg_hours }.
 */
function computeStageDurations(events: FunnelEvent[]): { status_slug: string; avg_hours: number }[] {
  // Group events by referred_user_id and compute time between transitions
  const eventsByUser: Record<string, FunnelEvent[]> = {};
  for (const e of events) {
    if (!eventsByUser[e.referred_user_id]) eventsByUser[e.referred_user_id] = [];
    eventsByUser[e.referred_user_id].push(e);
  }

  const durationSums: Record<string, { total: number; count: number }> = {};

  for (const userEvents of Object.values(eventsByUser)) {
    // Events are already sorted by created_at
    for (let i = 1; i < userEvents.length; i++) {
      const prev = userEvents[i - 1];
      const curr = userEvents[i];
      if (prev.to_status) {
        const hours = (new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime()) / (1000 * 60 * 60);
        if (hours >= 0 && hours < 8760) { // cap at 1 year
          if (!durationSums[prev.to_status]) durationSums[prev.to_status] = { total: 0, count: 0 };
          durationSums[prev.to_status].total += hours;
          durationSums[prev.to_status].count++;
        }
      }
    }
  }

  return Object.entries(durationSums).map(([slug, { total, count }]) => ({
    status_slug: slug,
    avg_hours: count > 0 ? total / count : 0,
  }));
}
