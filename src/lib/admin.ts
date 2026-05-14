/**
 * Admin access check — server-side only.
 * Admin emails are defined in the ADMIN_EMAILS environment variable.
 * Comma-separated list: "miles@example.com,other@example.com"
 */
export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}

/** Check if user is staff (aliases isAdminEmail) */
export function isStaffEmail(email: string | undefined | null): boolean {
  return isAdminEmail(email);
}

/**
 * Finance role check — server-side only.
 * Finance emails are defined in the FINANCE_EMAILS environment variable.
 * Comma-separated list: "grey@kashupay.com,miles@kashupay.com"
 *
 * Convention: every email in FINANCE_EMAILS MUST also be in ADMIN_EMAILS.
 * isFinanceEmail does NOT call isAdminEmail internally; routes that need
 * both gates should call them in sequence. Page-level admin gate runs
 * first; route handlers re-check both as defense in depth.
 */
export function isFinanceEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const finance = (process.env.FINANCE_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return finance.includes(email.toLowerCase());
}
