/**
 * Mercury Banking API client for ACH payouts.
 *
 * Mercury API docs: https://docs.mercury.com/reference
 * Base URL: https://api.mercury.com/api/v1
 * Auth: Bearer token via MERCURY_API_TOKEN
 */

import { safeMercuryError } from "@/lib/safe-log";

const MERCURY_BASE_URL = "https://api.mercury.com/api/v1";

export interface MercuryTransferResponse {
  id: string;
  status: "pending" | "sent" | "cancelled" | "failed";
  amount: number;
  createdAt: string;
}

/**
 * Authenticated fetch wrapper for Mercury API calls.
 */
async function mercuryFetch(path: string, options: RequestInit = {}) {
  const token = process.env.MERCURY_API_TOKEN;
  if (!token) throw new Error("MERCURY_API_TOKEN not configured");

  const res = await fetch(`${MERCURY_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[mercury] API error ${res.status} on ${path}:`, body);
    throw new Error(`Mercury API ${res.status}: ${body.slice(0, 500)}`);
  }

  return res.json();
}

function getAccountId(): string {
  const accountId = process.env.MERCURY_ACCOUNT_ID;
  if (!accountId) throw new Error("MERCURY_ACCOUNT_ID not configured");
  return accountId;
}

/**
 * Create a Mercury recipient for ACH payout.
 * Mercury API: POST /api/v1/recipients
 * Docs: https://docs.mercury.com/reference/createrecipient
 * Returns the recipient ID.
 */
export interface RecipientAddress {
  address1: string;
  address2?: string | null;
  city: string;
  region: string;       // 2-letter state code (e.g. "WY")
  postalCode: string;
  country: string;      // 2-letter (e.g. "US")
}

/**
 * List existing Mercury recipients and find one matching (routing, accountNumber).
 * Used as a safety net in front of recipient creation so that duplicate
 * POSTs (e.g. after a DB-save failure, manual cache clear, or pre-existing
 * recipient that predates our cache) don't create duplicate recipients.
 *
 * Falls back to (routing, last4, name) match if Mercury masks the full
 * accountNumber in list responses.
 *
 * Returns the recipient ID if a match is found, else null.
 */
export async function findExistingRecipient(
  routingNumber: string,
  accountNumber: string,
  name: string,
): Promise<string | null> {
  try {
    const data = await mercuryFetch(`/recipients?limit=500`);
    interface RecipientRow {
      id: string;
      name?: string;
      electronicRoutingInfo?: {
        routingNumber?: string;
        accountNumber?: string;
      };
    }
    const recipients = (data?.recipients ?? []) as RecipientRow[];
    const last4 = accountNumber.slice(-4);
    for (const r of recipients) {
      const e = r.electronicRoutingInfo;
      if (!e || e.routingNumber !== routingNumber) continue;
      const acct = e.accountNumber ?? "";
      const acctLast4 = acct.slice(-4);
      if (acct && acct === accountNumber) {
        return r.id; // exact account-number match
      }
      if (acctLast4 === last4 && (r.name ?? "").trim().toLowerCase() === name.trim().toLowerCase()) {
        return r.id; // routing + last4 + name fallback
      }
    }
    return null;
  } catch (e) {
    // Lookup failure should NOT block creation — log and let caller fall
    // through to POST. Mercury would just have an unused list call.
    console.warn("[mercury] findExistingRecipient lookup failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function getOrCreateRecipient(
  name: string,
  routingNumber: string,
  accountNumber: string,
  address: RecipientAddress,
  email?: string
): Promise<string> {
  // Defensive lookup first — if Mercury already has a recipient with this
  // (routing, account) pair, reuse it instead of creating a duplicate.
  const existing = await findExistingRecipient(routingNumber, accountNumber, name);
  if (existing) {
    console.log("[mercury] Reusing existing recipient:", existing);
    return existing;
  }

  const payload = {
    name,
    emails: email ? [email] : ["payouts@kashupay.com"],
    electronicRoutingInfo: {
      accountNumber,
      routingNumber,
      electronicAccountType: "businessChecking",
      address: {
        address1: address.address1,
        address2: address.address2 ?? undefined,
        city: address.city,
        region: address.region,
        postalCode: address.postalCode,
        country: address.country || "US",
      },
    },
  };

  // Redact account number in logs — the previous version logged it in full.
  console.log("[mercury] Creating recipient:", JSON.stringify({
    ...payload,
    electronicRoutingInfo: { ...payload.electronicRoutingInfo, accountNumber: "<redacted>" },
  }));

  const data = await mercuryFetch(`/recipients`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  console.log("[mercury] Recipient created:", data.id);
  return data.id;
}

/**
 * Send an ACH transfer via Mercury.
 * Returns the Mercury transaction response.
 */
export async function sendACHTransfer(params: {
  recipientId: string;
  amount: number;
  idempotencyKey: string;
  note?: string;
  externalMemo?: string;
}): Promise<MercuryTransferResponse> {
  const accountId = getAccountId();

  const data = await mercuryFetch(`/account/${accountId}/transactions`, {
    method: "POST",
    body: JSON.stringify({
      recipientId: params.recipientId,
      amount: params.amount,
      paymentMethod: "ach",
      idempotencyKey: params.idempotencyKey,
      note: params.note || "Wallet Affiliate Commission Payout",
      externalMemo: params.externalMemo || "Kashu Wallet Affiliate Commission",
    }),
  });

  return {
    id: data.id,
    status: data.status,
    amount: data.amount,
    createdAt: data.createdAt,
  };
}

/**
 * Check the status of a Mercury transaction.
 */
export async function getTransactionStatus(
  transactionId: string
): Promise<MercuryTransferResponse> {
  const accountId = getAccountId();

  const data = await mercuryFetch(
    `/account/${accountId}/transactions/${transactionId}`
  );

  return {
    id: data.id,
    status: data.status,
    amount: data.amount,
    createdAt: data.createdAt,
  };
}
