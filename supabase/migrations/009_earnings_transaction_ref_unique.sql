-- Enforce one earning per source transaction.
-- Background: 008 added an index on earnings.transaction_ref but no uniqueness, so
-- the SELECT-then-INSERT dedup in src/app/api/sync/transactions/route.ts is racy and
-- doesn't structurally prevent duplicates. Pre-fix syncs (before commit 6ae5ea0) also
-- created NULL-ref dupes. Those were cleaned up on 2026-04-28; this guard prevents
-- recurrence. Partial index allows NULL refs (legacy rows that may reappear from
-- restored backups) while blocking any duplicate non-null ref.
CREATE UNIQUE INDEX IF NOT EXISTS earnings_transaction_ref_unique
  ON earnings (transaction_ref)
  WHERE transaction_ref IS NOT NULL;
