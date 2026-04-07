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
