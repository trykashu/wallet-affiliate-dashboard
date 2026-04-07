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
  Earning,
  LeaderboardSnapshot,
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
  signed_up:        8,
  transaction_run:  7,
  funds_in_wallet:  6,
  ach_initiated:    5,
  funds_in_bank:    4,
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
  { id: "1", slug: "signed_up",        label: "Signed Up",        color: "#BBF7D0", sort_order: 1 },
  { id: "2", slug: "transaction_run",   label: "Transaction Run",  color: "#4ADE80", sort_order: 2 },
  { id: "3", slug: "funds_in_wallet",   label: "Funds in Wallet",  color: "#22C55E", sort_order: 3 },
  { id: "4", slug: "ach_initiated",     label: "ACH Initiated",    color: "#16A34A", sort_order: 4 },
  { id: "5", slug: "funds_in_bank",     label: "Funds in Bank",    color: "#00DE8F", sort_order: 5 },
];

// ── Funnel Events ───────────────────────────────────────────────────────────

const EVENT_STAGES: FunnelStatusSlug[] = [
  "signed_up", "transaction_run", "funds_in_wallet", "ach_initiated", "funds_in_bank",
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
