/**
 * Bank account validation — ABA routing number checksum + account number format.
 */

export interface BankValidationResult {
  valid: boolean;
  error?: string;
}

/** Valid Federal Reserve routing number prefixes (first two digits). */
const VALID_PREFIXES = new Set([
  ...Array.from({ length: 12 }, (_, i) => i + 1),   // 01–12
  ...Array.from({ length: 12 }, (_, i) => i + 21),  // 21–32
  ...Array.from({ length: 12 }, (_, i) => i + 61),  // 61–72
  80,
]);

/**
 * Validate a US ABA routing number.
 *
 * Rules:
 * 1. Exactly 9 digits
 * 2. First two digits are a valid Federal Reserve district prefix
 * 3. Passes the ABA checksum: Σ(digit[i] × weight[i]) mod 10 === 0
 *    where weights = [3, 7, 1, 3, 7, 1, 3, 7, 1]
 */
export function validateRoutingNumber(routing: string): BankValidationResult {
  const cleaned = routing.replace(/\s/g, "");

  if (!/^\d{9}$/.test(cleaned)) {
    return { valid: false, error: "Routing number must be exactly 9 digits" };
  }

  const prefix = parseInt(cleaned.slice(0, 2), 10);
  if (!VALID_PREFIXES.has(prefix)) {
    return { valid: false, error: "Invalid routing number prefix" };
  }

  const digits = cleaned.split("").map(Number);
  const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
  if (sum % 10 !== 0) {
    return { valid: false, error: "Routing number failed checksum validation" };
  }

  return { valid: true };
}

/**
 * Validate a US bank account number.
 *
 * Rules:
 * 1. 4–17 digits after stripping spaces and dashes
 * 2. No letters or special characters
 */
export function validateAccountNumber(account: string): BankValidationResult {
  const cleaned = account.replace(/[\s\-]/g, "");

  if (!/^\d{4,17}$/.test(cleaned)) {
    return { valid: false, error: "Account number must be 4–17 digits" };
  }

  return { valid: true };
}

/** Strip whitespace from a routing number. */
export function cleanRoutingNumber(routing: string): string {
  return routing.replace(/\s/g, "");
}

/** Strip whitespace and dashes from an account number. */
export function cleanAccountNumber(account: string): string {
  return account.replace(/[\s\-]/g, "");
}
