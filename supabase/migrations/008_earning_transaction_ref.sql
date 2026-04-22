-- Add transaction reference to earnings for proper dedup
-- Without this, multiple transactions with the same fee amount get deduped incorrectly
ALTER TABLE earnings
  ADD COLUMN IF NOT EXISTS transaction_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_earnings_transaction_ref ON earnings(transaction_ref);
