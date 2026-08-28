/**
 * Resolving an Airtable "User Transactions" row to a referred_user.
 *
 * Why this is not just an email lookup:
 *   `User Transactions.Email` is an Airtable LOOKUP of the Launch List email,
 *   whereas `referred_users.email` is written from the HighLevel contact by
 *   /api/sync/highlevel. A user who signs up in the CRM under one address and
 *   transacts in Softpoint under another makes those two diverge — legitimately
 *   and routinely. An email-only join silently drops those transactions, and
 *   with them every commission owed on them.
 *
 * `Contact ID` is the stable identity: it is the HighLevel contact id, stamped
 * on the Launch List row and mirrored to referred_users.wallet_user_id. Prefer
 * it, and keep email only as a fallback for rows with no Launch List Link.
 */
import type { FunnelStatusSlug } from "@/types/database";

export interface ReferredUserRef {
  id: string;
  affiliate_id: string;
  status_slug: FunnelStatusSlug;
  first_transaction_at: string | null;
  created_at: string;
}

interface ReferredUserRow extends ReferredUserRef {
  email: string | null;
  wallet_user_id: string | null;
}

interface LaunchListRow {
  id: string;
  fields: Record<string, unknown>;
}

export interface ResolverIndex {
  byWalletId: Map<string, ReferredUserRef>;
  byEmail: Map<string, ReferredUserRef>;
  contactIdByLaunchRecordId: Map<string, string>;
}

const ref = (u: ReferredUserRow): ReferredUserRef => ({
  id: u.id,
  affiliate_id: u.affiliate_id,
  status_slug: u.status_slug,
  first_transaction_at: u.first_transaction_at,
  created_at: u.created_at,
});

export function buildResolverIndex(
  referredUsers: ReferredUserRow[],
  launchList: LaunchListRow[],
): ResolverIndex {
  const byWalletId = new Map<string, ReferredUserRef>();
  const byEmail = new Map<string, ReferredUserRef>();
  for (const u of referredUsers) {
    if (u.wallet_user_id) byWalletId.set(u.wallet_user_id, ref(u));
    if (u.email) byEmail.set(u.email.toLowerCase(), ref(u));
  }
  const contactIdByLaunchRecordId = new Map<string, string>();
  for (const r of launchList) {
    const cid = r.fields["Contact ID"];
    if (typeof cid === "string" && cid.trim()) {
      contactIdByLaunchRecordId.set(r.id, cid.trim());
    }
  }
  return { byWalletId, byEmail, contactIdByLaunchRecordId };
}

/**
 * Resolve a transaction to its referred_user.
 * `via` reports which key matched, so the sync can report how many rows still
 * depend on the fragile email path.
 */
export function resolveReferredUser(
  launchListLink: string[] | undefined,
  email: string | null,
  idx: ResolverIndex,
): { user: ReferredUserRef | null; via: "wallet_id" | "email" | null } {
  const linkId = launchListLink?.[0];
  if (linkId) {
    const contactId = idx.contactIdByLaunchRecordId.get(linkId);
    if (contactId) {
      const u = idx.byWalletId.get(contactId);
      if (u) return { user: u, via: "wallet_id" };
    }
  }
  if (email) {
    const u = idx.byEmail.get(email.toLowerCase());
    if (u) return { user: u, via: "email" };
  }
  return { user: null, via: null };
}
