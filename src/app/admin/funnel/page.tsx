import { redirect }            from "next/navigation";
import { createClient }        from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail }        from "@/lib/admin";
import { getBrandScope, inScope } from "@/lib/admin/brand-scope";
import HolographicFunnel       from "@/components/admin/AdminHolographicFunnel";
import DropOffAnalysis         from "@/components/admin/AdminDropOffAnalysis";
import type { ReferredUser, FunnelEvent, FunnelStatus, StageDuration } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AdminFunnelPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) redirect("/dashboard");

  const scope = await getBrandScope();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const [usersResult, eventsResult, statusesResult, affiliatesResult] = await Promise.all([
    db.from("referred_users").select("*"),
    db.from("funnel_events").select("*"),
    db.from("funnel_statuses").select("*").order("sort_order", { ascending: true }),
    db.from("affiliates").select("id, whitelabel_brand_id"),
  ]);

  // Scope to the active brand (Kashu vs Payova) via the affiliate, then keep
  // only events belonging to in-scope users.
  type AffRow = { id: string; whitelabel_brand_id: string | null };
  const scopedAffIds = new Set(
    ((affiliatesResult.data ?? []) as AffRow[]).filter((a) => inScope(a.whitelabel_brand_id, scope)).map((a) => a.id),
  );
  const allUsers:      ReferredUser[] = (usersResult.data ?? []).filter((u: ReferredUser) => scopedAffIds.has(u.affiliate_id));
  const scopedUserIds = new Set(allUsers.map((u) => u.id));
  const allEvents:     FunnelEvent[]  = (eventsResult.data ?? []).filter((e: FunnelEvent) => scopedUserIds.has(e.referred_user_id));
  const funnelStatuses: FunnelStatus[] = statusesResult.data ?? [];

  // Compute average stage durations from funnel_events
  const userFirstEvent: Record<string, Record<string, number>> = {};

  for (const e of allEvents) {
    const uid = e.referred_user_id;
    if (!userFirstEvent[uid]) userFirstEvent[uid] = {};

    const ts = new Date(e.created_at).getTime();
    if (e.to_status) {
      if (!userFirstEvent[uid][e.to_status] || ts < userFirstEvent[uid][e.to_status]) {
        userFirstEvent[uid][e.to_status] = ts;
      }
    }
  }

  const STAGES = ["waitlist", "booked_call", "sent_onboarding", "signed_up", "transaction_run", "funds_in_wallet", "ach_initiated", "funds_in_bank"];
  const durationsByStage: Record<string, number[]> = {};

  for (let i = 1; i < STAGES.length; i++) {
    const from = STAGES[i - 1];
    const to = STAGES[i];
    const durations: number[] = [];

    for (const uid of Object.keys(userFirstEvent)) {
      const fromTs = userFirstEvent[uid][from];
      const toTs = userFirstEvent[uid][to];
      if (fromTs && toTs && toTs > fromTs) {
        durations.push((toTs - fromTs) / (1000 * 60 * 60));
      }
    }

    if (durations.length > 0) {
      const avg = durations.reduce((s, d) => s + d, 0) / durations.length;
      if (!durationsByStage[to]) durationsByStage[to] = [];
      durationsByStage[to].push(avg);
    }
  }

  const stageDurations: StageDuration[] = Object.entries(durationsByStage).map(([slug, arr]) => ({
    status_slug: slug,
    avg_hours: arr.reduce((s, v) => s + v, 0) / arr.length,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-bold ad-text-3 uppercase tracking-wider">System-Wide Funnel</h2>
        <p className="text-xs ad-text-3 mt-0.5">All affiliates combined</p>
      </div>

      <HolographicFunnel
        users={allUsers}
        statuses={funnelStatuses}
        stageDurations={stageDurations}
        events={allEvents}
      />

      <DropOffAnalysis
        users={allUsers}
        events={allEvents}
      />
    </div>
  );
}
