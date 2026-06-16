import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBankAccountUpdate, type ExistingAccount } from "./bank-account-update";

const existing: ExistingAccount = {
  routing_number: "021000021",
  account_number_last4: "6789",
  metadata: { full_account_number: "0123456789", routing_number: "021000021", source: "pdf_upload" },
  address1: "1 A St", address2: null, city: "Reno", region: "NV", postal_code: "89501", country: "US",
  provider_id: "rec_OLD",
};
const baseInput = {
  affiliateId: "aff_1",
  accountHolderName: "Jane Doe",
  routingNumber: "021000021",
  accountNumber: "0123456789",
  address: { address1: "1 A St", address2: null, city: "Reno", region: "NV", postalCode: "89501", country: "US" },
};

test("account number changed -> bankChanged true, provider_id cleared", () => {
  const { row, bankChanged } = buildBankAccountUpdate(existing, { ...baseInput, accountNumber: "9999999999" }, { markVerified: true, source: "admin_manual" });
  assert.equal(bankChanged, true);
  assert.equal(row.provider_id, null);
  assert.equal(row.account_number_last4, "9999");
  assert.equal((row.metadata as { full_account_number: string }).full_account_number, "9999999999");
  assert.equal(row.is_verified, true);
  assert.equal(row.is_default, true);
});

test("routing changed -> bankChanged true, provider_id cleared", () => {
  const { row, bankChanged } = buildBankAccountUpdate(existing, { ...baseInput, routingNumber: "031000031" }, { markVerified: true, source: "admin_manual" });
  assert.equal(bankChanged, true);
  assert.equal(row.provider_id, null);
});

test("nothing changed -> bankChanged false, provider_id preserved", () => {
  const { row, bankChanged } = buildBankAccountUpdate(existing, baseInput, { markVerified: true, source: "admin_manual" });
  assert.equal(bankChanged, false);
  assert.equal(row.provider_id, "rec_OLD");
});

test("blank account number keeps existing account, not bankChanged on that field", () => {
  const { row, bankChanged } = buildBankAccountUpdate(existing, { ...baseInput, accountNumber: "" }, { markVerified: true, source: "admin_manual" });
  assert.equal((row.metadata as { full_account_number: string }).full_account_number, "0123456789");
  assert.equal(row.account_number_last4, "6789");
  assert.equal(bankChanged, false);
  assert.equal(row.provider_id, "rec_OLD");
});

test("address changed -> bankChanged true, provider_id cleared", () => {
  const { row, bankChanged } = buildBankAccountUpdate(existing, { ...baseInput, address: { ...baseInput.address, city: "Vegas" } }, { markVerified: true, source: "admin_manual" });
  assert.equal(bankChanged, true);
  assert.equal(row.provider_id, null);
});

test("affiliate self-edit -> is_verified false + pending_review metadata", () => {
  const { row } = buildBankAccountUpdate(existing, baseInput, { markVerified: false, source: "self_service" });
  assert.equal(row.is_verified, false);
  assert.equal((row.metadata as { pending_review?: boolean }).pending_review, true);
});

test("new account (no existing) -> insert shape, bankChanged true, provider_id null", () => {
  const { row, bankChanged } = buildBankAccountUpdate(null, baseInput, { markVerified: false, source: "self_service" });
  assert.equal(bankChanged, true);
  assert.equal(row.provider_id, null);
  assert.equal(row.provider, "mercury");
});
