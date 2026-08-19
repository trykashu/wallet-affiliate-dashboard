-- 026_master_tier_sub_affiliates.sql
-- Master Tier - T3: a partner whose referral traffic is subdivided by
-- sub-affiliate IDs stamped on GHL opportunities. Subs are NOT affiliate
-- rows — just opaque IDs on referred_users — so the master is a completely
-- normal affiliate and no RLS changes are needed (all sub data is already
-- the master's own rows). get_my_affiliate_id() is untouched (mig 025 rule).
-- Masters earn 20% of Kashu's fee on everything; subs are paid outside
-- this system.

-- 1. Widen tier CHECKs to include 'master'
ALTER TABLE affiliates
  DROP CONSTRAINT IF EXISTS affiliates_tier_check;
ALTER TABLE affiliates
  ADD CONSTRAINT affiliates_tier_check
  CHECK (tier IN ('gold', 'platinum', 'custom', 'master'));

ALTER TABLE earnings
  DROP CONSTRAINT IF EXISTS earnings_tier_at_earning_check;
ALTER TABLE earnings
  ADD CONSTRAINT earnings_tier_at_earning_check
  CHECK (tier_at_earning IN ('gold', 'platinum', 'custom', 'master'));

-- 2. Sub-affiliate attribution on referred users (synced from Launch List
--    "Sub Aff ID"; NULL = direct referral)
ALTER TABLE referred_users
  ADD COLUMN IF NOT EXISTS sub_affiliate_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_referred_users_sub_affiliate
  ON referred_users (affiliate_id, sub_affiliate_id)
  WHERE sub_affiliate_id IS NOT NULL;

-- 3. Friendly labels a master assigns to their sub IDs
CREATE TABLE IF NOT EXISTS sub_affiliate_labels (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id     UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  sub_affiliate_id TEXT NOT NULL,
  label            TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (affiliate_id, sub_affiliate_id)
);

ALTER TABLE sub_affiliate_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sub_affiliate_labels_select_own" ON sub_affiliate_labels
  FOR SELECT USING (affiliate_id = public.get_my_affiliate_id());
CREATE POLICY "sub_affiliate_labels_insert_own" ON sub_affiliate_labels
  FOR INSERT WITH CHECK (affiliate_id = public.get_my_affiliate_id());
CREATE POLICY "sub_affiliate_labels_update_own" ON sub_affiliate_labels
  FOR UPDATE USING (affiliate_id = public.get_my_affiliate_id());
CREATE POLICY "sub_affiliate_labels_delete_own" ON sub_affiliate_labels
  FOR DELETE USING (affiliate_id = public.get_my_affiliate_id());
