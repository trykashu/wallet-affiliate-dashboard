"use client";

import { useState } from "react";
import PayoutSummary from "@/components/dashboard/PayoutSummary";
import PayoutHistory from "@/components/dashboard/PayoutHistory";
import BankAccountForm from "@/components/dashboard/BankAccountForm";
import PayoutRequestModal from "@/components/dashboard/PayoutRequestModal";
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

export default function PayoutsClient({
  affiliateId,
  affiliateName,
  earnings,
  payouts,
  account,
  mercuryAccount,
  minPayoutAmount = 25,
}: Props) {
  const [showModal, setShowModal] = useState(false);

  // Compute available balance
  const totalApproved = earnings
    .filter((e) => e.status === "approved")
    .reduce((s, e) => s + e.amount, 0);
  const totalPaid = payouts
    .filter((p) => p.status === "completed")
    .reduce((s, p) => s + p.amount, 0);
  const totalPending = payouts
    .filter((p) => p.status === "requested" || p.status === "processing")
    .reduce((s, p) => s + p.amount, 0);
  const available = Math.max(0, totalApproved - totalPaid - totalPending);

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <PayoutSummary
            earnings={earnings}
            payouts={payouts}
            onRequestPayout={() => setShowModal(true)}
          />
        </div>
        <div className="space-y-4">
          <BankAccountForm
            existingAccount={mercuryAccount}
          />
        </div>
      </div>

      <PayoutHistory payouts={payouts} affiliateName={affiliateName} />

      {showModal && (
        <PayoutRequestModal
          available={available}
          account={account}
          affiliateId={affiliateId}
          minAmount={minPayoutAmount}
          onSuccess={() => window.location.reload()}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
