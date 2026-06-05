/**
 * Pure aggregation for the admin overview's referral trend chart.
 * Buckets referred users (by created_at) and Transfer-In transaction volume
 * (by transaction_date) into the last 12 calendar months and last 12
 * Monday-started weeks. `now` is passed in for deterministic tests.
 */

export interface ReferralBucket {
  key: string;
  label: string;
  users: number;
  volume: number;
}
export interface ReferralTrend {
  monthly: ReferralBucket[];
  weekly: ReferralBucket[];
}

interface UserRow { created_at: string }
interface TxnRow {
  transaction_type: string;
  self_referral: boolean;
  transaction_date: string | null;
  amount: number;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function shortMonth(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short" });
}
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function weekLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
/** Monday-start of the week containing `d` (local time, time stripped). */
function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay();                  // 0=Sun .. 6=Sat
  const diff = (day === 0 ? -6 : 1) - day; // shift back to Monday
  x.setDate(x.getDate() + diff);
  return x;
}

export function buildReferralTrend(
  users: UserRow[],
  transactions: TxnRow[],
  now: Date,
): ReferralTrend {
  // -- Build empty buckets + key->index maps --
  const monthly: ReferralBucket[] = [];
  const monthIdx = new Map<string, number>();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    monthIdx.set(key, monthly.length);
    monthly.push({ key, label: shortMonth(d), users: 0, volume: 0 });
  }

  const weekly: ReferralBucket[] = [];
  const weekIdx = new Map<string, number>();
  const thisMonday = weekStart(now);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(thisMonday);
    d.setDate(thisMonday.getDate() - i * 7);
    const key = dateKey(d);
    weekIdx.set(key, weekly.length);
    weekly.push({ key, label: weekLabel(d), users: 0, volume: 0 });
  }

  // -- Users by created_at --
  for (const u of users) {
    const d = new Date(u.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const mi = monthIdx.get(monthKey(d));
    if (mi !== undefined) monthly[mi].users++;
    const wi = weekIdx.get(dateKey(weekStart(d)));
    if (wi !== undefined) weekly[wi].users++;
  }

  // -- Volume by transaction_date (Transfer In, non-self-referral only) --
  for (const t of transactions) {
    if (t.transaction_type !== "Transfer In" || t.self_referral) continue;
    if (!t.transaction_date) continue;
    const d = new Date(t.transaction_date);
    if (Number.isNaN(d.getTime())) continue;
    const amt = Number(t.amount) || 0;
    const mi = monthIdx.get(monthKey(d));
    if (mi !== undefined) monthly[mi].volume += amt;
    const wi = weekIdx.get(dateKey(weekStart(d)));
    if (wi !== undefined) weekly[wi].volume += amt;
  }

  return { monthly, weekly };
}
