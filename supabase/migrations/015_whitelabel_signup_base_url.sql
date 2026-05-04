-- Per-partner signup landing URL. When set, the affiliate dashboard renders
-- referral links pointing here instead of the default Kashu signup page.
-- Format: scheme + host + optional path (no query string — the affiliate's
-- attribution_id is appended at render time).

ALTER TABLE whitelabel_brands
  ADD COLUMN signup_base_url TEXT
    CHECK (signup_base_url IS NULL OR signup_base_url ~ '^https?://[^?]+$');
