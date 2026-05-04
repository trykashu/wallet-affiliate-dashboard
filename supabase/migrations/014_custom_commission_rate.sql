-- Per-affiliate custom commission rates for tier='custom' affiliates.
-- Each custom partner negotiates their own rate, on either basis:
--   'tpv'        — percentage of total processed volume
--   'kashu_fee'  — percentage of Kashu's fee (same basis as gold/platinum)
-- Both columns are nullable; only meaningful when tier='custom'. For other
-- tiers they are ignored and the existing TIER_RATES table-driven math applies.

ALTER TABLE affiliates
  ADD COLUMN custom_commission_rate  NUMERIC(6,4),
  ADD COLUMN custom_commission_basis TEXT
    CHECK (custom_commission_basis IS NULL OR custom_commission_basis IN ('tpv', 'kashu_fee'));

-- Snapshot the rate + basis on each earning row when it's created.
-- For gold/platinum, these stay null and the tier-table rates apply on display.
ALTER TABLE earnings
  ADD COLUMN custom_commission_rate  NUMERIC(6,4),
  ADD COLUMN custom_commission_basis TEXT
    CHECK (custom_commission_basis IS NULL OR custom_commission_basis IN ('tpv', 'kashu_fee'));
