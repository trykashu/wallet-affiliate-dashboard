import { buildBankAccountUpdate, type BankInput, type BuildOpts, type ExistingAccount } from "./bank-account-update";

const SELECT = "id, routing_number, account_number_last4, metadata, address1, address2, city, region, postal_code, country, provider_id";

/**
 * Upsert an affiliate's mercury payout_account using the pure builder.
 * `svc` is any Supabase client — service client (admin) or anon client (affiliate, RLS-scoped).
 * Returns { last4, bankChanged }.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function saveBankDetails(svc: any, input: BankInput, opts: BuildOpts): Promise<{ last4: string | null; bankChanged: boolean }> {
  const { data: existing } = await svc
    .from("payout_accounts")
    .select(SELECT)
    .eq("affiliate_id", input.affiliateId)
    .eq("provider", "mercury")
    .limit(1)
    .maybeSingle();

  const { row, bankChanged } = buildBankAccountUpdate((existing as ExistingAccount | null) ?? null, input, opts);

  if (existing) {
    const { error } = await svc.from("payout_accounts").update(row).eq("id", existing.id);
    if (error) throw new Error(`save-bank-details update failed: ${error.message}`);
  } else {
    const { error } = await svc.from("payout_accounts").insert(row);
    if (error) throw new Error(`save-bank-details insert failed: ${error.message}`);
  }
  return { last4: row.account_number_last4 ?? null, bankChanged };
}
