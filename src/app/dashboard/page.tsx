import { getAffiliateContext } from "@/lib/affiliate-context";
import { fmt } from "@/lib/fmt";
import type { FunnelStatusSlug, ReferredUser, FunnelEvent, FunnelStatus, StageDuration } from "@/types/database";
import StatsRow from "@/components/dashboard/StatsRow";
import ReferralLinkCard from "@/components/dashboard/ReferralLinkCard";
import HolographicFunnel from "@/components/dashboard/HolographicFunnel";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const ctx = await getAffiliateContext();
  if (!ctx) return null;
  const { db, affiliate, affiliateId } = ctx;

  // ── 1. Fetch referred users ──────────────────────────────────
  const { data: usersRaw } = await db
    .from("referred_users")
    .select("*")
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false });
  const users: ReferredUser[] = (usersRaw ?? []) as ReferredUser[];

  // ── 2. Fetch funnel statuses ─────────────────────────────────
  const { data: statusesRaw } = await db
    .from("funnel_statuses")
    .select("*")
    .order("sort_order", { ascending: true });
  const funnelStatuses: FunnelStatus[] = (statusesRaw ?? []) as FunnelStatus[];

  // ── 3. Fetch funnel events for this affiliate's users ───────
  const userIds = users.map((u) => u.id);
  let funnelEvents: FunnelEvent[] = [];
  if (userIds.length > 0) {
    const { data: funnelEventsRaw } = await db
      .from("funnel_events")
      .select("id, referred_user_id, from_status, to_status, created_at")
      .in("referred_user_id", userIds)
      .order("created_at", { ascending: true });
    funnelEvents = (funnelEventsRaw ?? []) as FunnelEvent[];
  }

  // ── 4. Compute stage durations from funnel events ───────────
  const stageDurations = computeStageDurations(funnelEvents);

  // ── 5. Total Transfer In volume ──────────────────────────────
  const { data: volumeRows } = await db
    .from("transactions")
    .select("amount")
    .eq("affiliate_id", affiliateId)
    .eq("transaction_type", "Transfer In");
  const totalVolume = (volumeRows ?? []).reduce(
    (acc: number, r: { amount: number }) => acc + (r.amount ?? 0),
    0
  );

  const now = new Date();
  // ── 7. Referral link ────────────────────────────────────────
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
  const referralUrl = `https://signup.kashupay.com?referrer=${affiliate.attribution_id}`;

  // ── 8. Greeting + hero stats ─────────────────────────────────
  const hour = now.getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = affiliate.agent_name.split(" ")[0];

  // Stages at or past transaction_run
  const TRANSACTED_SLUGS: FunnelStatusSlug[] = [
    "transaction_run",
    "funds_in_wallet",
    "ach_initiated",
    "funds_in_bank",
  ];
  const transactedCount = users.filter((u) =>
    TRANSACTED_SLUGS.includes(u.status_slug)
  ).length;

  return (
    <>
      {/* Referral link — full width at top */}
      <ReferralLinkCard
        url={referralUrl}
        description="Share this link to earn commission on users that you refer who deposit funds into the wallet."
      />

      {/* ── Hero Greeting ─────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-600 to-brand-700 px-5 sm:px-8 py-6 sm:py-8 animate-reveal-up noise-overlay">
        {/* Ambient glow orbs */}
        <div className="absolute -right-20 -top-20 w-80 h-80 bg-accent/20 rounded-full blur-[80px] pointer-events-none animate-breathe" />
        <div className="absolute -left-12 -bottom-12 w-56 h-56 bg-brand-300/20 rounded-full blur-[60px] pointer-events-none animate-breathe" style={{ animationDelay: "-2s" }} />
        {/* Grid texture */}
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none z-[2]"
          style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)", backgroundSize: "24px 24px" }}
        />
        {/* Content */}
        <div className="relative z-[3] flex items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2.5 mb-3">
              <span className="inline-flex items-center gap-1.5 bg-white/[0.08] border border-white/[0.1] backdrop-blur-sm rounded-xl px-3 py-1.5 text-[11px] font-semibold text-white/60 tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0 animate-pulse" />
                Active Affiliate
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white leading-tight tracking-tight">
              {greeting}, {firstName}
            </h2>
            <p className="text-white/40 text-sm mt-2 max-w-md">
              Here&apos;s how your referrals are performing today.
            </p>
          </div>
          {/* Quick stats — glass cards */}
          <div className="hidden md:flex items-center gap-4 flex-shrink-0">
            <div className="text-center bg-white/[0.06] backdrop-blur-sm border border-white/[0.08] rounded-2xl px-6 py-3.5">
              <p className="text-display-sm text-white tabular-nums">{users.length}</p>
              <p className="text-white/35 text-[11px] font-medium mt-1 tracking-wide uppercase">Total Users</p>
            </div>
            <div className="text-center bg-white/[0.06] backdrop-blur-sm border border-white/[0.08] rounded-2xl px-6 py-3.5">
              <p className="text-display-sm text-accent tabular-nums">{transactedCount}</p>
              <p className="text-white/35 text-[11px] font-medium mt-1 tracking-wide uppercase">Transacted</p>
            </div>
            <div className="text-center bg-white/[0.06] backdrop-blur-sm border border-white/[0.08] rounded-2xl px-6 py-3.5">
              <p className="text-display-sm text-white tabular-nums">{fmt.currencyCompact(totalVolume)}</p>
              <p className="text-white/35 text-[11px] font-medium mt-1 tracking-wide uppercase">Volume</p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <StatsRow users={users} />

      {/* Holographic Funnel */}
      <HolographicFunnel
        users={users}
        statuses={funnelStatuses}
        stageDurations={stageDurations}
        events={funnelEvents}
      />
    </>
  );
}

/**
 * Compute average time users spend at each stage before transitioning.
 * Returns array of { status_slug, avg_hours }.
 */
function computeStageDurations(events: FunnelEvent[]): StageDuration[] {
  const eventsByUser: Record<string, FunnelEvent[]> = {};
  for (const e of events) {
    if (!eventsByUser[e.referred_user_id]) eventsByUser[e.referred_user_id] = [];
    eventsByUser[e.referred_user_id].push(e);
  }

  const durationSums: Record<string, { total: number; count: number }> = {};

  for (const userEvents of Object.values(eventsByUser)) {
    for (let i = 1; i < userEvents.length; i++) {
      const prev = userEvents[i - 1];
      const curr = userEvents[i];
      if (prev.to_status) {
        const hours = (new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime()) / (1000 * 60 * 60);
        if (hours >= 0 && hours < 8760) {
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
