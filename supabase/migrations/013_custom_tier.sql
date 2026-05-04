-- Add 'custom' as a valid affiliate tier. Used for partners with
-- bespoke commission terms handled outside the standard gold/platinum math
-- (e.g. whitelabel partners). Custom-tier affiliates earn 0 from the
-- automatic earnings path; their compensation is configured manually.

ALTER TABLE affiliates
  DROP CONSTRAINT IF EXISTS affiliates_tier_check;
ALTER TABLE affiliates
  ADD CONSTRAINT affiliates_tier_check
  CHECK (tier IN ('gold', 'platinum', 'custom'));

ALTER TABLE earnings
  DROP CONSTRAINT IF EXISTS earnings_tier_at_earning_check;
ALTER TABLE earnings
  ADD CONSTRAINT earnings_tier_at_earning_check
  CHECK (tier_at_earning IN ('gold', 'platinum', 'custom'));
