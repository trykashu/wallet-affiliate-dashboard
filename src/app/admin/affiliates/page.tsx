import { redirect }            from "next/navigation";
import { createClient }        from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail }        from "@/lib/admin";
import { getBrandScope, inScope } from "@/lib/admin/brand-scope";
import { getBankReviewReasons } from "@/lib/bank-quality";
import AffiliateTable          from "@/components/admin/AffiliateTable";
import type { Affiliate, ReferredUser, Earning } from "@/types/database";

export const dynamic = "force-dynamic";

export interface AffiliateWithCounts extends Affiliate {
  referredUserCount: number;
  volume: number;
  totalEarnings: number;
  hasBankAccount: boolean;
  bankPendingReview: boolean;
  hasLogin: boolean;        // user_id is set (invite accepted)
  hasPassword: boolean;     // account fully set up
  lastLoginAt: string | null;
  bank_review_reasons: string[];
  // Prefill for the admin Edit-bank drawer (from the affiliate's mercury account)
  bank_account_name: string | null;
  bank_last4: string | null;
  bank_address1: string | null;
  bank_address2: string | null;
  bank_city: string | null;
  bank_region: string | null;
  bank_postal_code: string | null;
}

export default async function AdminAffiliatesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) redirect("/dashboard");

  const scope = await getBrandScope();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const [affiliatesResult, usersResult, earningsResult, payoutAccountsResult] = await Promise.all([
    db.from("affiliates").select("*").order("created_at", { ascending: false }),
    db.from("referred_users").select("id, affiliate_id"),
    db.from("earnings").select("affiliate_id, amount, status"),
    db.from("payout_accounts")
      .select("affiliate_id, account_name, account_number_last4, is_verified, is_default, metadata, address1, address2, city, region, postal_code, updated_at")
      .eq("provider", "mercury"),
  ]);

  const affiliates:  Affiliate[]    = (affiliatesResult.data ?? []).filter((a: Affiliate) => inScope(a.whitelabel_brand_id, scope));
  const users:       ReferredUser[] = usersResult.data      ?? [];
  const allEarnings: Earning[]      = earningsResult.data   ?? [];

  type AccountRow = {
    affiliate_id: string;
    account_name: string | null;
    account_number_last4: string | null;
    is_verified: boolean | null;
    is_default: boolean | null;
    metadata: { full_account_number?: string; pending_review?: boolean } | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    region: string | null;
    postal_code: string | null;
    updated_at: string | null;
  };

  // Build set of affiliates with a VERIFIED bank account on file (preserves the
  // prior "On file" meaning), a set with a pending-review/unverified account, and
  // accumulate review reasons. Also stash the best account per affiliate for the
  // admin Edit-bank drawer prefill (prefer default, then most recently updated).
  const affiliatesWithBank = new Set<string>();
  const affiliatesPendingReview = new Set<string>();
  const reasonsByAffiliate = new Map<string, string[]>();
  const bestAccountByAffiliate = new Map<string, AccountRow>();
  for (const pa of (payoutAccountsResult.data as AccountRow[] | null) ?? []) {
    if (!pa.affiliate_id) continue;
    if (pa.is_verified === true) affiliatesWithBank.add(pa.affiliate_id);
    if (pa.is_verified !== true || pa.metadata?.pending_review === true) {
      affiliatesPendingReview.add(pa.affiliate_id);
    }
    const reasons = getBankReviewReasons(pa);
    if (reasons.length > 0) {
      const existing = reasonsByAffiliate.get(pa.affiliate_id) ?? [];
      reasonsByAffiliate.set(pa.affiliate_id, [...existing, ...reasons]);
    }
    // Pick the preferred account for prefill.
    const current = bestAccountByAffiliate.get(pa.affiliate_id);
    if (!current) {
      bestAccountByAffiliate.set(pa.affiliate_id, pa);
    } else {
      const paWins =
        (pa.is_default === true && current.is_default !== true) ||
        (pa.is_default === current.is_default &&
          (pa.updated_at ?? "") > (current.updated_at ?? ""));
      if (paWins) bestAccountByAffiliate.set(pa.affiliate_id, pa);
    }
  }

  // Build lookup maps
  const usersByAffiliate = new Map<string, ReferredUser[]>();
  for (const u of users) {
    const arr = usersByAffiliate.get(u.affiliate_id) ?? [];
    arr.push(u);
    usersByAffiliate.set(u.affiliate_id, arr);
  }

  const earningsByAffiliate = new Map<string, number>();
  for (const e of allEarnings) {
    earningsByAffiliate.set(e.affiliate_id, (earningsByAffiliate.get(e.affiliate_id) ?? 0) + e.amount);
  }

  const enriched: AffiliateWithCounts[] = affiliates.map((a) => {
    const refUsers = usersByAffiliate.get(a.id) ?? [];
    // Use the maintained running total — first_transaction_amount is only
    // the per-user first-deposit snapshot and undercounts true volume.
    const volume = Number(a.referred_volume_total) || 0;
    // Spread preserves all Affiliate fields including `status`, which
    // AffiliateTable uses to render the "Archived" badge.
    const best = bestAccountByAffiliate.get(a.id) ?? null;
    return {
      ...a,
      referredUserCount: refUsers.length,
      volume,
      totalEarnings: earningsByAffiliate.get(a.id) ?? 0,
      hasBankAccount: affiliatesWithBank.has(a.id),
      bankPendingReview: affiliatesPendingReview.has(a.id),
      hasLogin: !!a.user_id,
      hasPassword: !!a.has_password,
      lastLoginAt: a.last_login_at,
      bank_review_reasons: reasonsByAffiliate.get(a.id) ?? [],
      bank_account_name: best?.account_name ?? null,
      bank_last4: best?.account_number_last4 ?? null,
      bank_address1: best?.address1 ?? null,
      bank_address2: best?.address2 ?? null,
      bank_city: best?.city ?? null,
      bank_region: best?.region ?? null,
      bank_postal_code: best?.postal_code ?? null,
    };
  });

  return <AffiliateTable affiliates={enriched} />;
}
