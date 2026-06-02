import { redirect }            from "next/navigation";
import { createClient }        from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail, isFinanceEmail } from "@/lib/admin";
import { getBankReviewReasons } from "@/lib/bank-quality";
import { fmt }                 from "@/lib/fmt";
import PayoutBatchManager      from "@/components/admin/PayoutBatchManager";
import BankDetailsUpload       from "@/components/admin/BankDetailsUpload";
import BatchReviewSection      from "@/components/admin/BatchReviewSection";
import RequestedBatchesSection from "@/components/admin/RequestedBatchesSection";
import BatchBuilderSection, { type BatchBuilderAffiliate, type BatchBuilderEarning } from "@/components/admin/BatchBuilderSection";
import type { BatchSummary }   from "@/components/admin/BatchReviewSection";
import type { PayoutRow } from "@/components/admin/PayoutBatchManager";
import type { Payout, Earning, Affiliate, PayoutSettings } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AdminPayoutsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) redirect("/dashboard");
  const isFinance = isFinanceEmail(user.email);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const [payoutsResult, earningsResult, affiliatesResult, settingsResult] = await Promise.all([
    db.from("payouts").select("*").order("created_at", { ascending: false }),
    db.from("earnings").select("affiliate_id, amount, status").eq("status", "approved"),
    db.from("affiliates").select("id, agent_name, business_name, agreement_status, pandadoc_id"),
    db.from("payout_settings").select("*").limit(1).maybeSingle(),
  ]);

  // Approved earnings that aren't already in a batch — the universe the AM is choosing from.
  const { data: unbatchedRaw } = await db
    .from("earnings")
    .select("id, affiliate_id, amount, transaction_ref, tier_at_earning, custom_commission_rate, custom_commission_basis")
    .eq("status", "approved")
    .is("payout_id", null);

  type UnbatchedRow = {
    id: string;
    affiliate_id: string;
    amount: number;
    transaction_ref: string | null;
    tier_at_earning: "gold" | "platinum" | "custom";
    custom_commission_rate: number | null;
    custom_commission_basis: "tpv" | "kashu_fee" | null;
  };
  const unbatched = (unbatchedRaw as UnbatchedRow[] | null) ?? [];

  const txnRefs = unbatched.map((u) => u.transaction_ref).filter((r): r is string => !!r);
  const txnDateByRef = new Map<string, string | null>();
  if (txnRefs.length > 0) {
    const { data: txns } = await db
      .from("transactions")
      .select("airtable_record_id, transaction_date")
      .in("airtable_record_id", txnRefs);
    type TxnRow = { airtable_record_id: string; transaction_date: string | null };
    for (const t of (txns as TxnRow[] | null) ?? []) {
      txnDateByRef.set(t.airtable_record_id, t.transaction_date);
    }
  }

  const { data: verifiedAccountsRaw } = await db
    .from("payout_accounts")
    .select("affiliate_id, account_name, metadata")
    .eq("is_verified", true);
  type VerifiedAccountRow = {
    affiliate_id: string;
    account_name: string | null;
    metadata: { full_account_number?: string } | null;
  };
  const verifiedAccounts = (verifiedAccountsRaw as VerifiedAccountRow[] | null) ?? [];
  const payableAffiliateIds = new Set<string>(verifiedAccounts.map((a) => a.affiliate_id));

  const reasonsByAffiliate = new Map<string, string[]>();
  for (const acct of verifiedAccounts) {
    const reasons = getBankReviewReasons(acct);
    if (reasons.length > 0) {
      const existing = reasonsByAffiliate.get(acct.affiliate_id) ?? [];
      reasonsByAffiliate.set(acct.affiliate_id, [...existing, ...reasons]);
    }
  }

  const allPayouts:     Payout[]   = payoutsResult.data   ?? [];
  const approvedEarnings: Earning[] = earningsResult.data  ?? [];
  const affiliates:      Affiliate[] = affiliatesResult.data ?? [];
  const settings: PayoutSettings | null = settingsResult.data ?? null;

  const minPayout = settings?.min_payout_amount ?? 25;

  // Build affiliate name lookup
  const affiliateMap = new Map<string, string>();
  for (const a of affiliates) affiliateMap.set(a.id, a.agent_name);

  // Enrich payouts
  const payoutRows: PayoutRow[] = allPayouts.map((p) => ({
    id:                    p.id,
    affiliate_id:          p.affiliate_id,
    affiliate_name:        affiliateMap.get(p.affiliate_id) ?? "Unknown",
    amount:                p.amount,
    status:                p.status,
    provider_reference_id: p.provider_reference_id,
    period:                p.period,
    created_at:            p.created_at,
  }));

  // Count affiliates whose approved balance is above the min payout threshold (for stat card subtitle)
  const balanceByAffiliate = new Map<string, number>();
  for (const e of approvedEarnings) {
    balanceByAffiliate.set(e.affiliate_id, (balanceByAffiliate.get(e.affiliate_id) ?? 0) + e.amount);
  }
  let payableAffiliateCount = 0;
  for (const balance of balanceByAffiliate.values()) {
    if (balance >= minPayout) payableAffiliateCount += 1;
  }

  // Group payouts by batch_id for the review + execute UIs
  function groupByBatch(rows: Payout[]): BatchSummary[] {
    const byBatch = new Map<string, BatchSummary>();
    for (const p of rows) {
      if (!p.batch_id) continue;
      const existing = byBatch.get(p.batch_id);
      const affName = affiliateMap.get(p.affiliate_id) ?? "Unknown";
      if (existing) {
        existing.payout_count += 1;
        existing.total_amount += Number(p.amount) || 0;
        existing.payouts.push({
          id: p.id,
          affiliate_id: p.affiliate_id,
          affiliate_name: affName,
          amount: p.amount,
        });
      } else {
        byBatch.set(p.batch_id, {
          batch_id: p.batch_id,
          period: p.period ?? "—",
          submitted_by: p.submitted_by ?? "—",
          submitted_at: p.submitted_at ?? p.created_at,
          review_notes: p.review_notes ?? null,
          payout_count: 1,
          total_amount: Number(p.amount) || 0,
          payouts: [{
            id: p.id,
            affiliate_id: p.affiliate_id,
            affiliate_name: affName,
            amount: p.amount,
          }],
        });
      }
    }
    return Array.from(byBatch.values()).sort((a, b) =>
      (b.submitted_at ?? "").localeCompare(a.submitted_at ?? "")
    );
  }

  const pendingReviewBatches = groupByBatch(allPayouts.filter((p) => p.status === "pending_review"));
  const requestedBatches = groupByBatch(allPayouts.filter((p) => p.status === "requested" && p.batch_id));

  // Batch builder data
  const builderEarnings: BatchBuilderEarning[] = unbatched.map((u) => ({
    id: u.id,
    affiliate_id: u.affiliate_id,
    amount: Number(u.amount) || 0,
    transaction_date: u.transaction_ref ? (txnDateByRef.get(u.transaction_ref) ?? null) : null,
    tier_at_earning: u.tier_at_earning,
    custom_commission_rate: u.custom_commission_rate !== null ? Number(u.custom_commission_rate) : null,
    custom_commission_basis: u.custom_commission_basis,
  }));

  const referencedAffiliateIds = new Set(builderEarnings.map((e) => e.affiliate_id));
  const builderAffiliates: BatchBuilderAffiliate[] = affiliates
    .filter((a) => referencedAffiliateIds.has(a.id))
    .map((a) => ({
      affiliate_id: a.id,
      affiliate_name: a.agent_name,
      business_name: a.business_name ?? null,
      is_payable: payableAffiliateIds.has(a.id),
      contract_signed: a.agreement_status === "Completed" || a.agreement_status === "signed",
      pandadoc_id: a.pandadoc_id ?? null,
      bank_review_reasons: reasonsByAffiliate.get(a.id) ?? [],
    }));

  const monthSet = new Set<string>();
  for (const e of builderEarnings) {
    if (e.transaction_date) monthSet.add(e.transaction_date.slice(0, 7));
  }
  const availableMonths = Array.from(monthSet).sort().reverse();

  // Summary stats
  const totalPaid     = allPayouts.filter((p) => p.status === "completed").reduce((s, p) => s + p.amount, 0);
  const totalPending  = allPayouts
    .filter((p) => p.status === "requested" || p.status === "processing" || p.status === "pending_review")
    .reduce((s, p) => s + p.amount, 0);
  const totalApproved = approvedEarnings.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card accent-top">
          <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Ready for Payout</p>
          <p className="text-display-sm font-bold tabular-nums mt-1 text-accent">{fmt.currencyCompact(totalApproved)}</p>
          <p className="text-[10px] text-brand-400 mt-1.5">{payableAffiliateCount} affiliates above {fmt.currency(minPayout)} min</p>
        </div>
        <div className="stat-card accent-top">
          <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">In Progress</p>
          <p className="text-display-sm font-bold tabular-nums mt-1 text-amber-500">{fmt.currencyCompact(totalPending)}</p>
          <p className="text-[10px] text-brand-400 mt-1.5">Pending review, requested, or processing</p>
        </div>
        <div className="stat-card accent-top">
          <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Total Paid</p>
          <p className="text-display-sm font-bold tabular-nums mt-1 text-gray-900">{fmt.currencyCompact(totalPaid)}</p>
          <p className="text-[10px] text-brand-400 mt-1.5">{allPayouts.filter((p) => p.status === "completed").length} completed payouts</p>
        </div>
      </div>

      {availableMonths.length > 0 && (
        <BatchBuilderSection
          earnings={builderEarnings}
          affiliates={builderAffiliates}
          availableMonths={availableMonths}
        />
      )}

      {pendingReviewBatches.length > 0 && (
        <BatchReviewSection batches={pendingReviewBatches} isFinance={isFinance} />
      )}
      {isFinance && requestedBatches.length > 0 && (
        <RequestedBatchesSection batches={requestedBatches} />
      )}

      <BankDetailsUpload />

      <PayoutBatchManager payouts={payoutRows} />
    </div>
  );
}
