import {
  DEMO_AFFILIATE,
  DEMO_EARNINGS,
  DEMO_PAYOUTS,
  DEMO_PAYOUT_ACCOUNT,
  DEMO_MERCURY_ACCOUNT_DISPLAY,
  DEMO_MIN_PAYOUT_AMOUNT,
} from "@/lib/demo-data";
import PayoutsClient from "@/components/dashboard/PayoutsClient";

export const dynamic = "force-dynamic";

export default function DemoPayoutsPage() {
  return (
    <>
      <div className="animate-reveal-up">
        <h1 className="text-2xl font-bold text-gray-900">Payouts</h1>
        <p className="text-sm text-brand-400 mt-1">
          Track your earnings and upcoming payouts.
        </p>
      </div>

      <PayoutsClient
        affiliateId={DEMO_AFFILIATE.id}
        affiliateName={DEMO_AFFILIATE.agent_name}
        earnings={DEMO_EARNINGS}
        payouts={DEMO_PAYOUTS}
        account={DEMO_PAYOUT_ACCOUNT}
        mercuryAccount={DEMO_MERCURY_ACCOUNT_DISPLAY}
        minPayoutAmount={DEMO_MIN_PAYOUT_AMOUNT}
        bankDetailsNeeded={false}
      />
    </>
  );
}
