/**
 * Safe logging utilities that scrub sensitive financial data.
 * Use safeError() instead of console.error() in all financial routes.
 */

// Patterns that might contain sensitive data
const ROUTING_NUMBER_PATTERN = /\b\d{9}\b/g;  // 9-digit routing numbers
const ACCOUNT_NUMBER_PATTERN = /\b\d{4,17}\b/g; // 4-17 digit account numbers
const SENSITIVE_KEYS = ["routing_number", "account_number", "routingNumber", "accountNumber"];

/**
 * Scrub a string of potential financial PII.
 * Replaces routing/account number patterns with redacted versions.
 */
function scrubString(str: string): string {
  // Only scrub strings that look like they might contain financial data
  // (contain digits in the right ranges)
  let result = str;

  // Redact anything that looks like a routing number (9 digits)
  result = result.replace(ROUTING_NUMBER_PATTERN, "[REDACTED-9D]");

  // Redact long digit sequences that could be account numbers
  // But only when near sensitive context words
  if (/account|routing|bank|ach/i.test(result)) {
    result = result.replace(ACCOUNT_NUMBER_PATTERN, "[REDACTED]");
  }

  return result;
}

/**
 * Scrub an object, redacting values of sensitive keys.
 */
function scrubObject(obj: unknown, depth = 0): unknown {
  if (depth > 5) return "[DEEP_OBJECT]";

  if (typeof obj === "string") return scrubString(obj);
  if (typeof obj !== "object" || obj === null) return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => scrubObject(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.includes(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = scrubObject(value, depth + 1);
    }
  }
  return result;
}

/**
 * Safe error logger for financial routes.
 * Scrubs potential PII before logging.
 *
 * Usage: safeError("[route-name]", "Description", errorObject);
 */
export function safeError(prefix: string, message: string, error?: unknown): void {
  const scrubbed = error instanceof Error
    ? { message: scrubString(error.message), name: error.name }
    : error !== undefined
      ? scrubObject(error)
      : undefined;

  if (scrubbed !== undefined) {
    console.error(prefix, message, scrubbed);
  } else {
    console.error(prefix, message);
  }
}

/**
 * Truncate a Mercury API error response for safe logging.
 * Only keeps status code and first 100 chars of body.
 */
export function safeMercuryError(status: number, body: string): string {
  const truncated = body.length > 100 ? body.substring(0, 100) + "..." : body;
  return `Mercury API ${status}: ${scrubString(truncated)}`;
}
