-- Admin-only enrichment fields synced from Airtable User Transactions.
-- These are visible only on /admin/transactions; affiliate-facing components
-- do not select them, so RLS policies remain unchanged.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS card_last4    TEXT,
  ADD COLUMN IF NOT EXISTS card_issuer   TEXT,
  ADD COLUMN IF NOT EXISTS funnel_percent NUMERIC(5,2);
