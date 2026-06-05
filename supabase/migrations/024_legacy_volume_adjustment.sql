-- 024_legacy_volume_adjustment.sql
-- Adds a manual "legacy volume" adjustment to affiliates.
--
-- referred_volume_total is RECOMPUTED on every transaction sync as the sum of
-- the affiliate's "Transfer In" transactions (see /api/sync/transactions),
-- so any value written directly to that column is silently wiped the next
-- time a sync touches the affiliate. legacy_volume_adjustment is a durable
-- field the sync ADDS on top of the computed transaction volume, so volume
-- carried over from the legacy business (not tied to a tracked referral)
-- persists forever and counts toward the Platinum threshold.

ALTER TABLE public.affiliates
  ADD COLUMN IF NOT EXISTS legacy_volume_adjustment NUMERIC(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.affiliates.legacy_volume_adjustment IS
  'Manual volume credit (e.g. legacy-business referrals not tied to a tracked transaction). Added to the synced Transfer-In total to form referred_volume_total. Set via admin, never by sync.';
