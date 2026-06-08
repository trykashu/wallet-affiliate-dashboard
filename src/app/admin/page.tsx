import { redirect }            from "next/navigation";
import { createClient }        from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail }        from "@/lib/admin";
import { getBrandScope, inScope } from "@/lib/admin/brand-scope";
import { fmt }                 from "@/lib/fmt";
import EarningsTrendChart      from "@/components/admin/EarningsTrendChart";
import TopAffiliatesTable      from "@/components/admin/TopAffiliatesTable";
import SyncButtons             from "@/components/admin/SyncButtons";
import OverviewStatsRow        from "@/components/admin/OverviewStatsRow";
import type { StatRow }        from "@/components/admin/StatDrillDrawer";
import type { Affiliate, ReferredUser, Earning, Transaction } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) redirect("/dashboard");

  const scope = await getBrandScope();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const [affiliatesResult, usersResult, earningsResult, txnsResult] = await Promise.all([
    db.from("affiliates").select("*").order("created_at", { ascending: false }),
    db.from("referred_users").select("*").order("created_at", { ascending: false }),
    db.from("earnings").select("*"),
    db.from("transactions")
      .select("affiliate_id, transaction_type, transaction_date, amount")
      .gte("transaction_date", (() => {
        const d = new Date();
        d.setMonth(d.getMonth() - 13);
        return d.toISOString().slice(0, 10);
      })()),
  ]);

  // ── Brand scope ──────────────────────────────────────────────────
  // Kashu (whitelabel_brand_id null) vs Payova (whitelabel_brand_id set) are
  // kept entirely separate. Child rows are scoped via their affiliate.
  const allAffiliates: Affiliate[] = affiliatesResult.data ?? [];
  const affiliates = allAffiliates.filter((a) => inScope(a.whitelabel_brand_id, scope));
  const scopedIds = new Set(affiliates.map((a) => a.id));

  const users: ReferredUser[] = (usersResult.data ?? []).filter((u: ReferredUser) => scopedIds.has(u.affiliate_id));
  const allEarnings: Earning[] = (earningsResult.data ?? []).filter((e: Earning) => scopedIds.has(e.affiliate_id));
  const transactions: Pick<Transaction, "affiliate_id" | "transaction_type" | "transaction_date" | "amount">[] =
    (txnsResult.data ?? []).filter((t: { affiliate_id: string }) => scopedIds.has(t.affiliate_id));

  // -- Affiliate breakdown -- (signed only for headline counts/charts)
  const completedAffiliates       = affiliates.filter((a) => a.agreement_status === "Completed");
  const pendingSignatureAffiliates = affiliates.filter((a) => a.agreement_status === "Pending Partner Signature");
  const declinedAffiliates         = affiliates.filter((a) => a.agreement_status === "Declined");
  const notCreatedAffiliates       = affiliates.filter((a) => a.agreement_status === "Not Created" || !a.agreement_status);

  const completedCount        = completedAffiliates.length;
  const pendingSignatureCount = pendingSignatureAffiliates.length;
  const declinedCount         = declinedAffiliates.length;
  const notCreatedCount       = notCreatedAffiliates.length;

  const sumVolume = (rows: Affiliate[]) =>
    rows.reduce((s, a) => s + (a.referred_volume_total ?? 0), 0);

  const completedVolume        = sumVolume(completedAffiliates);
  const pendingSignatureVolume = sumVolume(pendingSignatureAffiliates);
  const declinedVolume         = sumVolume(declinedAffiliates);
  const notCreatedVolume       = sumVolume(notCreatedAffiliates);

  const totalVolume = affiliates.reduce((sum, a) => sum + (a.referred_volume_total ?? 0), 0);

  // -- Earnings breakdown --
  const pendingEarnings  = allEarnings.filter((e) => e.status === "pending").reduce((s, e) => s + e.amount, 0);
  const approvedEarnings = allEarnings.filter((e) => e.status === "approved").reduce((s, e) => s + e.amount, 0);
  const paidEarnings     = allEarnings.filter((e) => e.status === "paid").reduce((s, e) => s + e.amount, 0);
  const totalEarnings    = pendingEarnings + approvedEarnings + paidEarnings;

  // ── Month-over-month deltas (from already-fetched rows; null = no base) ──
  const now = new Date();
  const curMonthStart  = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const pctDelta = (cur: number, prev: number): number | null =>
    prev <= 0 ? null : ((cur - prev) / prev) * 100;

  const bucketCount = (timestamps: Array<string | null | undefined>) => {
    let cur = 0, prev = 0;
    for (const t of timestamps) {
      if (!t) continue;
      const d = new Date(t);
      if (d >= curMonthStart) cur++;
      else if (d >= prevMonthStart) prev++;
    }
    return { cur, prev };
  };

  const affBuckets = bucketCount(completedAffiliates.map((a) => a.agreement_completed_at ?? a.created_at));
  const affiliatesDelta = pctDelta(affBuckets.cur, affBuckets.prev);

  const userBuckets = bucketCount(users.map((u) => u.created_at));
  const usersDelta = pctDelta(userBuckets.cur, userBuckets.prev);

  let earnCur = 0, earnPrev = 0;
  for (const e of allEarnings) {
    if (!e.created_at) continue;
    const d = new Date(e.created_at);
    if (d >= curMonthStart) earnCur += e.amount;
    else if (d >= prevMonthStart) earnPrev += e.amount;
  }
  const earningsDelta = pctDelta(earnCur, earnPrev);

  // Volume delta isn't derivable from the referred_volume_total snapshot.
  const volumeDelta: number | null = null;

  // ── 12-month windows ─────────────────────────────────────────────
  const trendMonths = Array.from({ length: 12 }, (_, idx) =>
    new Date(curMonthStart.getFullYear(), curMonthStart.getMonth() - (11 - idx), 1),
  );
  const monthLabel = (d: Date) => d.toLocaleDateString("en-US", { month: "short" });
  const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;

  // Sum series helper (currency) and count series helper (additions).
  const sumByMonth = (rows: Array<{ ts: string | null | undefined; v: number }>) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      if (!r.ts) continue;
      const d = new Date(r.ts);
      const k = monthKey(d);
      m.set(k, (m.get(k) ?? 0) + (Number(r.v) || 0));
    }
    return trendMonths.map((d) => ({ label: monthLabel(d), value: m.get(monthKey(d)) ?? 0 }));
  };
  const countByMonth = (timestamps: Array<string | null | undefined>) => {
    const m = new Map<string, number>();
    for (const t of timestamps) {
      if (!t) continue;
      const d = new Date(t);
      const k = monthKey(d);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return trendMonths.map((d) => ({ label: monthLabel(d), value: m.get(monthKey(d)) ?? 0 }));
  };

  // System volume trend — TPV (Transfer-In) default, Cash Collected toggle.
  const tpvTrend = sumByMonth(
    transactions
      .filter((t) => t.transaction_type === "Transfer In")
      .map((t) => ({ ts: t.transaction_date, v: Number(t.amount) || 0 })),
  );
  const cashTrend = sumByMonth(allEarnings.map((e) => ({ ts: e.created_at, v: Number(e.transaction_fee_amount) || 0 })));

  // Drill-in additions-by-month.
  const affiliatesAddedTrend = countByMonth(completedAffiliates.map((a) => a.agreement_completed_at ?? a.created_at));
  const usersAddedTrend = countByMonth(users.map((u) => u.created_at));

  // ── Drill lists ──────────────────────────────────────────────────
  // Affiliates: most recently signed (additions, not "contributors").
  const topAffiliates: StatRow[] = completedAffiliates
    .slice()
    .sort((a, b) => {
      const av = a.agreement_completed_at ?? a.created_at ?? "";
      const bv = b.agreement_completed_at ?? b.created_at ?? "";
      return bv.localeCompare(av);
    })
    .slice(0, 10)
    .map((a) => ({
      affiliate_id: a.id,
      agent_name: a.agent_name,
      business_name: a.business_name ?? null,
      value: 0,
      sub: a.agreement_completed_at
        ? `signed ${fmt.date(a.agreement_completed_at)}`
        : `joined ${fmt.date(a.created_at)}`,
    }));

  const usersByAffiliate = new Map<string, number>();
  for (const u of users) {
    usersByAffiliate.set(u.affiliate_id, (usersByAffiliate.get(u.affiliate_id) ?? 0) + 1);
  }
  const affMap = new Map<string, Affiliate>();
  for (const a of affiliates) affMap.set(a.id, a);
  const topByUsers: StatRow[] = [...usersByAffiliate.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, count]) => {
      const aff = affMap.get(id);
      return {
        affiliate_id: id,
        agent_name: aff?.agent_name ?? "Unknown",
        business_name: aff?.business_name ?? null,
        value: count,
        sub: aff?.business_name ?? `${count} user${count === 1 ? "" : "s"}`,
      };
    });

  const topByVolume: StatRow[] = affiliates
    .slice()
    .sort((a, b) => (b.referred_volume_total ?? 0) - (a.referred_volume_total ?? 0))
    .filter((a) => (a.referred_volume_total ?? 0) > 0)
    .slice(0, 10)
    .map((a) => ({
      affiliate_id: a.id,
      agent_name: a.agent_name,
      business_name: a.business_name ?? null,
      value: a.referred_volume_total ?? 0,
      sub: a.business_name ?? "",
    }));

  const earningsByAffiliate = new Map<string, number>();
  for (const e of allEarnings) {
    earningsByAffiliate.set(e.affiliate_id, (earningsByAffiliate.get(e.affiliate_id) ?? 0) + e.amount);
  }
  const topByEarnings: StatRow[] = [...earningsByAffiliate.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([, total]) => total > 0)
    .slice(0, 10)
    .map(([id, total]) => {
      const aff = affMap.get(id);
      return {
        affiliate_id: id,
        agent_name: aff?.agent_name ?? "Unknown",
        business_name: aff?.business_name ?? null,
        value: total,
        sub: aff?.business_name ?? "",
      };
    });

  const topAffiliateRows = affiliates
    .map((a) => ({
      affiliate_id: a.id,
      agent_name: a.agent_name,
      business_name: a.business_name ?? null,
      volume: a.referred_volume_total ?? 0,
      earnings: earningsByAffiliate.get(a.id) ?? 0,
      users: usersByAffiliate.get(a.id) ?? 0,
      agreement_status: a.agreement_status ?? "Not Created",
    }))
    .filter((r) => r.volume > 0 || r.earnings > 0)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 8);

  return (
    <>
      {/* KPI hero */}
      <OverviewStatsRow
        totalAffiliates={completedCount}
        totalAffiliatesSub={`${pendingSignatureCount} awaiting signature / ${declinedCount} declined`}
        totalUsers={users.length}
        totalUsersSub={`Across ${completedCount} signed affiliates`}
        totalVolume={totalVolume}
        totalVolumeSub="Lifetime transaction volume"
        totalEarnings={totalEarnings}
        totalEarningsSub={`${fmt.currency(pendingEarnings)} pending / ${fmt.currency(approvedEarnings)} approved / ${fmt.currency(paidEarnings)} paid`}
        affiliatesDelta={affiliatesDelta}
        usersDelta={usersDelta}
        volumeDelta={volumeDelta}
        earningsDelta={earningsDelta}
        topAffiliates={topAffiliates}
        topByUsers={topByUsers}
        topByVolume={topByVolume}
        topByEarnings={topByEarnings}
        affiliatesTrend={affiliatesAddedTrend}
        usersTrend={usersAddedTrend}
      />

      {/* System volume trend + top affiliates — side by side.
          Top affiliates aligns its height to the trend chart and scrolls. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 items-stretch">
        <EarningsTrendChart tpv={tpvTrend} cash={cashTrend} />
        <div className="relative min-h-0">
          <div className="lg:absolute lg:inset-0">
            <TopAffiliatesTable rows={topAffiliateRows} />
          </div>
        </div>
      </div>

      {/* Data sync controls */}
      <SyncButtons />

      {/* Affiliate Pipeline — pre-signature breakdown */}
      <AffiliatePipelineCard
        completed={completedCount}
        completedVolume={completedVolume}
        pendingSignature={pendingSignatureCount}
        pendingSignatureVolume={pendingSignatureVolume}
        declined={declinedCount}
        declinedVolume={declinedVolume}
        notCreated={notCreatedCount}
        notCreatedVolume={notCreatedVolume}
        total={affiliates.length}
      />
    </>
  );
}

function AffiliatePipelineCard({
  completed,
  completedVolume,
  pendingSignature,
  pendingSignatureVolume,
  declined,
  declinedVolume,
  notCreated,
  notCreatedVolume,
  total,
}: {
  completed: number;
  completedVolume: number;
  pendingSignature: number;
  pendingSignatureVolume: number;
  declined: number;
  declinedVolume: number;
  notCreated: number;
  notCreatedVolume: number;
  total: number;
}) {
  const stages: { label: string; count: number; volume: number; tone: "accent" | "amber" | "red" | "muted" }[] = [
    { label: "Completed",                 count: completed,        volume: completedVolume,        tone: "accent" },
    { label: "Pending Partner Signature", count: pendingSignature, volume: pendingSignatureVolume, tone: "amber"  },
    { label: "Declined",                  count: declined,         volume: declinedVolume,         tone: "red"    },
    { label: "Not Created",               count: notCreated,       volume: notCreatedVolume,       tone: "muted"  },
  ];
  const max = Math.max(...stages.map((s) => s.count), 1);

  const toneClasses: Record<typeof stages[number]["tone"], { bar: string; text: string }> = {
    accent: { bar: "bg-[var(--ad-accent)]", text: "ad-accent-text" },
    amber:  { bar: "bg-[#F4C152]",          text: "text-[#F4C152]" },
    red:    { bar: "bg-[var(--ad-neg)]",    text: "text-[var(--ad-neg)]" },
    muted:  { bar: "bg-[var(--ad-text-3)]", text: "ad-text-3" },
  };

  return (
    <div className="ad-card overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--ad-border)] flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold ad-text-1">Affiliate Pipeline</h3>
          <p className="text-[11px] ad-text-3 mt-0.5">
            Where {fmt.count(total)} affiliate records sit in the agreement flow
          </p>
        </div>
      </div>
      <div className="px-5 py-5 space-y-3">
        {stages.map((s) => {
          const pct = total > 0 ? (s.count / total) * 100 : 0;
          const barW = (s.count / max) * 100;
          return (
            <div key={s.label} className="flex items-center gap-3">
              <div className="w-44 flex-shrink-0">
                <p className="text-xs font-medium ad-text-1">{s.label}</p>
              </div>
              <div className="flex-1 h-2 bg-[var(--ad-inset)] rounded-full overflow-hidden">
                <div
                  className={`h-full ${toneClasses[s.tone].bar} rounded-full transition-all`}
                  style={{ width: `${barW}%` }}
                />
              </div>
              <div className="w-44 flex-shrink-0 flex flex-col items-end leading-tight">
                <div className="flex items-baseline gap-2">
                  <span className={`text-sm font-semibold tabular-nums ${toneClasses[s.tone].text}`}>
                    {fmt.count(s.count)}
                  </span>
                  <span className="text-[10px] ad-text-3 tabular-nums">
                    {pct.toFixed(0)}%
                  </span>
                </div>
                <span className="text-[11px] ad-text-3 tabular-nums">
                  {s.volume > 0 ? fmt.currencyCompact(s.volume) : "$0"} volume
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
