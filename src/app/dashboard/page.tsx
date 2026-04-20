import { getAffiliateContext } from "@/lib/affiliate-context";
import { fmt } from "@/lib/fmt";
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
  "waitlist",
  "booked_call",
  "sent_onboarding",
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
    waitlist: 0,
    booked_call: 0,
    sent_onboarding: 0,
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

  // ── 6. Referral link ────────────────────────────────────────
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
  const referralUrl = `https://signup.kashupay.com?referrer=${affiliate.attribution_id}`;

  // ── 7. Greeting + hero stats ─────────────────────────────────
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

      {/* Referral link */}
      <ReferralLinkCard
        url={referralUrl}
        description="Share this link to earn commission on users that you refer who deposit funds into the wallet."
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
