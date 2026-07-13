import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, checkInviteAllowed } from "./validate-invite";

test("normalizeEmail lowercases and trims", () => {
  assert.equal(normalizeEmail("  Foo@Bar.COM "), "foo@bar.com");
});

test("rejects inviting the owner's own email (self-invite)", () => {
  const r = checkInviteAllowed({
    email: "owner@x.com",
    ownerEmail: "Owner@X.com",
    emailIsAffiliate: false,
  });
  assert.equal(r.ok, false);
  assert.match(r.error!, /your own/i);
});

test("rejects an email that already belongs to an affiliate", () => {
  const r = checkInviteAllowed({
    email: "someone@x.com",
    ownerEmail: "owner@x.com",
    emailIsAffiliate: true,
  });
  assert.equal(r.ok, false);
  assert.match(r.error!, /affiliate account/i);
});

test("allows a fresh external email", () => {
  const r = checkInviteAllowed({
    email: "teammate@x.com",
    ownerEmail: "owner@x.com",
    emailIsAffiliate: false,
  });
  assert.equal(r.ok, true);
  assert.equal(r.error, undefined);
});
