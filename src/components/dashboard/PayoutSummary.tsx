"use client";

import { fmt } from "@/lib/fmt";
import type { Earning, Payout } from "@/types/database";

interface Props {
  earnings: Earning[];
  payouts:  Payout[];
  onRequestPayout: () => void;
}

export default function PayoutSummary({ earnings, payouts, onRequestPayout }: Props) {
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

  const stats = [
    { label: "Available to Withdraw", value: fmt.currency(available),  highlight: true  },
    { label: "Pending Payout",        value: fmt.currency(totalPending), highlight: false },
    { label: "Total Paid Out",        value: fmt.currency(totalPaid),    highlight: false },
  ];

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Payout Summary</h3>
          <p className="text-xs text-brand-400 mt-0.5">Approved earnings less completed payouts</p>
        </div>
        <button
          onClick={onRequestPayout}
          disabled={available <= 0}
          className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Request Payout
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {stats.map(({ label, value, highlight }) => (
          <div key={label} className="stat-card">
            <p className="text-xs text-brand-400 mb-1">{label}</p>
            <p className={`text-stat font-bold tabular-nums ${highlight ? "text-accent" : "text-gray-900"}`}>
              {value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
