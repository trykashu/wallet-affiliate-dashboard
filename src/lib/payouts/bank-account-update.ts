/**
 * Pure decision function for admin/affiliate bank-detail editing.
 *
 * The Mercury payout recipient id lives in `payout_accounts.provider_id` and is
 * created lazily at payout time, then reused. To keep Mercury correct when bank
 * details change, we MUST NULL `provider_id` whenever the routing number, account
 * number, or address changed — so the next payout re-binds via Mercury's existing
 * dedupe instead of paying a stale recipient.
 *
 * This module is intentionally pure: no DB, no Mercury calls. It just computes
 * the row to upsert and whether bank details changed.
 */

export interface BankAddressInput {
  address1: string;
  address2?: string | null;
  city: string;
  region: string;
  postalCode: string;
  country?: string;
}

export interface BankInput {
  affiliateId: string;
  accountHolderName: string;
  routingNumber: string;
  /** Blank/undefined => keep existing account number. */
  accountNumber?: string;
  address?: BankAddressInput;
}

export interface ExistingAccount {
  routing_number: string | null;
  account_number_last4: string | null;
  metadata: Record<string, unknown> | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  provider_id: string | null;
}

export interface BuildOpts {
  markVerified: boolean;
  source: "admin_manual" | "self_service";
}

function trimEq(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim() === (b ?? "").trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildBankAccountUpdate(
  existing: ExistingAccount | null,
  input: BankInput,
  opts: BuildOpts,
): { row: Record<string, any>; bankChanged: boolean } {
  const existingMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
  const existingFullAccount =
    typeof existingMeta.full_account_number === "string" ? existingMeta.full_account_number : "";

  // fullAccount = input account number if non-empty, else existing metadata value.
  const inputAccount = (input.accountNumber ?? "").trim();
  const fullAccount = inputAccount !== "" ? inputAccount : existingFullAccount;

  // last4 from fullAccount, fallback to existing last4.
  const last4 = fullAccount ? fullAccount.slice(-4) : existing?.account_number_last4 ?? null;

  const routingNumber = (input.routingNumber ?? "").trim();

  // Address-field change detection (trim-compares). Only considered when an
  // address was supplied on this edit.
  let addressChanged = false;
  if (input.address) {
    const a = input.address;
    addressChanged =
      !trimEq(a.address1, existing?.address1) ||
      !trimEq(a.address2, existing?.address2) ||
      !trimEq(a.city, existing?.city) ||
      !trimEq(a.region, existing?.region) ||
      !trimEq(a.postalCode, existing?.postal_code);
  }

  const bankChanged =
    existing === null ||
    !trimEq(routingNumber, existing.routing_number) ||
    (!!fullAccount && fullAccount !== existingFullAccount) ||
    addressChanged;

  // Build metadata: preserve existing keys, stamp current bank values + source.
  const metadata: Record<string, unknown> = {
    ...existingMeta,
    full_account_number: fullAccount,
    routing_number: routingNumber,
    source: opts.source,
  };
  if (opts.source === "self_service") {
    metadata.pending_review = true;
    metadata.pending_reason = "Affiliate updated bank details — pending verification";
  } else {
    delete metadata.pending_review;
    delete metadata.pending_reason;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = {
    affiliate_id: input.affiliateId,
    provider: "mercury",
    account_name: input.accountHolderName,
    routing_number: routingNumber,
    account_number_last4: last4,
    is_verified: opts.markVerified,
    is_default: true,
    metadata,
    provider_id: bankChanged ? null : existing?.provider_id ?? null,
    updated_at: new Date().toISOString(),
  };

  if (input.address) {
    const a = input.address;
    row.address1 = a.address1;
    row.address2 = a.address2 ?? null;
    row.city = a.city;
    row.region = a.region;
    row.postal_code = a.postalCode;
    row.country = a.country ?? "US";
  }

  return { row, bankChanged };
}
