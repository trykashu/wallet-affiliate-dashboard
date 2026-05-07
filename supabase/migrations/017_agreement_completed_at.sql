-- The actual moment a partner signed their affiliate agreement (from PandaDoc).
-- Distinct from `airtable_created_at` (when the contact record was added to
-- Airtable, often months earlier as part of a bulk contact import) and from
-- `created_at` (when our sync first synced the row).

ALTER TABLE affiliates
  ADD COLUMN agreement_completed_at TIMESTAMPTZ,
  ADD COLUMN pandadoc_id            TEXT;

CREATE INDEX idx_affiliates_pandadoc_id ON affiliates(pandadoc_id) WHERE pandadoc_id IS NOT NULL;
