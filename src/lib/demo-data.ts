/**
 * Mock data for the /demo dashboard.
 * Represents a top-performing Platinum affiliate "Alex Rivera".
 */

import type {
  Affiliate,
  ReferredUser,
  FunnelStatus,
  FunnelEvent,
  FunnelStatusSlug,
  StageDuration,
  Earning,
  LeaderboardSnapshot,
  Transaction,
  Payout,
  PayoutAccount,
} from "@/types/database";

// ── Affiliate ───────────────────────────────────────────────────────────────

export const DEMO_AFFILIATE: Affiliate = {
  id:                    "demo-affiliate-001",
  user_id:               "demo-user-001",
  agent_name:            "Alex Rivera",
  business_name:         "Rivera Growth Partners",
  email:                 "alex@riveragrowth.com",
  phone:                 "(555) 987-6543",
  tier:                  "platinum",
  tier_override:         false,
  status:                "active",
  referred_volume_total: 320_000,
  attribution_id:        "DEMO-AXR-2026",
  has_password:          true,
  agreement_status:      "signed",
  bank_details_needed:   false,
  last_login_at:         new Date().toISOString(),
  created_at:            "2025-08-01T00:00:00Z",
  updated_at:            new Date().toISOString(),
};

// ── Referred Users ──────────────────────────────────────────────────────────

const USER_NAMES = [
  "Jordan Martinez", "Samira Khan", "Blake Thompson", "Priya Patel",
  "Marcus Lee", "Olivia Chen", "Aiden Brooks", "Fatima Al-Rashid",
  "Luca Moretti", "Maya Williams", "Ethan Nakamura", "Zara Okafor",
  "Dylan Cooper", "Nia Johnson", "Leo Gupta", "Isabella Reyes",
  "Caleb Anderson", "Keisha Brown", "Ryan O'Brien", "Amira Hassan",
  "Tyler Wright", "Sofia Ramirez", "Nathan Davis", "Jasmine Park",
  "Owen Mitchell", "Aaliyah Scott", "Cameron Flores", "Leila Tanaka",
  "Hunter Garcia", "Destiny Robinson",
];

const STATUS_DISTRIBUTION: Record<FunnelStatusSlug, number> = {
  waitlist:          5,
  booked_call:       4,
  sent_onboarding:   3,
  signed_up:         5,
  transaction_run:   4,
  funds_in_wallet:   3,
  ach_initiated:     3,
  funds_in_bank:     3,
};

function makeDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86400000).toISOString();
}

let userIdx = 0;
export const DEMO_REFERRED_USERS: ReferredUser[] = Object.entries(STATUS_DISTRIBUTION).flatMap(
  ([status, count]) =>
    Array.from({ length: count }, (_, i) => {
      const idx = userIdx++;
      const daysAgo = 5 + idx * 3;
      const hasTransaction = ["transaction_run", "funds_in_wallet", "ach_initiated", "funds_in_bank"].includes(status);
      const txAmount = hasTransaction ? 500 + Math.floor(Math.random() * 4500) : null;
      const txFee = txAmount ? Math.round(txAmount * 0.029 * 100) / 100 : null;

      return {
        id:                       `demo-user-${String(idx).padStart(3, "0")}`,
        affiliate_id:             DEMO_AFFILIATE.id,
        full_name:                USER_NAMES[idx] ?? `User #${idx + 1}`,
        email:                    `${(USER_NAMES[idx] ?? "user").toLowerCase().replace(/[^a-z]/g, "")}@example.com`,
        phone:                    null,
        status_slug:              status as FunnelStatusSlug,
        first_transaction_amount: txAmount,
        first_transaction_fee:    txFee,
        first_transaction_at:     hasTransaction ? makeDate(daysAgo - 2) : null,
        wallet_user_id:           hasTransaction ? `wallet-${idx}` : null,
        created_at:               makeDate(daysAgo),
        updated_at:               makeDate(daysAgo - 1),
      } as ReferredUser;
    })
);

// ── Funnel Statuses ─────────────────────────────────────────────────────────

export const DEMO_FUNNEL_STATUSES: FunnelStatus[] = [
  { id: "1", slug: "waitlist",          label: "Waitlist",          color: "#E5E7EB", sort_order: 1 },
  { id: "2", slug: "booked_call",       label: "Booked Call",       color: "#D1D5DB", sort_order: 2 },
  { id: "3", slug: "sent_onboarding",   label: "Sent Onboarding",  color: "#9CA3AF", sort_order: 3 },
  { id: "4", slug: "signed_up",         label: "Signed Up",        color: "#BBF7D0", sort_order: 4 },
  { id: "5", slug: "transaction_run",   label: "Transaction Run",  color: "#4ADE80", sort_order: 5 },
  { id: "6", slug: "funds_in_wallet",   label: "Funds in Wallet",  color: "#22C55E", sort_order: 6 },
  { id: "7", slug: "ach_initiated",     label: "ACH Initiated",    color: "#16A34A", sort_order: 7 },
  { id: "8", slug: "funds_in_bank",     label: "Funds in Bank",    color: "#00DE8F", sort_order: 8 },
];

// ── Funnel Events ───────────────────────────────────────────────────────────

const EVENT_STAGES: FunnelStatusSlug[] = [
  "waitlist", "booked_call", "sent_onboarding", "signed_up",
  "transaction_run", "funds_in_wallet", "ach_initiated", "funds_in_bank",
];

export const DEMO_FUNNEL_EVENTS: FunnelEvent[] = DEMO_REFERRED_USERS.slice(0, 15).map((u, i) => {
  const targetIdx = EVENT_STAGES.indexOf(u.status_slug);
  const fromIdx = Math.max(0, targetIdx - 1);
  return {
    id:               `demo-event-${i}`,
    referred_user_id: u.id,
    from_status:      targetIdx > 0 ? EVENT_STAGES[fromIdx] : null,
    to_status:        u.status_slug,
    created_at:       makeDate(i * 2),
  };
});

// ── Stage Durations ────────────────────────────────────────────────────────

export const DEMO_STAGE_DURATIONS: StageDuration[] = [
  { status_slug: "waitlist", avg_hours: 48 },
  { status_slug: "booked_call", avg_hours: 24 },
  { status_slug: "sent_onboarding", avg_hours: 12 },
  { status_slug: "signed_up", avg_hours: 6 },
  { status_slug: "transaction_run", avg_hours: 72 },
  { status_slug: "funds_in_wallet", avg_hours: 2 },
  { status_slug: "ach_initiated", avg_hours: 36 },
  { status_slug: "funds_in_bank", avg_hours: 4 },
];

// ── Recent Events (for activity feed) ───────────────────────────────────────

export const DEMO_RECENT_EVENTS = DEMO_REFERRED_USERS.slice(0, 8).map((u, i) => {
  const targetIdx = EVENT_STAGES.indexOf(u.status_slug);
  const fromIdx = Math.max(0, targetIdx - 1);
  return {
    id:             `demo-recent-${i}`,
    from_status:    (targetIdx > 0 ? EVENT_STAGES[fromIdx] : null) as FunnelStatusSlug | null,
    to_status:      u.status_slug,
    created_at:     makeDate(i),
    referred_users: { full_name: u.full_name },
  };
});

// ── Earnings ────────────────────────────────────────────────────────────────

export const DEMO_EARNINGS: Earning[] = DEMO_REFERRED_USERS
  .filter((u) => u.first_transaction_fee !== null)
  .map((u, i) => ({
    id:                    `demo-earning-${i}`,
    affiliate_id:          DEMO_AFFILIATE.id,
    referred_user_id:      u.id,
    amount:                Math.round((u.first_transaction_fee ?? 0) * 0.10 * 100) / 100,
    transaction_fee_amount: u.first_transaction_fee ?? 0,
    tier_at_earning:       "platinum" as const,
    transaction_ref:       null,
    status:                (i < 8 ? "paid" : i < 12 ? "approved" : "pending") as "paid" | "approved" | "pending",
    created_at:            makeDate(30 - i * 2),
    updated_at:            makeDate(28 - i * 2),
  }));

// ── Earnings Summary ────────────────────────────────────────────────────────

export const DEMO_EARNINGS_SUMMARY = {
  total:     DEMO_EARNINGS.reduce((s, e) => s + e.amount, 0),
  thisMonth: DEMO_EARNINGS.filter((e) => e.status !== "paid").reduce((s, e) => s + e.amount, 0),
  pending:   DEMO_EARNINGS.filter((e) => e.status === "pending").reduce((s, e) => s + e.amount, 0),
  paid:      DEMO_EARNINGS.filter((e) => e.status === "paid").reduce((s, e) => s + e.amount, 0),
};

// ── Monthly Earnings (for demo earnings graph) ─────────────────────────────

export const DEMO_MONTHLY_EARNINGS: { month: string; total: number }[] = (() => {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    // Simulate growth: earlier months lower, recent months higher
    const base = 200 + i * 80;
    const variance = Math.round(Math.sin(i * 1.3) * 60);
    return { month, total: Math.max(50, base + variance) };
  });
})();

// ── Leaderboard ─────────────────────────────────────────────────────────────

function currentPeriod(): string {
  const now = new Date();
  return `monthly_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export const DEMO_LEADERBOARD: LeaderboardSnapshot[] = Array.from({ length: 10 }, (_, i) => ({
  id:                  `demo-lb-${i}`,
  period:              currentPeriod(),
  affiliate_id:        i === 1 ? DEMO_AFFILIATE.id : `demo-affiliate-other-${i}`,
  rank:                i + 1,
  referred_user_count: 85 - i * 7,
  referred_volume:     320_000 - i * 28_000,
  total_earnings:      12_000 - i * 900,
  conversion_rate:     Math.round((75 - i * 3) * 100) / 100,
  percentile:          Math.round((i / 9) * 100 * 100) / 100,
  created_at:          new Date().toISOString(),
}));

// ── Transactions (for TransactionLedger on Earnings page) ────────────────────

interface DemoTransactionWithUser extends Transaction {
  user_name: string | null;
  user_email: string | null;
}

export const DEMO_TRANSACTIONS: DemoTransactionWithUser[] = DEMO_REFERRED_USERS
  .filter((u) => u.first_transaction_amount !== null)
  .map((u, i) => ({
    id:                       `demo-txn-${i}`,
    referred_user_id:         u.id,
    affiliate_id:             DEMO_AFFILIATE.id,
    airtable_record_id:       `demo-airtable-${i}`,
    amount:                   u.first_transaction_amount ?? 0,
    transaction_type:         "Transfer In",
    transaction_external_id:  `TXN-${String(1000 + i).padStart(6, "0")}`,
    transaction_date:         u.first_transaction_at ?? makeDate(10 - i),
    email:                    u.email,
    self_referral:            false,
    created_at:               u.first_transaction_at ?? makeDate(10 - i),
    updated_at:               u.first_transaction_at ?? makeDate(10 - i),
    user_name:                u.full_name,
    user_email:               u.email,
  }));

// ── Payout Account ──────────────────────────────────────────────────────────

export const DEMO_PAYOUT_ACCOUNT: PayoutAccount = {
  id:                   "demo-payout-acct-001",
  affiliate_id:         DEMO_AFFILIATE.id,
  provider:             "stripe_connect",
  provider_id:          "acct_demo_stripe_001",
  account_name:         "Rivera Growth Partners — Stripe",
  routing_number:       null,
  account_number_last4: "4821",
  is_default:           true,
  is_verified:          true,
  metadata:             null,
  created_at:           "2025-08-15T00:00:00Z",
  updated_at:           "2025-08-15T00:00:00Z",
};

export const DEMO_MERCURY_ACCOUNT_DISPLAY = {
  account_name: "Rivera Growth — Mercury Checking",
  is_verified:  true,
  last4:        "4821",
};

// ── Payouts ─────────────────────────────────────────────────────────────────

export const DEMO_PAYOUTS: Payout[] = Array.from({ length: 6 }, (_, i) => ({
  id:                    `demo-payout-${i}`,
  affiliate_id:          DEMO_AFFILIATE.id,
  payout_account_id:     DEMO_PAYOUT_ACCOUNT.id,
  amount:                Math.round((800 + i * 240) * 100) / 100,
  currency:              "usd",
  status:                (i === 0 ? "requested" : i === 1 ? "processing" : "completed") as
    "requested" | "processing" | "completed",
  provider_reference_id: i > 1 ? `mrc_demo_${i}` : null,
  period:                `monthly_2026_${String(4 - Math.min(i, 3)).padStart(2, "0")}`,
  created_at:            makeDate(i * 14 + 3),
  updated_at:            makeDate(i * 14 + 1),
}));

// ── Min payout amount (mirrors payout_settings) ─────────────────────────────

export const DEMO_MIN_PAYOUT_AMOUNT = 25;

// ── Previous-period rank (for Earnings ranking comparison) ──────────────────

export const DEMO_PREV_RANK = 4;
export const DEMO_TOTAL_AFFILIATES = 47;
