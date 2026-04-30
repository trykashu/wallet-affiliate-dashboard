import {
  DEMO_AFFILIATE,
  DEMO_EARNINGS,
  DEMO_EARNINGS_SUMMARY,
  DEMO_TRANSACTIONS,
  DEMO_LEADERBOARD,
  DEMO_REFERRED_USERS,
  DEMO_PREV_RANK,
  DEMO_TOTAL_AFFILIATES,
} from "@/lib/demo-data";
import EarningsCard from "@/components/dashboard/EarningsCard";
import EarningsTable from "@/components/dashboard/EarningsTable";
import TransactionLedger from "@/components/dashboard/TransactionLedger";
import LeaderboardCard from "@/components/dashboard/LeaderboardCard";

export const dynamic = "force-dynamic";

export default function DemoEarningsPage() {
  const nameById = new Map(DEMO_REFERRED_USERS.map((u) => [u.id, u.full_name]));

  const earningsWithUser = DEMO_EARNINGS.map((e) => ({
    ...e,
    user_name: nameById.get(e.referred_user_id) ?? "Unknown User",
  }));

  const mySnapshot = DEMO_LEADERBOARD.find((s) => s.affiliate_id === DEMO_AFFILIATE.id) ?? null;

  return (
    <>
      <div className="animate-reveal-up">
        <h1 className="text-2xl font-bold text-gray-900">Earnings</h1>
        <p className="text-sm text-brand-400 mt-1">
          Track your commissions, transactions, and ranking.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <EarningsCard
          summary={DEMO_EARNINGS_SUMMARY}
          tier={DEMO_AFFILIATE.tier}
          referredVolume={DEMO_AFFILIATE.referred_volume_total}
        />
        <LeaderboardCard
          snapshot={mySnapshot}
          tier={DEMO_AFFILIATE.tier}
          referredVolume={DEMO_AFFILIATE.referred_volume_total}
          totalAffiliates={DEMO_TOTAL_AFFILIATES}
          prevRank={DEMO_PREV_RANK}
        />
      </div>

      <TransactionLedger transactions={DEMO_TRANSACTIONS} />

      <EarningsTable earnings={earningsWithUser} />
    </>
  );
}
