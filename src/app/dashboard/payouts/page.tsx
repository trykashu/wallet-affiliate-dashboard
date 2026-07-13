import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAffiliateContext } from "@/lib/affiliate-context";
import PayoutsClient from "@/components/dashboard/PayoutsClient";
import type { Earning, Payout, PayoutAccount } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function PayoutsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/login");
  if (ctx.isDelegate && !ctx.delegatePermissions.canViewPayouts) redirect("/dashboard");

  const { db, affiliateId, affiliate, brand } = ctx;

  const [
    { data: earningsRaw },
    { data: payoutsRaw },
    { data: accountRaw },
    { data: mercuryAccountRaw },
    { data: settingsRaw },
  ] = await Promise.all([
    db.from("earnings").select("*").eq("affiliate_id", affiliateId).neq("status", "reversed").order("created_at", { ascending: false }),
    db.from("payouts").select("*").eq("affiliate_id", affiliateId).order("created_at", { ascending: false }),
    db.from("payout_accounts")
      .select("id, affiliate_id, provider, account_name, is_verified, created_at")
      .eq("affiliate_id", affiliateId)
      .eq("provider", "stripe_connect")
      .eq("is_verified", true)
      .maybeSingle(),
    db.from("payout_accounts")
      .select("id, provider, account_name, account_number_last4, is_verified, metadata, address1, address2, city, region, postal_code")
      .eq("affiliate_id", affiliateId)
      .eq("provider", "mercury")
      .maybeSingle(),
    db.from("payout_settings").select("min_payout_amount").limit(1).single(),
  ]);

  const earnings       = (earningsRaw  ?? []) as Earning[];
  const payouts        = (payoutsRaw   ?? []) as Payout[];
  const account        = (accountRaw   ?? null) as PayoutAccount | null;
  const minPayoutAmount = settingsRaw?.min_payout_amount ?? 25;

  // Extract only display-safe fields from Mercury account — never pass full metadata to client.
  // Address (address1/address2/city/region/postal_code) is non-sensitive and prefills the self-service
  // bank form; account/routing numbers are NEVER returned to the client.
  const mercuryRow = mercuryAccountRaw as Record<string, unknown> | null;
  const mercuryAccountDisplay = mercuryRow
    ? {
        account_name: (mercuryRow.account_name as string) ?? "Bank Account",
        is_verified: mercuryRow.is_verified as boolean,
        last4: (mercuryRow.account_number_last4 as string) ?? undefined,
        address1: (mercuryRow.address1 as string) ?? undefined,
        address2: (mercuryRow.address2 as string) ?? undefined,
        city: (mercuryRow.city as string) ?? undefined,
        region: (mercuryRow.region as string) ?? undefined,
        postal_code: (mercuryRow.postal_code as string) ?? undefined,
      }
    : null;

  return (
    <>
      <div className="animate-reveal-up">
        <h1 className="text-2xl font-bold text-gray-900">Payouts</h1>
        <p className="text-sm text-brand-400 mt-1">
          Track your earnings and upcoming payouts.
        </p>
      </div>

      <PayoutsClient
        affiliateId={affiliateId}
        affiliateName={affiliate.agent_name}
        earnings={earnings}
        payouts={payouts}
        account={account}
        mercuryAccount={mercuryAccountDisplay}
        minPayoutAmount={minPayoutAmount}
        bankDetailsNeeded={!!affiliate.bank_details_needed}
        brandSlug={brand?.slug ?? null}
        isDelegate={ctx.isDelegate}
      />
    </>
  );
}
