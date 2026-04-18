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
  const activeCount    = affiliates.filter((a) => a.status === "active").length;
  const pendingCount   = affiliates.filter((a) => a.status === "pending").length;
  const suspendedCount = affiliates.filter((a) => a.status === "suspended").length;

  // -- Total referred volume --
  const totalVolume = affiliates.reduce((sum, a) => sum + (a.referred_volume_total ?? 0), 0);

  // -- Earnings breakdown --
  const pendingEarnings  = allEarnings.filter((e) => e.status === "pending").reduce((s, e) => s + e.amount, 0);
  const approvedEarnings = allEarnings.filter((e) => e.status === "approved").reduce((s, e) => s + e.amount, 0);
  const paidEarnings     = allEarnings.filter((e) => e.status === "paid").reduce((s, e) => s + e.amount, 0);
  const totalEarnings    = pendingEarnings + approvedEarnings + paidEarnings;

  return (
    <>
      {/* Trend charts */}
      <AffiliateGrowthChart affiliates={affiliates} />
      <UserConversionChart users={users} />

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Affiliates"
          value={fmt.count(affiliates.length)}
          sub={`${activeCount} active / ${pendingCount} pending / ${suspendedCount} suspended`}
          accentColor="brand"
        />
        <StatCard
          label="Total Referred Users"
          value={fmt.count(users.length)}
          sub={`Across ${activeCount} active affiliates`}
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
