import { redirect }            from "next/navigation";
import { createClient }        from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail }        from "@/lib/admin";
import { fmt }                 from "@/lib/fmt";
import AdminEarningsTable      from "@/components/admin/AdminEarningsTable";
import AuditPanel              from "@/components/admin/AuditPanel";
import type { AdminEarning }   from "@/components/admin/AdminEarningsTable";
import type { Earning, Affiliate, ReferredUser, Transaction } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AdminEarningsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) redirect("/dashboard");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const [earningsResult, affiliatesResult, usersResult, payoutAccountsResult] = await Promise.all([
    db.from("earnings").select("*").order("created_at", { ascending: false }),
    // Exclude whitelabel-branded affiliates (Payova / Travis Marker) — they
    // require a custom payout flow and must not appear in the standard
    // earnings/payouts review queue. Travis's own dashboard fetches via
    // getAffiliateContext (user-scoped) and is unaffected.
    db.from("affiliates").select("id, agent_name, agreement_status").is("whitelabel_brand_id", null),
    db.from("referred_users").select("id, full_name"),
    db.from("payout_accounts").select("affiliate_id, is_default, is_verified").eq("is_verified", true),
  ]);

  const allEarningsRaw: Earning[]      = earningsResult.data   ?? [];
  const affiliates:     Affiliate[]    = affiliatesResult.data ?? [];
  const referredUsers:  ReferredUser[] = usersResult.data     ?? [];
  const nonWhitelabelIds = new Set(affiliates.map((a) => a.id));
  const allEarnings = allEarningsRaw.filter((e) => nonWhitelabelIds.has(e.affiliate_id));

  type AcctRow = { affiliate_id: string; is_default: boolean; is_verified: boolean };
  const payableAffiliateIds = new Set<string>(
    ((payoutAccountsResult.data as AcctRow[] | null) ?? []).map((a) => a.affiliate_id)
  );

  const affiliateMap = new Map<string, string>();
  for (const a of affiliates) affiliateMap.set(a.id, a.agent_name);

  const agreementMap = new Map<string, string | null>();
  for (const a of affiliates) agreementMap.set(a.id, a.agreement_status ?? null);

  const userMap = new Map<string, string>();
  for (const u of referredUsers) userMap.set(u.id, u.full_name);

  // Look up TPV + funnel % + transaction_date per earning by joining on transaction_ref ↔ transactions.airtable_record_id
  const earningRefs = allEarnings.map((e) => e.transaction_ref).filter((r): r is string => !!r);
  const txnByRef = new Map<string, { amount: number; funnel_percent: number | null; transaction_date: string | null }>();
  if (earningRefs.length > 0) {
    const { data: refTxns } = await db
      .from("transactions")
      .select("airtable_record_id, amount, funnel_percent, transaction_date")
      .in("airtable_record_id", earningRefs);
    type RefRow = Pick<Transaction, "airtable_record_id" | "amount"> & {
      funnel_percent: number | null;
      transaction_date: string | null;
    };
    for (const t of (refTxns ?? []) as RefRow[]) {
      txnByRef.set(t.airtable_record_id, {
        amount: Number(t.amount) || 0,
        funnel_percent: t.funnel_percent != null ? Number(t.funnel_percent) : null,
        transaction_date: t.transaction_date,
      });
    }
  }

  const enriched: AdminEarning[] = allEarnings.map((e) => {
    const ref = e.transaction_ref ? txnByRef.get(e.transaction_ref) : undefined;
    return {
      id:                     e.id,
      created_at:             e.created_at,
      affiliate_id:           e.affiliate_id,
      affiliate_name:         affiliateMap.get(e.affiliate_id) ?? "Unknown",
      referred_user_name:     userMap.get(e.referred_user_id) ?? "Unknown",
      transaction_fee_amount: e.transaction_fee_amount,
      tier_at_earning:        e.tier_at_earning,
      amount:                 e.amount,
      status:                 e.status,
      tpv:                    ref?.amount ?? null,
      funnel_percent:         ref?.funnel_percent ?? null,
      contract_status:        agreementMap.get(e.affiliate_id) ?? null,
      transaction_date:       ref?.transaction_date ?? null,
      payout_id:              e.payout_id ?? null,
      affiliate_is_payable:   payableAffiliateIds.has(e.affiliate_id),
    };
  });

  // Available months for the month filter (YYYY-MM, newest first)
  const monthSet = new Set<string>();
  for (const e of enriched) {
    if (e.transaction_date) {
      monthSet.add(e.transaction_date.slice(0, 7));
    }
  }
  const availableMonths = Array.from(monthSet).sort().reverse();

  // Summary stats
  const pending  = allEarnings.filter((e) => e.status === "pending").reduce((s, e) => s + e.amount, 0);
  const approved = allEarnings.filter((e) => e.status === "approved").reduce((s, e) => s + e.amount, 0);
  const paid     = allEarnings.filter((e) => e.status === "paid").reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card accent-top">
          <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Pending</p>
          <p className="text-display-sm font-bold tabular-nums mt-1 text-amber-500">{fmt.currencyCompact(pending)}</p>
          <p className="text-[10px] text-brand-400 mt-1.5">{allEarnings.filter((e) => e.status === "pending").length} earnings</p>
        </div>
        <div className="stat-card accent-top">
          <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Approved</p>
          <p className="text-display-sm font-bold tabular-nums mt-1 text-accent">{fmt.currencyCompact(approved)}</p>
          <p className="text-[10px] text-brand-400 mt-1.5">{allEarnings.filter((e) => e.status === "approved").length} earnings</p>
        </div>
        <div className="stat-card accent-top">
          <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Paid</p>
          <p className="text-display-sm font-bold tabular-nums mt-1 text-gray-900">{fmt.currencyCompact(paid)}</p>
          <p className="text-[10px] text-brand-400 mt-1.5">{allEarnings.filter((e) => e.status === "paid").length} earnings</p>
        </div>
      </div>

      <AuditPanel />

      <AdminEarningsTable earnings={enriched} availableMonths={availableMonths} />
    </div>
  );
}
