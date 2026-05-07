-- The Airtable record's createdTime represents when the affiliate was first
-- added to the Affiliate Hub — i.e. their actual "signup date". The Supabase
-- row's created_at is when our sync first saw them, which conflates real
-- sign-ups with backfill batches. Track both so charts can bucket by the
-- semantically-correct timestamp.

ALTER TABLE affiliates
  ADD COLUMN airtable_created_at TIMESTAMPTZ;
