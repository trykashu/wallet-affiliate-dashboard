/**
 * Payova weekly payout reflection.
 *
 * Payova (whitelabel) affiliates are paid weekly through a SEPARATE, external
 * payout system — not the standard Mercury/admin flow. This module reflects
 * those external payments in the dashboard so the partner sees them as paid:
 * for a given Sat→Fri week it marks the relevant Payova earnings `paid` and
 * writes one `completed` payout row per affiliate. It never moves money /
 * never calls Mercury.
 *
 * Cumulative sweep: a run pays ALL not-yet-paid earnings dated on/before the
 * period's Friday — not just that one week. So if a prior week's external
 * payment came in under our computed total and the difference was left unpaid
 * (manual reconciliation), that remainder automatically rolls into the next
 * payout.
 *
 * Idempotent: skips earnings already paid/linked, and skips an affiliate whose
 * payout for that period already exists. Safe to re-run.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PayovaWeekResult {
  period: string;
  weekStart: string;
  weekEnd: string;
  paidAt: string;
  dryRun: boolean;
  affiliates: Array<{
    affiliate_id: string;
    agent_name: string;
    amount: number;
    earnings_count: number;
    payout_created: boolean;
    skipped_reason?: string;
  }>;
  totalPaid: number;
  earningsMarked: number;
}

const DAY = 86400000;

function isoDate(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}

/** ISO week label (YYYY-W##) for a date — used as the payout `period`. */
function isoWeekLabel(dateISO: string): string {
  const d = new Date(dateISO + "T00:00:00Z");
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7; // Mon=0
  t.setUTCDate(t.getUTCDate() - day + 3); // Thursday of this week
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t.getTime() - firstThu.getTime()) / DAY - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Given a run date (expected: a Friday), return the previous full Sat→Fri week
 * (the one that ended the prior Friday) and the Friday it is paid on (= ref).
 */
export function previousSatFriWeek(ref: Date): { weekStart: string; weekEnd: string; paidAt: string } {
  const r = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  const daysSinceSat = (r.getUTCDay() + 1) % 7; // Sat=0
  const thisSat = new Date(r.getTime() - daysSinceSat * DAY);
  const prevSat = new Date(thisSat.getTime() - 7 * DAY);
  const prevFri = new Date(thisSat.getTime() - 1 * DAY);
  return { weekStart: isoDate(prevSat), weekEnd: isoDate(prevFri), paidAt: isoDate(r) };
}

interface RunOpts {
  weekStart: string; // YYYY-MM-DD (Saturday)
  weekEnd: string;   // YYYY-MM-DD (Friday)
  paidAt: string;    // YYYY-MM-DD (the Friday the week is reflected paid)
  dryRun?: boolean;
}

/**
 * Reflect the external Payova payout for one Sat→Fri week.
 * `svc` must be a Supabase service-role client.
 */
export async function markPayovaWeekPaid(svc: any, opts: RunOpts): Promise<PayovaWeekResult> {
  const { weekStart, weekEnd, paidAt, dryRun = false } = opts;
  const period = isoWeekLabel(weekStart);
  const paidAtIso = new Date(paidAt + "T12:00:00Z").toISOString();

  const result: PayovaWeekResult = {
    period, weekStart, weekEnd, paidAt, dryRun, affiliates: [], totalPaid: 0, earningsMarked: 0,
  };

  // Payova affiliates + a verified default payout account (if any).
  const { data: affs } = await svc
    .from("affiliates")
    .select("id, agent_name")
    .not("whitelabel_brand_id", "is", null);
  const affList = (affs ?? []) as Array<{ id: string; agent_name: string }>;
  if (affList.length === 0) return result;
  const affName = new Map(affList.map((a) => [a.id, a.agent_name]));
  const affIds = affList.map((a) => a.id);

  const { data: accts } = await svc
    .from("payout_accounts")
    .select("id, affiliate_id, is_default, is_verified")
    .in("affiliate_id", affIds)
    .eq("is_verified", true);
  const acctByAff = new Map<string, string>();
  for (const a of (accts ?? []) as Array<{ id: string; affiliate_id: string; is_default: boolean }>) {
    if (!acctByAff.has(a.affiliate_id) || a.is_default) acctByAff.set(a.affiliate_id, a.id);
  }

  // Unpaid, unbatched Payova earnings.
  const { data: earns } = await svc
    .from("earnings")
    .select("id, affiliate_id, amount, status, created_at, transaction_ref, payout_id")
    .in("affiliate_id", affIds)
    .neq("status", "paid")
    .is("payout_id", null);
  const E = (earns ?? []) as Array<{ id: string; affiliate_id: string; amount: number; status: string; created_at: string; transaction_ref: string | null; payout_id: string | null }>;

  // Resolve transaction dates for week bucketing (fallback to created_at).
  const refs = E.map((e) => e.transaction_ref).filter((r): r is string => !!r);
  const dateByRef = new Map<string, string | null>();
  if (refs.length) {
    const { data: txns } = await svc
      .from("transactions")
      .select("airtable_record_id, transaction_date")
      .in("airtable_record_id", refs);
    for (const t of (txns ?? []) as Array<{ airtable_record_id: string; transaction_date: string | null }>) {
      dateByRef.set(t.airtable_record_id, t.transaction_date);
    }
  }

  // Cumulative: sweep everything unpaid dated on/before this period's Friday,
  // so any prior-week remainder (left unpaid during reconciliation) rolls in.
  const inWindow = (e: (typeof E)[number]) => {
    const raw = (e.transaction_ref && dateByRef.get(e.transaction_ref)) || e.created_at;
    if (!raw) return false;
    return isoDate(new Date(raw)) <= weekEnd;
  };

  // Group in-window earnings by affiliate.
  const groups = new Map<string, { amount: number; ids: string[] }>();
  for (const e of E) {
    if (!inWindow(e)) continue;
    const g = groups.get(e.affiliate_id) ?? { amount: 0, ids: [] };
    g.amount += Number(e.amount) || 0;
    g.ids.push(e.id);
    groups.set(e.affiliate_id, g);
  }

  for (const [affiliateId, g] of groups) {
    const amount = Math.round(g.amount * 100) / 100;

    // Idempotency: skip if a payout for this affiliate+period already exists.
    const { data: existing } = await svc
      .from("payouts")
      .select("id")
      .eq("affiliate_id", affiliateId)
      .eq("period", period)
      .limit(1);
    if ((existing ?? []).length > 0) {
      result.affiliates.push({ affiliate_id: affiliateId, agent_name: affName.get(affiliateId) ?? "?", amount, earnings_count: g.ids.length, payout_created: false, skipped_reason: "payout_exists" });
      continue;
    }

    if (dryRun) {
      result.affiliates.push({ affiliate_id: affiliateId, agent_name: affName.get(affiliateId) ?? "?", amount, earnings_count: g.ids.length, payout_created: false, skipped_reason: "dry_run" });
      result.totalPaid += amount;
      result.earningsMarked += g.ids.length;
      continue;
    }

    // 1) Completed payout row (reflection of the external payment).
    const { data: payout, error: pErr } = await svc
      .from("payouts")
      .insert({
        affiliate_id: affiliateId,
        payout_account_id: acctByAff.get(affiliateId) ?? null,
        amount,
        currency: "USD",
        status: "completed",
        period,
        provider_reference_id: "external-weekly",
        submitted_at: paidAtIso,
        created_at: paidAtIso,
      })
      .select("id")
      .single();
    if (pErr || !payout) {
      result.affiliates.push({ affiliate_id: affiliateId, agent_name: affName.get(affiliateId) ?? "?", amount, earnings_count: g.ids.length, payout_created: false, skipped_reason: `payout_insert_failed: ${pErr?.message ?? "unknown"}` });
      continue;
    }

    // 2) Mark the week's earnings paid + link to the payout.
    const { error: uErr } = await svc
      .from("earnings")
      .update({ status: "paid", payout_id: payout.id, updated_at: new Date().toISOString() })
      .in("id", g.ids);
    if (uErr) {
      result.affiliates.push({ affiliate_id: affiliateId, agent_name: affName.get(affiliateId) ?? "?", amount, earnings_count: g.ids.length, payout_created: true, skipped_reason: `earnings_update_failed: ${uErr.message}` });
      continue;
    }

    result.affiliates.push({ affiliate_id: affiliateId, agent_name: affName.get(affiliateId) ?? "?", amount, earnings_count: g.ids.length, payout_created: true });
    result.totalPaid += amount;
    result.earningsMarked += g.ids.length;
  }

  return result;
}
