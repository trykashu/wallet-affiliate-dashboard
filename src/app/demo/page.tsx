import type { FunnelStatusSlug } from "@/types/database";
import {
  DEMO_AFFILIATE,
  DEMO_REFERRED_USERS,
  DEMO_RECENT_EVENTS,
  DEMO_EARNINGS_SUMMARY,
} from "@/lib/demo-data";
import StatsRow from "@/components/dashboard/StatsRow";
import ReferralLinkCard from "@/components/dashboard/ReferralLinkCard";
import RecentActivity from "@/components/dashboard/RecentActivity";
import FunnelChart from "@/components/dashboard/FunnelChart";
import EarningsCard from "@/components/dashboard/EarningsCard";

export const dynamic = "force-dynamic";

export default function DemoPage() {
  const users = DEMO_REFERRED_USERS;

  // Compute stage counts from demo users
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

  const referralUrl = `https://wallet.kashupay.com/r/${DEMO_AFFILIATE.attribution_id}`;

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      {/* Greeting */}
      <div className="animate-reveal-up">
        <h1 className="text-2xl font-bold text-gray-900">
          {greeting}, Alex
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
          <RecentActivity events={DEMO_RECENT_EVENTS} />
        </div>
        <div className="lg:col-span-1">
          <EarningsCard
            summary={DEMO_EARNINGS_SUMMARY}
            tier={DEMO_AFFILIATE.tier}
            referredVolume={DEMO_AFFILIATE.referred_volume_total}
          />
        </div>
      </div>
    </>
  );
}
