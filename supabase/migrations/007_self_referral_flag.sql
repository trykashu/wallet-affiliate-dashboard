-- Flag for self-referral transactions (affiliate referred themselves)
-- These are displayed but marked as ineligible for payout.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS self_referral BOOLEAN NOT NULL DEFAULT false;

-- Mark existing self-referral transactions
UPDATE transactions t
SET self_referral = true
FROM affiliates a
WHERE t.affiliate_id = a.id
  AND t.email IS NOT NULL
  AND LOWER(t.email) = LOWER(a.email);
