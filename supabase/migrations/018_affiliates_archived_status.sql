-- Allow affiliates.status = 'archived' for declined or removed affiliates.
-- Distinct from 'suspended' (manually paused; may return to active) — 'archived'
-- means the affiliate flow is terminal (declined the agreement, deleted, etc.)
-- and they should not appear in active counts on dashboards.

ALTER TABLE affiliates
  DROP CONSTRAINT IF EXISTS affiliates_status_check;

ALTER TABLE affiliates
  ADD CONSTRAINT affiliates_status_check
  CHECK (status IN ('active', 'suspended', 'pending', 'archived'));
