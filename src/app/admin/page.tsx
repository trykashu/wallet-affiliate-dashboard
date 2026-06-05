import { redirect }            from "next/navigation";
import { createClient }        from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail }        from "@/lib/admin";
import { fmt }                 from "@/lib/fmt";
import AffiliateGrowthChart    from "@/components/admin/AffiliateGrowthChart";
import ReferralTrendChart      from "@/components/admin/ReferralTrendChart";
import { buildSegmentedReferralTrend } from "@/lib/admin/referral-trend";
import SyncButtons             from "@/components/admin/SyncButtons";
import OverviewStatsRow        from "@/components/admin/OverviewStatsRow";
import type { StatRow }        from "@/components/admin/StatDrillDrawer";
import type { Affiliate, ReferredUser, Earning, WebhookEvent, Transaction } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) redirect("/dashboard");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const [affiliatesResult, usersResult, earningsResult, webhookResult, txnsResult] = await Promise.all([
    db.from("affiliates").select("*").order("created_at", { ascending: false }),
    db.from("referred_users").select("*").order("created_at", { ascending: false }),
    db.from("earnings").select("*"),
    db.from("webhook_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10),
    db.from("transactions")
      .select("affiliate_id, transaction_type, self_referral, transaction_date, amount")
      .gte("transaction_date", (() => {
        const d = new Date();
        d.setMonth(d.getMonth() - 13);
        return d.toISOString().slice(0, 10);
      })()),
  ]);

  const affiliates:  Affiliate[]    = affiliatesResult.data  ?? [];
  const users:       ReferredUser[] = usersResult.data       ?? [];
  const allEarnings: Earning[]      = earningsResult.data    ?? [];
  const webhooks:    WebhookEvent[] = webhookResult.data     ?? [];
  const transactions: Pick<Transaction, "affiliate_id" | "transaction_type" | "self_referral" | "transaction_date" | "amount">[] =
    txnsResult.data ?? [];

  const payovaIds = new Set(
    affiliates.filter((a) => a.whitelabel_brand_id != null).map((a) => a.id),
  );
  const referralTrend = buildSegmentedReferralTrend(users, transactions, payovaIds, new Date());

  // -- Affiliate breakdown --
  // Charts and headline counts use only affiliates whose agreement is signed.
  // Pre-signature rows are tracked separately in the Pipeline card below.
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

  // -- Total referred volume — across ALL affiliates including pending-signature.
  // Pre-signed affiliates can still drive real volume, and surfacing it is useful
  // leverage to get them to sign.
  const totalVolume = affiliates.reduce((sum, a) => sum + (a.referred_volume_total ?? 0), 0);

  // -- Earnings breakdown --
  const pendingEarnings  = allEarnings.filter((e) => e.status === "pending").reduce((s, e) => s + e.amount, 0);
  const approvedEarnings = allEarnings.filter((e) => e.status === "approved").reduce((s, e) => s + e.amount, 0);
  const paidEarnings     = allEarnings.filter((e) => e.status === "paid").reduce((s, e) => s + e.amount, 0);
  const totalEarnings    = pendingEarnings + approvedEarnings + paidEarnings;

  // ── Top-10 contributors for each headline stat ───────────────────
  // Used by the click-to-drill stat cards.

  // 1. Affiliates: most recently signed (10 most recent agreement_completed_at).
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

  // 2. Users: top 10 affiliates by referred user count.
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

  // 3. Volume: top 10 affiliates by referred_volume_total.
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

  // 4. Earnings: top 10 affiliates by total earnings (all statuses combined).
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

  return (
    <>
      {/* Trend charts — limited to affiliates with a Completed agreement */}
      <AffiliateGrowthChart affiliates={completedAffiliates} />
      <ReferralTrendChart monthly={referralTrend.main.monthly} weekly={referralTrend.main.weekly} />
      <ReferralTrendChart
        monthly={referralTrend.payova.monthly}
        weekly={referralTrend.payova.weekly}
        title="Payova — Users Referred & Referred Volume"
        barColor="#7C3AED"
        lineColor="#8B5CF6"
        gradientId="payovaVolumeGrad"
      />

      {/* Stat cards */}
      <OverviewStatsRow
        totalAffiliates={completedCount}
        totalAffiliatesSub={`${pendingSignatureCount} awaiting signature / ${declinedCount} declined`}
        totalUsers={users.length}
        totalUsersSub={`Across ${completedCount} signed affiliates`}
        totalVolume={totalVolume}
        totalVolumeSub="Lifetime transaction volume"
        totalEarnings={totalEarnings}
        totalEarningsSub={`${fmt.currency(pendingEarnings)} pending / ${fmt.currency(approvedEarnings)} approved / ${fmt.currency(paidEarnings)} paid`}
        topAffiliates={topAffiliates}
        topByUsers={topByUsers}
        topByVolume={topByVolume}
        topByEarnings={topByEarnings}
      />

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

      {/* Data sync controls */}
      <SyncButtons />

      {/* Recent webhook events */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-200/60">
          <h3 className="text-sm font-semibold text-gray-900">Recent Webhook Activity</h3>
          <p className="text-xs text-brand-400 mt-0.5">Last 10 events</p>
        </div>
        {webhooks.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-brand-400">No webhook events recorded yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-surface-200/60 bg-surface-50/60">
                  <th className="th">Event Type</th>
                  <th className="th">Status</th>
                  <th className="th hidden sm:table-cell">Idempotency Key</th>
                  <th className="th">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-200/60">
                {webhooks.map((wh) => (
                  <tr key={wh.id} className="hover:bg-surface-100/40 transition-colors">
                    <td className="td">
                      <span className="text-sm font-medium text-gray-900">{wh.event_type}</span>
                    </td>
                    <td className="td">
                      <span className={`badge ${wh.processed ? "badge-accent" : wh.error_message ? "badge-red" : "badge-amber"}`}>
                        {wh.processed ? "processed" : wh.error_message ? "error" : "pending"}
                      </span>
                    </td>
                    <td className="td hidden sm:table-cell">
                      <span className="text-xs text-brand-400 font-mono truncate max-w-[200px] block">
                        {wh.idempotency_key}
                      </span>
                    </td>
                    <td className="td">
                      <span className="text-xs text-brand-400">{fmt.relative(wh.created_at)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
    accent: { bar: "bg-accent",         text: "text-accent"     },
    amber:  { bar: "bg-amber-400",      text: "text-amber-700"  },
    red:    { bar: "bg-red-400",        text: "text-red-700"    },
    muted:  { bar: "bg-surface-300",    text: "text-brand-400"  },
  };

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-surface-200/60 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Affiliate Pipeline</h3>
          <p className="text-xs text-brand-400 mt-0.5">
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
                <p className="text-xs font-medium text-gray-900">{s.label}</p>
              </div>
              <div className="flex-1 h-2 bg-surface-100 rounded-full overflow-hidden">
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
                  <span className="text-[10px] text-brand-400 tabular-nums">
                    {pct.toFixed(0)}%
                  </span>
                </div>
                <span className="text-[11px] text-brand-400 tabular-nums">
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

