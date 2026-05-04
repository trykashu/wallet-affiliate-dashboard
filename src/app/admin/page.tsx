import { redirect }            from "next/navigation";
import { createClient }        from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail }        from "@/lib/admin";
import { fmt }                 from "@/lib/fmt";
import AffiliateGrowthChart    from "@/components/admin/AffiliateGrowthChart";
import UserConversionChart     from "@/components/admin/UserConversionChart";
import SyncButtons             from "@/components/admin/SyncButtons";
import type { Affiliate, ReferredUser, Earning, WebhookEvent } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) redirect("/dashboard");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const [affiliatesResult, usersResult, earningsResult, webhookResult] = await Promise.all([
    db.from("affiliates").select("*").order("created_at", { ascending: false }),
    db.from("referred_users").select("*").order("created_at", { ascending: false }),
    db.from("earnings").select("*"),
    db.from("webhook_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const affiliates:  Affiliate[]    = affiliatesResult.data  ?? [];
  const users:       ReferredUser[] = usersResult.data       ?? [];
  const allEarnings: Earning[]      = earningsResult.data    ?? [];
  const webhooks:    WebhookEvent[] = webhookResult.data     ?? [];

  // -- Affiliate breakdown --
  // Charts and headline counts use only affiliates whose agreement is signed.
  // Pre-signature rows are tracked separately in the Pipeline card below.
  const completedAffiliates = affiliates.filter((a) => a.agreement_status === "Completed");
  const completedCount      = completedAffiliates.length;
  const pendingSignatureCount = affiliates.filter((a) => a.agreement_status === "Pending Partner Signature").length;
  const declinedCount         = affiliates.filter((a) => a.agreement_status === "Declined").length;
  const notCreatedCount       = affiliates.filter((a) => a.agreement_status === "Not Created" || !a.agreement_status).length;

  // -- Total referred volume — across ALL affiliates including pending-signature.
  // Pre-signed affiliates can still drive real volume, and surfacing it is useful
  // leverage to get them to sign.
  const totalVolume = affiliates.reduce((sum, a) => sum + (a.referred_volume_total ?? 0), 0);

  // -- Earnings breakdown --
  const pendingEarnings  = allEarnings.filter((e) => e.status === "pending").reduce((s, e) => s + e.amount, 0);
  const approvedEarnings = allEarnings.filter((e) => e.status === "approved").reduce((s, e) => s + e.amount, 0);
  const paidEarnings     = allEarnings.filter((e) => e.status === "paid").reduce((s, e) => s + e.amount, 0);
  const totalEarnings    = pendingEarnings + approvedEarnings + paidEarnings;

  return (
    <>
      {/* Trend charts — limited to affiliates with a Completed agreement */}
      <AffiliateGrowthChart affiliates={completedAffiliates} />
      <UserConversionChart users={users} />

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Affiliates"
          value={fmt.count(completedCount)}
          sub={`${pendingSignatureCount} awaiting signature / ${declinedCount} declined`}
          accentColor="brand"
        />
        <StatCard
          label="Total Referred Users"
          value={fmt.count(users.length)}
          sub={`Across ${completedCount} signed affiliates`}
          accentColor="accent"
        />
        <StatCard
          label="Total Referred Volume"
          value={fmt.currencyCompact(totalVolume)}
          sub="Lifetime transaction volume"
          accentColor="accent"
        />
        <StatCard
          label="Total Earnings"
          value={fmt.currencyCompact(totalEarnings)}
          sub={`${fmt.currency(pendingEarnings)} pending / ${fmt.currency(approvedEarnings)} approved / ${fmt.currency(paidEarnings)} paid`}
          accentColor="brand"
        />
      </div>

      {/* Affiliate Pipeline — pre-signature breakdown */}
      <AffiliatePipelineCard
        completed={completedCount}
        pendingSignature={pendingSignatureCount}
        declined={declinedCount}
        notCreated={notCreatedCount}
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
  pendingSignature,
  declined,
  notCreated,
  total,
}: {
  completed: number;
  pendingSignature: number;
  declined: number;
  notCreated: number;
  total: number;
}) {
  const stages: { label: string; count: number; tone: "accent" | "amber" | "red" | "muted" }[] = [
    { label: "Completed",                count: completed,        tone: "accent" },
    { label: "Pending Partner Signature", count: pendingSignature, tone: "amber"  },
    { label: "Declined",                 count: declined,         tone: "red"    },
    { label: "Not Created",              count: notCreated,       tone: "muted"  },
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
              <div className="w-28 flex-shrink-0 flex items-baseline justify-end gap-2">
                <span className={`text-sm font-semibold tabular-nums ${toneClasses[s.tone].text}`}>
                  {fmt.count(s.count)}
                </span>
                <span className="text-[10px] text-brand-400 tabular-nums">
                  {pct.toFixed(0)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accentColor,
}: {
  label: string;
  value: string;
  sub: string;
  accentColor: "brand" | "accent";
}) {
  return (
    <div className="stat-card accent-top">
      <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">{label}</p>
      <p className={`text-display-sm font-bold tabular-nums mt-1 ${
        accentColor === "accent" ? "text-accent" : "text-gray-900"
      }`}>
        {value}
      </p>
      <p className="text-[10px] text-brand-400 mt-1.5 leading-relaxed">{sub}</p>
    </div>
  );
}
