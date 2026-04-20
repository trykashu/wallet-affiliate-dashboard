"use client";

import { useMemo } from "react";
import { fmt } from "@/lib/fmt";
import PayoutSummary from "@/components/dashboard/PayoutSummary";
import PayoutHistory from "@/components/dashboard/PayoutHistory";
import BankAccountForm from "@/components/dashboard/BankAccountForm";
import type { Earning, Payout, PayoutAccount } from "@/types/database";

interface MercuryAccountDisplay {
  account_name: string;
  is_verified: boolean;
  last4?: string;
}

interface Props {
  affiliateId:       string;
  affiliateName?:    string;
  earnings:          Earning[];
  payouts:           Payout[];
  account:           PayoutAccount | null;
  mercuryAccount:    MercuryAccountDisplay | null;
  minPayoutAmount?:  number;
}

function getNextPayoutInfo() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  let nextPayoutDate: Date;
  let coveredMonth: Date;

  if (now.getDate() < 15) {
    // Before the 15th: next payout is the 15th of current month, covering previous month
    nextPayoutDate = new Date(year, month, 15);
    coveredMonth = new Date(year, month - 1, 1);
  } else {
    // On/after the 15th: next payout is the 15th of next month, covering current month
    nextPayoutDate = new Date(year, month + 1, 15);
    coveredMonth = new Date(year, month, 1);
  }

  const coveredLabel = coveredMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return {
    nextDate: fmt.date(nextPayoutDate.toISOString()),
    periodCovered: coveredLabel,
  };
}

export default function PayoutsClient({
  affiliateId,
  affiliateName,
  earnings,
  payouts,
  account,
  mercuryAccount,
  minPayoutAmount = 25,
}: Props) {
  const { nextDate, periodCovered } = useMemo(() => getNextPayoutInfo(), []);

  return (
    <>
      {/* Payout Schedule Card */}
      <div className="card p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Payout Schedule</h3>
            <p className="text-xs text-brand-400">Payouts are processed automatically on the 15th of each month.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="stat-card">
            <p className="text-xs text-brand-400 mb-1">Next Payout</p>
            <p className="text-stat font-bold tabular-nums text-gray-900">{nextDate}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs text-brand-400 mb-1">Period Covered</p>
            <p className="text-stat font-bold tabular-nums text-gray-900">{periodCovered}</p>
          </div>
        </div>
      </div>

      {/* Two-column grid: Summary + Bank Account */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PayoutSummary
          earnings={earnings}
          payouts={payouts}
        />
        <BankAccountForm
          existingAccount={mercuryAccount}
        />
      </div>

      <PayoutHistory payouts={payouts} affiliateName={affiliateName} />
    </>
  );
}
