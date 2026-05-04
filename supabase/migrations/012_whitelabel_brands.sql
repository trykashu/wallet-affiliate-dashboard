-- Whitelabel brands let an affiliate render the dashboard with a partner's
-- logo and color palette instead of the default Kashu chrome.
-- Phase 1: one row per partner; one affiliate row per partner.
-- Phase 2 (future): multiple affiliate rows can share the same brand row,
-- supporting "additional referral codes attributed to their account".

CREATE TABLE whitelabel_brands (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,            -- url-safe identifier; matches public/whitelabel/<slug>/
  display_name    TEXT NOT NULL,
  logo_path       TEXT NOT NULL,                   -- e.g. /whitelabel/acme/logo-light.png
  sidebar_bg_hex  TEXT NOT NULL,                   -- replaces bg-brand-600 in sidebar
  sidebar_fg_hex  TEXT NOT NULL DEFAULT '#FFFFFF', -- replaces text-white in sidebar
  accent_hex      TEXT NOT NULL,                   -- replaces #00DE8F (text-accent / chart line)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT whitelabel_brands_slug_format CHECK (slug ~ '^[a-z0-9-]+$'),
  CONSTRAINT whitelabel_brands_sidebar_bg_format CHECK (sidebar_bg_hex ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT whitelabel_brands_sidebar_fg_format CHECK (sidebar_fg_hex ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT whitelabel_brands_accent_format    CHECK (accent_hex   ~ '^#[0-9A-Fa-f]{6}$')
);

-- The brand row is read alongside the affiliate; service role reads in the
-- dashboard layout, so we don't expose RLS to the anon role.
ALTER TABLE whitelabel_brands ENABLE ROW LEVEL SECURITY;
-- No policies = no access from anon. Service-role and admin paths only.

ALTER TABLE affiliates
  ADD COLUMN whitelabel_brand_id UUID REFERENCES whitelabel_brands(id) ON DELETE SET NULL;

CREATE INDEX idx_affiliates_whitelabel_brand_id ON affiliates(whitelabel_brand_id);
