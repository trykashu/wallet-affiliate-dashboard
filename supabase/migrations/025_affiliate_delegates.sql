-- 025_affiliate_delegates.sql
-- Delegate Access: let an affiliate invite teammates ("delegates") who log in
-- with their own auth.users account and see the OWNER's affiliate dashboard.
--
-- Resolution model (IMPORTANT): a delegate resolves to the owner's affiliate
-- via the SERVICE CLIENT in getAffiliateContext() — NOT via RLS.
-- get_my_affiliate_id() stays a strict 1:1 auth.uid() -> affiliates.id map, so
-- the central RLS chokepoint is untouched. Permissions are enforced
-- server-side (page/route gates + earnings/payout scrub).
--
-- Permission model: default delegate sees referrals + conversions only. Two
-- opt-in flags unlock earnings ($) and payouts (read-only). Money-movement
-- (request payout / edit bank) and delegate management are ALWAYS owner-only.

-- ============================================================
-- 1. TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS affiliate_delegates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id       UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,   -- the OWNER
  delegate_email     TEXT NOT NULL,
  delegate_name      TEXT NOT NULL,
  delegate_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,           -- backfilled on first login
  has_password       BOOLEAN NOT NULL DEFAULT false,                              -- for the proxy password gate
  can_view_earnings  BOOLEAN NOT NULL DEFAULT false,                              -- opt-in: Earnings page + $ figures
  can_view_payouts   BOOLEAN NOT NULL DEFAULT false,                              -- opt-in: Payouts page (read-only)
  invited_by         UUID REFERENCES affiliates(id) ON DELETE SET NULL,
  invited_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- v1 rule: one email = one affiliate (global). Normalized so casing/whitespace
-- variants can't create a duplicate delegate. App stores lower(trim(email)).
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_delegates_email_unique
  ON affiliate_delegates (lower(trim(delegate_email)));

CREATE INDEX IF NOT EXISTS idx_affiliate_delegates_affiliate_id
  ON affiliate_delegates (affiliate_id);

CREATE INDEX IF NOT EXISTS idx_affiliate_delegates_user_id
  ON affiliate_delegates (delegate_user_id) WHERE delegate_user_id IS NOT NULL;

-- ============================================================
-- 2. ACCEPT RPC — stamp delegate_user_id/accepted_at on first login
-- ============================================================
-- Mirrors link_affiliate_by_email (mig 023): exact lower(trim()) match with no
-- ilike wildcards, and only claims a row that is unclaimed or already this
-- user's (idempotent). SECURITY DEFINER; reads auth.uid()/auth.jwt() so it MUST
-- be called with the caller's own (anon) session, never the service client.
CREATE OR REPLACE FUNCTION public.accept_delegate_invite()
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email        TEXT := lower(trim(auth.jwt() ->> 'email'));
  v_affiliate_id UUID;
BEGIN
  IF v_email IS NULL OR v_email = '' THEN
    RETURN NULL;
  END IF;

  UPDATE public.affiliate_delegates d
  SET delegate_user_id = auth.uid(),
      accepted_at      = COALESCE(d.accepted_at, now()),
      updated_at       = now()
  WHERE lower(trim(d.delegate_email)) = v_email
    AND (d.delegate_user_id IS NULL OR d.delegate_user_id = auth.uid())
  RETURNING d.affiliate_id INTO v_affiliate_id;

  RETURN v_affiliate_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_delegate_invite() TO authenticated;

-- ============================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE affiliate_delegates ENABLE ROW LEVEL SECURITY;

-- Owner may read their own delegate rows via the anon client (defense in depth;
-- all writes go through the service client in the API routes). A delegate's
-- own anon session returns nothing here because get_my_affiliate_id() is NULL
-- for them — they reach the owner's data through the service-client context path.
CREATE POLICY "affiliate_delegates_select_own" ON affiliate_delegates
  FOR SELECT USING (affiliate_id = public.get_my_affiliate_id());
