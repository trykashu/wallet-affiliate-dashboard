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
    throw new Error(safeMercuryError(res.status, body));
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
 * Returns the recipient ID.
 */
export async function getOrCreateRecipient(
  name: string,
  routingNumber: string,
  accountNumber: string
): Promise<string> {
  const accountId = getAccountId();

  const data = await mercuryFetch(`/account/${accountId}/recipients`, {
    method: "POST",
    body: JSON.stringify({
      name,
      routingNumber,
      accountNumber,
      paymentMethod: "ach",
    }),
  });

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
