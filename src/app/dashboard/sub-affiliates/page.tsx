import { redirect } from "next/navigation";
import { getAffiliateContext } from "@/lib/affiliate-context";
import { buildSubAffiliateRollup, DIRECT_KEY } from "@/lib/sub-affiliates/rollup";
import SubAffiliateRoster from "@/components/dashboard/SubAffiliateRoster";
import { fmt } from "@/lib/fmt";

export const dynamic = "force-dynamic";

export default async function SubAffiliatesPage() {
  const ctx = await getAffiliateContext();
  if (!ctx) return null;
  const { db, affiliateId, affiliate, isDelegate, delegatePermissions } = ctx;

  // Master-tier only — direct-URL protection, not just nav hiding.
  if (affiliate.tier !== "master") redirect("/dashboard");
  const showEarnings = !isDelegate || delegatePermissions.canViewEarnings;

  // Fetch the COMPLETE sets — the rollup silently understates if fed a partial roster.
  const [{ data: users }, { data: txns }, { data: earnings }, { data: labels }] = await Promise.all([
    db.from("referred_users")
      .select("id, sub_affiliate_id, status_slug, first_transaction_amount, created_at")
      .eq("affiliate_id", affiliateId),
    db.from("transactions")
      .select("referred_user_id, amount")
      .eq("affiliate_id", affiliateId)
      .eq("transaction_type", "Transfer In")
      .eq("self_referral", false),
    db.from("earnings")
      .select("referred_user_id, amount, status")
      .eq("affiliate_id", affiliateId),
    db.from("sub_affiliate_labels")
      .select("sub_affiliate_id, label")
      .eq("affiliate_id", affiliateId),
  ]);

  const rows = buildSubAffiliateRollup({
    users: users ?? [], transactions: txns ?? [],
    earnings: earnings ?? [], labels: labels ?? [],
  });

  const subRows   = rows.filter((r) => r.subId !== DIRECT_KEY);
  const directRow = rows.find((r) => r.subId === DIRECT_KEY) ?? null;
  const agg = (list: typeof rows, k: "userCount" | "transactedCount" | "volume" | "earningsTotal") =>
    list.reduce((s, r) => s + r[k], 0);

  return (
    <>
      <div className="animate-reveal-up">
        <h1 className="text-2xl font-bold text-gray-900">Sub-Affiliates</h1>
        <p className="text-sm text-brand-400 mt-1">
          Performance of your network, grouped by sub-affiliate ID.
        </p>
      </div>

      {/* Aggregate rollup: sub-tagged vs direct */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat-card">
          <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Sub-Affiliates</p>
          <p className="text-stat font-bold text-gray-900 tabular-nums mt-1">{fmt.count(subRows.length)}</p>
        </div>
        <div className="stat-card">
          <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Network Users</p>
          <p className="text-stat font-bold text-gray-900 tabular-nums mt-1">{fmt.count(agg(subRows, "userCount"))}</p>
          <p className="text-[10px] text-brand-400 mt-1 tabular-nums">+{fmt.count(directRow?.userCount ?? 0)} direct</p>
        </div>
        <div className="stat-card">
          <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Network Volume</p>
          <p className="text-stat font-bold text-gray-900 tabular-nums mt-1">{fmt.currencyCompact(agg(subRows, "volume"))}</p>
          <p className="text-[10px] text-brand-400 mt-1 tabular-nums">+{fmt.currencyCompact(directRow?.volume ?? 0)} direct</p>
        </div>
        {showEarnings ? (
          <div className="stat-card-accent">
            <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Network Earnings</p>
            <p className="text-stat font-bold text-gray-900 tabular-nums mt-1">{fmt.currency(agg(subRows, "earningsTotal"))}</p>
            <p className="text-[10px] text-brand-400 mt-1 tabular-nums">+{fmt.currency(directRow?.earningsTotal ?? 0)} direct</p>
          </div>
        ) : (
          <div className="stat-card">
            <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Transacted</p>
            <p className="text-stat font-bold text-gray-900 tabular-nums mt-1">{fmt.count(agg(subRows, "transactedCount"))}</p>
          </div>
        )}
      </div>

      <SubAffiliateRoster rows={rows} showEarnings={showEarnings} canEditLabels={!isDelegate} />
    </>
  );
}
