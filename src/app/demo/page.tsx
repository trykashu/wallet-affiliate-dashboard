import type { FunnelStatusSlug } from "@/types/database";
import {
  DEMO_AFFILIATE,
  DEMO_REFERRED_USERS,
  DEMO_RECENT_EVENTS,
  DEMO_FUNNEL_STATUSES,
  DEMO_FUNNEL_EVENTS,
  DEMO_STAGE_DURATIONS,
} from "@/lib/demo-data";
import StatsRow from "@/components/dashboard/StatsRow";
import ReferralLinkCard from "@/components/dashboard/ReferralLinkCard";
import RecentActivity from "@/components/dashboard/RecentActivity";
import HolographicFunnel from "@/components/dashboard/HolographicFunnel";

export const dynamic = "force-dynamic";

export default function DemoPage() {
  const users = DEMO_REFERRED_USERS;

  const referralUrl = `https://signup.kashupay.com?referrer=${DEMO_AFFILIATE.attribution_id}`;

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = DEMO_AFFILIATE.agent_name.split(" ")[0];

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
      {/* Hero Greeting */}
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
                Demo Mode
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white leading-tight tracking-tight">
              {greeting}, {firstName}
            </h2>
            <p className="text-white/40 text-sm mt-2 max-w-md">
              Here&apos;s how your referrals are performing today.
            </p>
          </div>
          {/* Quick stats -- glass cards */}
          <div className="hidden md:flex items-center gap-4 flex-shrink-0">
            <div className="text-center bg-white/[0.06] backdrop-blur-sm border border-white/[0.08] rounded-2xl px-6 py-3.5">
              <p className="text-display-sm text-white tabular-nums">{users.length}</p>
              <p className="text-white/35 text-[11px] font-medium mt-1 tracking-wide uppercase">Total Users</p>
            </div>
            <div className="text-center bg-white/[0.06] backdrop-blur-sm border border-white/[0.08] rounded-2xl px-6 py-3.5">
              <p className="text-display-sm text-accent tabular-nums">{transactedCount}</p>
              <p className="text-white/35 text-[11px] font-medium mt-1 tracking-wide uppercase">Transacted</p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <StatsRow users={users} />

      {/* Holographic Funnel */}
      <HolographicFunnel
        users={users}
        statuses={DEMO_FUNNEL_STATUSES}
        stageDurations={DEMO_STAGE_DURATIONS}
        events={DEMO_FUNNEL_EVENTS}
      />

      {/* Referral link + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ReferralLinkCard
          url={referralUrl}
          description="Share this link to earn commission on users that you refer who deposit funds into the wallet."
        />
        <RecentActivity events={DEMO_RECENT_EVENTS} />
      </div>
    </>
  );
}
