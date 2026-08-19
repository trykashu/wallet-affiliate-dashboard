/**
 * Sub-affiliate rollup for master-tier partners.
 * Groups the master's own referred_users/transactions/earnings by
 * sub_affiliate_id. Pure function — testable without Supabase.
 * "Transacted" matches the canonical definition (StatsRow.tsx / refresh-leaderboard).
 */

export const DIRECT_KEY = "__direct__";

const TRANSACTED_SLUGS = new Set(["transaction_run", "funds_in_wallet", "ach_initiated", "funds_in_bank"]);

export interface RollupUser {
  id: string;
  sub_affiliate_id: string | null;
  status_slug: string;
  first_transaction_amount: number | null;
  created_at: string;
}
export interface RollupTxn     { referred_user_id: string | null; amount: number; }
export interface RollupEarning { referred_user_id: string | null; amount: number; status: string; }
export interface RollupLabel   { sub_affiliate_id: string; label: string; }

export interface SubRollupRow {
  subId: string;          // DIRECT_KEY for untagged users
  label: string | null;
  userCount: number;
  transactedCount: number;
  conversionPct: number;  // 0-100, 1dp
  volume: number;
  earningsTotal: number;  // excludes reversed
  lastActivity: string | null; // latest user created_at ISO
}

function isTransacted(u: RollupUser): boolean {
  return (u.first_transaction_amount ?? 0) > 0 || TRANSACTED_SLUGS.has(u.status_slug);
}

export function buildSubAffiliateRollup(input: {
  users: RollupUser[];
  transactions: RollupTxn[];
  earnings: RollupEarning[];
  labels: RollupLabel[];
}): SubRollupRow[] {
  const { users, transactions, earnings, labels } = input;
  if (users.length === 0) return [];

  const labelMap = new Map(labels.map((l) => [l.sub_affiliate_id, l.label]));
  const subByUser = new Map(users.map((u) => [u.id, u.sub_affiliate_id ?? DIRECT_KEY]));

  const groups = new Map<string, SubRollupRow>();
  const get = (key: string): SubRollupRow => {
    let g = groups.get(key);
    if (!g) {
      g = {
        subId: key,
        label: key === DIRECT_KEY ? null : (labelMap.get(key) ?? null),
        userCount: 0, transactedCount: 0, conversionPct: 0,
        volume: 0, earningsTotal: 0, lastActivity: null,
      };
      groups.set(key, g);
    }
    return g;
  };

  for (const u of users) {
    const g = get(u.sub_affiliate_id ?? DIRECT_KEY);
    g.userCount++;
    if (isTransacted(u)) g.transactedCount++;
    if (!g.lastActivity || u.created_at > g.lastActivity) g.lastActivity = u.created_at;
  }
  for (const t of transactions) {
    const key = t.referred_user_id ? subByUser.get(t.referred_user_id) : undefined;
    if (key) get(key).volume += Number(t.amount) || 0;
  }
  for (const e of earnings) {
    if (e.status === "reversed") continue;
    const key = e.referred_user_id ? subByUser.get(e.referred_user_id) : undefined;
    if (key) get(key).earningsTotal += Number(e.amount) || 0;
  }

  const rows = [...groups.values()];
  for (const r of rows) {
    r.conversionPct = r.userCount > 0 ? Math.round((r.transactedCount / r.userCount) * 1000) / 10 : 0;
    r.volume = Math.round(r.volume * 100) / 100;
    r.earningsTotal = Math.round(r.earningsTotal * 100) / 100;
  }
  // Volume DESC then userCount DESC; Direct always last.
  rows.sort((a, b) => {
    if (a.subId === DIRECT_KEY) return 1;
    if (b.subId === DIRECT_KEY) return -1;
    if (b.volume !== a.volume) return b.volume - a.volume;
    return b.userCount - a.userCount;
  });
  return rows;
}
