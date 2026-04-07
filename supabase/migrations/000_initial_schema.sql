-- 000_initial_schema.sql
-- Initial Supabase migration: tables, seed data, RPC functions, auth trigger, RLS policies, indexes

-- ============================================================
-- 1. TABLES (ordered by FK dependencies)
-- ============================================================

-- 1. affiliates
CREATE TABLE affiliates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_name TEXT NOT NULL,
  business_name TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  tier TEXT NOT NULL DEFAULT 'gold' CHECK (tier IN ('gold', 'platinum')),
  tier_override BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('active', 'suspended', 'pending')),
  referred_volume_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  attribution_id TEXT NOT NULL UNIQUE,
  has_password BOOLEAN NOT NULL DEFAULT false,
  agreement_status TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. funnel_statuses (+ seed data)
CREATE TABLE funnel_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

INSERT INTO funnel_statuses (slug, label, color, sort_order) VALUES
  ('signed_up',       'Signed Up',        '#BBF7D0', 1),
  ('transaction_run', 'Transaction Run',  '#4ADE80', 2),
  ('funds_in_wallet', 'Funds in Wallet',  '#22C55E', 3),
  ('ach_initiated',   'ACH Initiated',    '#16A34A', 4),
  ('funds_in_bank',   'Funds in Bank',    '#00DE8F', 5);

-- 3. referred_users
CREATE TABLE referred_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID REFERENCES affiliates(id) ON DELETE SET NULL,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  status_slug TEXT NOT NULL DEFAULT 'signed_up' REFERENCES funnel_statuses(slug),
  first_transaction_amount NUMERIC(14,2),
  first_transaction_fee NUMERIC(14,2),
  first_transaction_at TIMESTAMPTZ,
  wallet_user_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. funnel_events
CREATE TABLE funnel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referred_user_id UUID NOT NULL REFERENCES referred_users(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. earnings
CREATE TABLE earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  referred_user_id UUID NOT NULL REFERENCES referred_users(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL,
  transaction_fee_amount NUMERIC(14,2) NOT NULL,
  tier_at_earning TEXT NOT NULL CHECK (tier_at_earning IN ('gold', 'platinum')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'reversed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. leaderboard_snapshots
CREATE TABLE leaderboard_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period TEXT NOT NULL,
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  referred_user_count INTEGER NOT NULL DEFAULT 0,
  referred_volume NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_earnings NUMERIC(14,2) NOT NULL DEFAULT 0,
  conversion_rate NUMERIC(5,4) NOT NULL DEFAULT 0,
  percentile NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period, affiliate_id)
);

-- 8. payout_accounts (must precede payouts for FK)
CREATE TABLE payout_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('stripe_connect', 'manual', 'mercury')),
  provider_id TEXT,
  account_name TEXT,
  routing_number TEXT,
  account_number_last4 TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. payouts
CREATE TABLE payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  payout_account_id UUID REFERENCES payout_accounts(id),
  amount NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'processing', 'completed', 'failed')),
  provider_reference_id TEXT,
  period TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. payout_settings (singleton + seed)
CREATE TABLE payout_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  min_payout_amount NUMERIC(14,2) NOT NULL DEFAULT 50.00,
  default_provider TEXT NOT NULL DEFAULT 'mercury',
  auto_approve_earnings BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO payout_settings (min_payout_amount, default_provider, auto_approve_earnings)
VALUES (50.00, 'mercury', false);

-- 11. admins
CREATE TABLE admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'admin',
  has_password BOOLEAN NOT NULL DEFAULT false,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 12. security_audit_log
CREATE TABLE security_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  user_email TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 13. webhook_events
CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- ============================================================
-- 2. RPC FUNCTIONS
-- ============================================================

-- Helper: get current user's affiliate id
CREATE OR REPLACE FUNCTION public.get_my_affiliate_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.affiliates WHERE user_id = auth.uid() LIMIT 1;
$$;

-- Atomic payout request with advisory lock
CREATE OR REPLACE FUNCTION public.request_payout(
  p_affiliate_id UUID,
  p_account_id UUID,
  p_amount NUMERIC,
  p_currency TEXT DEFAULT 'USD'
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC;
  v_payout_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_affiliate_id::text));

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
  FROM earnings
  WHERE affiliate_id = p_affiliate_id AND status = 'approved';

  SELECT v_balance - COALESCE(SUM(amount), 0) INTO v_balance
  FROM payouts
  WHERE affiliate_id = p_affiliate_id AND status IN ('requested', 'processing', 'completed');

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  INSERT INTO payouts (affiliate_id, payout_account_id, amount, currency, status)
  VALUES (p_affiliate_id, p_account_id, p_amount, p_currency, 'requested')
  RETURNING id INTO v_payout_id;

  RETURN v_payout_id;
END;
$$;

-- ============================================================
-- 3. AUTH TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION public.link_affiliate_on_signup()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.affiliates
  SET user_id = NEW.id, updated_at = now()
  WHERE email = NEW.email AND user_id IS NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.link_affiliate_on_signup();

-- ============================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE affiliates ENABLE ROW LEVEL SECURITY;
ALTER TABLE referred_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_settings ENABLE ROW LEVEL SECURITY;

-- affiliates: SELECT own row
CREATE POLICY "affiliates_select_own" ON affiliates
  FOR SELECT USING (user_id = auth.uid());

-- referred_users: SELECT own affiliate's referred users
CREATE POLICY "referred_users_select_own" ON referred_users
  FOR SELECT USING (affiliate_id = public.get_my_affiliate_id());

-- funnel_events: SELECT events for own referred users
CREATE POLICY "funnel_events_select_own" ON funnel_events
  FOR SELECT USING (
    referred_user_id IN (
      SELECT id FROM public.referred_users WHERE affiliate_id = public.get_my_affiliate_id()
    )
  );

-- earnings: SELECT own
CREATE POLICY "earnings_select_own" ON earnings
  FOR SELECT USING (affiliate_id = public.get_my_affiliate_id());

-- notifications: SELECT own
CREATE POLICY "notifications_select_own" ON notifications
  FOR SELECT USING (affiliate_id = public.get_my_affiliate_id());

-- notifications: UPDATE own (mark as read)
CREATE POLICY "notifications_update_own" ON notifications
  FOR UPDATE USING (affiliate_id = public.get_my_affiliate_id());

-- leaderboard_snapshots: SELECT all (authenticated)
CREATE POLICY "leaderboard_select_authenticated" ON leaderboard_snapshots
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- payouts: SELECT own
CREATE POLICY "payouts_select_own" ON payouts
  FOR SELECT USING (affiliate_id = public.get_my_affiliate_id());

-- payout_accounts: SELECT own
CREATE POLICY "payout_accounts_select_own" ON payout_accounts
  FOR SELECT USING (affiliate_id = public.get_my_affiliate_id());

-- payout_accounts: INSERT own
CREATE POLICY "payout_accounts_insert_own" ON payout_accounts
  FOR INSERT WITH CHECK (affiliate_id = public.get_my_affiliate_id());

-- payout_accounts: UPDATE own
CREATE POLICY "payout_accounts_update_own" ON payout_accounts
  FOR UPDATE USING (affiliate_id = public.get_my_affiliate_id());

-- funnel_statuses: SELECT all (public reference data)
CREATE POLICY "funnel_statuses_select_all" ON funnel_statuses
  FOR SELECT USING (true);

-- payout_settings: SELECT all (authenticated)
CREATE POLICY "payout_settings_select_authenticated" ON payout_settings
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ============================================================
-- 5. INDEXES
-- ============================================================

CREATE INDEX idx_referred_users_affiliate_id ON referred_users(affiliate_id);
CREATE INDEX idx_referred_users_status_slug ON referred_users(status_slug);
CREATE INDEX idx_referred_users_wallet_user_id ON referred_users(wallet_user_id);
CREATE INDEX idx_earnings_affiliate_id ON earnings(affiliate_id);
CREATE INDEX idx_earnings_status ON earnings(status);
CREATE INDEX idx_funnel_events_referred_user_id ON funnel_events(referred_user_id);
CREATE INDEX idx_notifications_affiliate_id ON notifications(affiliate_id);
CREATE INDEX idx_leaderboard_snapshots_period ON leaderboard_snapshots(period);
CREATE INDEX idx_payouts_affiliate_id ON payouts(affiliate_id);
CREATE INDEX idx_webhook_events_idempotency_key ON webhook_events(idempotency_key);
