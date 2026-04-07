import { getAffiliateContext } from "@/lib/affiliate-context";
import type { FunnelStatusSlug, ReferredUser } from "@/types/database";
import StatsRow from "@/components/dashboard/StatsRow";
import ReferralLinkCard from "@/components/dashboard/ReferralLinkCard";
import RecentActivity from "@/components/dashboard/RecentActivity";
import type { RecentEvent } from "@/components/dashboard/RecentActivity";
import EarningsCard from "@/components/dashboard/EarningsCard";
import FunnelChart from "@/components/dashboard/FunnelChart";

export const dynamic = "force-dynamic";

/** Slugs ordered by funnel position (early to late). */
const FUNNEL_ORDER: FunnelStatusSlug[] = [
  "signed_up",
  "transaction_run",
  "funds_in_wallet",
  "ach_initiated",
  "funds_in_bank",
];

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

  // ── 2. Compute stage counts (cumulative: each user at their current stage) ──
  const stageCounts: Record<FunnelStatusSlug, number> = {
    signed_up: 0,
    transaction_run: 0,
    funds_in_wallet: 0,
    ach_initiated: 0,
    funds_in_bank: 0,
  };
  for (const u of users) {
    if (stageCounts[u.status_slug] !== undefined) {
      stageCounts[u.status_slug]++;
    }
  }

  // ── 3. Fetch recent funnel events (last 10) ─────────────────
  const { data: eventsRaw } = await db
    .from("funnel_events")
    .select("id, from_status, to_status, created_at, referred_users(full_name)")
    .eq("referred_users.affiliate_id", affiliateId)
    .order("created_at", { ascending: false })
    .limit(10);

  // The join may return events where the referred_user doesn't belong to this
  // affiliate (Supabase foreign-key filter returns null for the join).
  // Also, for RLS-scoped queries this is handled automatically.
  const events: RecentEvent[] = ((eventsRaw ?? []) as RecentEvent[]).filter(
    (e) => e.referred_users !== null
  );

  // ── 4. Fetch earnings summary ───────────────────────────────
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [
    { data: earningsAll },
    { data: earningsMonth },
    { data: earningsPending },
    { data: earningsPaid },
  ] = await Promise.all([
    db
      .from("earnings")
      .select("amount")
      .eq("affiliate_id", affiliateId),
    db
      .from("earnings")
      .select("amount")
      .eq("affiliate_id", affiliateId)
      .gte("created_at", monthStart),
    db
      .from("earnings")
      .select("amount")
      .eq("affiliate_id", affiliateId)
      .eq("status", "pending"),
    db
      .from("earnings")
      .select("amount")
      .eq("affiliate_id", affiliateId)
      .eq("status", "paid"),
  ]);

  const sum = (rows: { amount: number }[] | null) =>
    (rows ?? []).reduce((acc, r) => acc + (r.amount ?? 0), 0);

  const earningsSummary = {
    total:     sum(earningsAll),
    thisMonth: sum(earningsMonth),
    pending:   sum(earningsPending),
    paid:      sum(earningsPaid),
  };

  // ── 5. Referral link ────────────────────────────────────────
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
  const referralUrl = `${appUrl}/r/${affiliate.attribution_id}`;

  // ── 6. Greeting ─────────────────────────────────────────────
  const hour = now.getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = affiliate.agent_name.split(" ")[0];

  return (
    <>
      {/* Greeting */}
      <div className="animate-reveal-up">
        <h1 className="text-2xl font-bold text-gray-900">
          {greeting}, {firstName}
        </h1>
        <p className="text-sm text-brand-400 mt-1">
          Here&apos;s how your referrals are performing.
        </p>
      </div>

      {/* Referral link */}
      <ReferralLinkCard
        url={referralUrl}
        description="Share this link to earn commissions on every transaction your users complete."
      />

      {/* Stats row */}
      <StatsRow users={users} />

      {/* Funnel + Activity + Earnings grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-1">
          <FunnelChart stageCounts={stageCounts} total={users.length} />
        </div>
        <div className="lg:col-span-1">
          <RecentActivity events={events} />
        </div>
        <div className="lg:col-span-1">
          <EarningsCard
            summary={earningsSummary}
            tier={affiliate.tier}
            referredVolume={affiliate.referred_volume_total}
          />
        </div>
      </div>
    </>
  );
}
