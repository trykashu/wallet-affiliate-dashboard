import { test } from "node:test";
import assert from "node:assert/strict";
import { buildResolverIndex, resolveReferredUser } from "./referred-user-match";

const alice = { id: "u-alice", affiliate_id: "a1", status_slug: "signed_up" as const,
                first_transaction_at: null, created_at: "2026-07-01T00:00:00Z" };

const idx = buildResolverIndex(
  [{ ...alice, email: "crm@alice.com", wallet_user_id: "CONTACT-1" }],
  [{ id: "recLL1", fields: { "Contact ID": "CONTACT-1" } }],
);

// The reason this exists: User Transactions.Email is an Airtable lookup of the
// LAUNCH LIST email, while referred_users.email is written from the GHL contact.
// When a user transacts under a different address those diverge, and an
// email-only join silently drops the transaction — and the commission with it.
test("resolves via Launch List Link when the email does not match", () => {
  const r = resolveReferredUser(["recLL1"], "softpoint@different.com", idx);
  assert.equal(r.user?.id, "u-alice");
  assert.equal(r.via, "wallet_id");
});

test("still resolves by email when there is no Launch List Link", () => {
  const r = resolveReferredUser(undefined, "CRM@Alice.com", idx);
  assert.equal(r.user?.id, "u-alice");
  assert.equal(r.via, "email");
});

test("Launch List Link wins over a conflicting email match", () => {
  const bob = { id: "u-bob", affiliate_id: "a2", status_slug: "signed_up" as const,
                first_transaction_at: null, created_at: "2026-07-01T00:00:00Z" };
  const idx2 = buildResolverIndex(
    [{ ...alice, email: "crm@alice.com", wallet_user_id: "CONTACT-1" },
     { ...bob,   email: "bob@example.com", wallet_user_id: "CONTACT-2" }],
    [{ id: "recLL1", fields: { "Contact ID": "CONTACT-1" } }],
  );
  const r = resolveReferredUser(["recLL1"], "bob@example.com", idx2);
  assert.equal(r.user?.id, "u-alice", "identity link must beat an email collision");
  assert.equal(r.via, "wallet_id");
});

test("returns null when neither key resolves", () => {
  const r = resolveReferredUser(["recUNKNOWN"], "nobody@example.com", idx);
  assert.equal(r.user, null);
  assert.equal(r.via, null);
});

test("tolerates a Launch List row with no Contact ID", () => {
  const idx3 = buildResolverIndex(
    [{ ...alice, email: "crm@alice.com", wallet_user_id: "CONTACT-1" }],
    [{ id: "recNoContact", fields: {} }],
  );
  const r = resolveReferredUser(["recNoContact"], "crm@alice.com", idx3);
  assert.equal(r.user?.id, "u-alice");
  assert.equal(r.via, "email", "falls back to email rather than throwing");
});
