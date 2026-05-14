// Shared bank-account quality checks used by both the admin UI badges and the
// audit script. Kept deliberately conservative — these are visual flags for AM
// re-verification, not a hard block on payouts.

export function looksLikeUsPhone(value: string, cleaned: string): boolean {
  const trimmed = value.trim();
  if (/^\+?1?\s*\(\d{3}\)\s*\d{3}[\s-]?\d{4}$/.test(trimmed)) return true;
  if (/^\+?1[\s-]\d{3}[\s-]\d{3}[\s-]\d{4}$/.test(trimmed)) return true;
  if (/^\d{3}[\s-]\d{3}[\s-]\d{4}$/.test(trimmed)) return true;
  if (/^\d{3}\.\d{3}\.\d{4}$/.test(trimmed)) return true;
  if (cleaned.length === 10) return true;
  if (cleaned.length === 11 && cleaned.startsWith("1")) return true;
  return false;
}

export function looksLikeWidgetLabel(value: string): boolean {
  const t = value.trim();
  return /^option\s*\d+$/i.test(t) || /^choice\s*\d+$/i.test(t);
}

/**
 * Returns the list of human-readable reasons a payout_account row may warrant
 * AM re-verification. Empty array means the account looks clean.
 */
export function getBankReviewReasons(account: {
  account_name: string | null;
  metadata: { full_account_number?: string } | null;
}): string[] {
  const reasons: string[] = [];
  const full = account.metadata?.full_account_number ?? "";
  const cleaned = full.replace(/[\s-]/g, "");
  if (full && looksLikeUsPhone(full, cleaned)) {
    reasons.push("Account number is bare 10 digits — may be a phone number, please re-verify");
  }
  if (account.account_name && looksLikeWidgetLabel(account.account_name)) {
    reasons.push(`Account name '${account.account_name}' looks like a form widget label`);
  }
  return reasons;
}
