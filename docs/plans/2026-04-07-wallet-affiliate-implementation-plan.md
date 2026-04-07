# Wallet Affiliate Dashboard — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fork the MRP Dashboard into a standalone Kashu Wallet Affiliate Dashboard where affiliates refer users for credit conversion and earn one-time commissions (Gold 5% / Platinum 10%) on first-transaction fees.

**Architecture:** Next.js 15 App Router + Supabase (auth, DB, RLS) + Tailwind CSS + TypeScript. Webhook-driven data from the wallet platform. Full admin panel. Payouts via Stripe Connect + Mercury ACH + manual bank entry.

**Tech Stack:** Next.js 16, React 18, Supabase SSR, Tailwind CSS 3.4, TypeScript 5, Stripe, Zod, QR Code generation

**Source reference:** `/Users/milespietsch/Desktop/Claude/Workspace/mrp-dashboard` (READ ONLY — never modify)
**New project:** `/Users/milespietsch/Desktop/Claude/Workspace/wallet-affiliate-dashboard`

---

## Phase 1: Project Scaffolding & Core Infrastructure

### Task 1: Initialize Next.js Project

**Files:**
- Create: `package.json`, `tsconfig.json`, `tailwind.config.ts`, `next.config.mjs`, `postcss.config.mjs`, `.gitignore`

**Step 1: Create Next.js app**

```bash
cd /Users/milespietsch/Desktop/Claude/Workspace/wallet-affiliate-dashboard
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack
```

**Step 2: Install dependencies**

```bash
npm install @supabase/supabase-js@2.45.0 @supabase/ssr@0.5.1 stripe@20.3.1 zod@3.23.8 qrcode@1.5.4
npm install -D @types/qrcode
```

**Step 3: Copy and adapt `tailwind.config.ts` from MRP**

Copy the full Tailwind config from `mrp-dashboard/tailwind.config.ts`. Keep all brand colors, custom fonts, shadows, animations. Change metadata references only (no code changes needed — same Kashu brand).

**Step 4: Copy `next.config.mjs` from MRP**

Copy security headers (CSP, HSTS, X-Frame-Options, etc.). Remove Intercom-specific CSP domains if not using Intercom in v1.

**Step 5: Copy `src/app/globals.css` from MRP**

Copy the full CSS file — all card, button, badge, nav, input utilities. Same design system.

**Step 6: Commit**

```bash
git init
git add .
git commit -m "feat: scaffold Next.js project with Kashu design system"
```

---

### Task 2: Type Definitions

**Files:**
- Create: `src/types/database.ts`

**Step 1: Write the new type definitions**

```typescript
// --- Enums ---
export type FunnelStatusSlug =
  | 'signed_up'
  | 'transaction_run'
  | 'funds_in_wallet'
  | 'ach_initiated'
  | 'funds_in_bank';

export type AffiliateStatus = 'active' | 'suspended' | 'pending';
export type AffiliateTier = 'gold' | 'platinum';
export type EarningStatus = 'pending' | 'approved' | 'paid' | 'reversed';
export type PayoutProvider = 'stripe_connect' | 'manual' | 'mercury';
export type PayoutAccountStatus = 'pending' | 'active' | 'disconnected';
export type PayoutStatus = 'requested' | 'processing' | 'completed' | 'failed';
export type NotificationType =
  | 'funnel_change'
  | 'earning_credited'
  | 'tier_upgrade'
  | 'payout_processed'
  | 'system_announcement';

// --- Interfaces ---
export interface Affiliate {
  id: string;
  user_id: string | null;
  agent_name: string;
  business_name: string | null;
  email: string;
  phone: string | null;
  tier: AffiliateTier;
  tier_override: boolean;
  status: AffiliateStatus;
  referred_volume_total: number;
  attribution_id: string;
  has_password: boolean;
  agreement_status: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReferredUser {
  id: string;
  affiliate_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status_slug: FunnelStatusSlug;
  first_transaction_amount: number | null;
  first_transaction_fee: number | null;
  first_transaction_at: string | null;
  wallet_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FunnelStatus {
  id: string;
  slug: FunnelStatusSlug;
  label: string;
  color: string;
  sort_order: number;
}

export interface FunnelEvent {
  id: string;
  referred_user_id: string;
  from_status: FunnelStatusSlug | null;
  to_status: FunnelStatusSlug;
  created_at: string;
}

export interface Earning {
  id: string;
  affiliate_id: string;
  referred_user_id: string;
  amount: number;
  transaction_fee_amount: number;
  tier_at_earning: AffiliateTier;
  status: EarningStatus;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  affiliate_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  is_read: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface LeaderboardSnapshot {
  id: string;
  period: string;
  affiliate_id: string;
  rank: number;
  referred_user_count: number;
  referred_volume: number;
  total_earnings: number;
  conversion_rate: number;
  percentile: number;
  created_at: string;
}

export interface Payout {
  id: string;
  affiliate_id: string;
  payout_account_id: string | null;
  amount: number;
  currency: string;
  status: PayoutStatus;
  provider_reference_id: string | null;
  period: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayoutAccount {
  id: string;
  affiliate_id: string;
  provider: PayoutProvider;
  provider_id: string | null;
  account_name: string | null;
  routing_number: string | null;
  account_number_last4: string | null;
  is_default: boolean;
  is_verified: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface PayoutSettings {
  id: string;
  min_payout_amount: number;
  default_provider: PayoutProvider;
  auto_approve_earnings: boolean;
  created_at: string;
  updated_at: string;
}

export interface Admin {
  id: string;
  user_id: string;
  email: string;
  role: string;
  created_at: string;
}

export interface SecurityAuditLog {
  id: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface WebhookEvent {
  id: string;
  idempotency_key: string;
  event_type: string;
  payload: Record<string, unknown>;
  processed: boolean;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
}

// --- Database typing for Supabase client ---
export interface Database {
  public: {
    Tables: {
      affiliates: { Row: Affiliate; Insert: Partial<Affiliate>; Update: Partial<Affiliate> };
      referred_users: { Row: ReferredUser; Insert: Partial<ReferredUser>; Update: Partial<ReferredUser> };
      funnel_statuses: { Row: FunnelStatus; Insert: Partial<FunnelStatus>; Update: Partial<FunnelStatus> };
      funnel_events: { Row: FunnelEvent; Insert: Partial<FunnelEvent>; Update: Partial<FunnelEvent> };
      earnings: { Row: Earning; Insert: Partial<Earning>; Update: Partial<Earning> };
      notifications: { Row: Notification; Insert: Partial<Notification>; Update: Partial<Notification> };
      leaderboard_snapshots: { Row: LeaderboardSnapshot; Insert: Partial<LeaderboardSnapshot>; Update: Partial<LeaderboardSnapshot> };
      payouts: { Row: Payout; Insert: Partial<Payout>; Update: Partial<Payout> };
      payout_accounts: { Row: PayoutAccount; Insert: Partial<PayoutAccount>; Update: Partial<PayoutAccount> };
      payout_settings: { Row: PayoutSettings; Insert: Partial<PayoutSettings>; Update: Partial<PayoutSettings> };
      admins: { Row: Admin; Insert: Partial<Admin>; Update: Partial<Admin> };
      security_audit_log: { Row: SecurityAuditLog; Insert: Partial<SecurityAuditLog>; Update: Partial<SecurityAuditLog> };
      webhook_events: { Row: WebhookEvent; Insert: Partial<WebhookEvent>; Update: Partial<WebhookEvent> };
    };
    Functions: {
      get_my_affiliate_id: { Args: Record<string, never>; Returns: string };
      request_payout: {
        Args: { p_affiliate_id: string; p_account_id: string; p_amount: number; p_currency: string };
        Returns: string;
      };
    };
  };
}
```

**Step 2: Commit**

```bash
git add src/types/database.ts
git commit -m "feat: add wallet affiliate type definitions"
```

---

### Task 3: Supabase Clients & Core Libs

**Files:**
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/service.ts`
- Create: `src/lib/admin.ts`
- Create: `src/lib/fmt.ts`
- Create: `src/lib/audit-log.ts`
- Create: `src/lib/safe-log.ts`
- Create: `src/lib/tier.ts`
- Create: `src/lib/affiliate-context.ts`
- Create: `src/lib/funnel-colors.ts`
- Create: `src/lib/milestones.ts`
- Create: `src/lib/mercury.ts`

**Step 1: Copy unchanged files from MRP**

These files can be copied verbatim (only import path changes):
- `src/lib/supabase/server.ts` — copy from MRP, change `Database` import
- `src/lib/supabase/service.ts` — copy from MRP, change `Database` import
- `src/lib/fmt.ts` — copy verbatim (no changes needed)
- `src/lib/audit-log.ts` — copy verbatim
- `src/lib/safe-log.ts` — copy verbatim
- `src/lib/mercury.ts` — copy verbatim

**Step 2: Write `src/lib/admin.ts`**

Copy from MRP but **remove** `isFinanceEmail()` (no finance role). Keep `isAdminEmail()` and `isStaffEmail()` (make `isStaffEmail` just alias `isAdminEmail`).

**Step 3: Write `src/lib/tier.ts`**

Replace MRP's Free/Pro feature gating with Gold/Platinum tier logic:

```typescript
export type AffiliateTier = 'gold' | 'platinum';

export const TIER_THRESHOLDS = {
  platinum: 250_000, // $250K referred volume
} as const;

export const COMMISSION_RATES: Record<AffiliateTier, number> = {
  gold: 0.05,     // 5% of transaction fee
  platinum: 0.10,  // 10% of transaction fee
};

export function getTierForVolume(referredVolume: number): AffiliateTier {
  return referredVolume >= TIER_THRESHOLDS.platinum ? 'platinum' : 'gold';
}

export function getCommissionRate(tier: AffiliateTier): number {
  return COMMISSION_RATES[tier];
}

export function calculateEarning(transactionFee: number, tier: AffiliateTier): number {
  return transactionFee * COMMISSION_RATES[tier];
}
```

**Step 4: Write `src/lib/affiliate-context.ts`**

Fork from MRP's `partner-context.ts`. Replace all `partner` references with `affiliate`:
- Table: `affiliates` instead of `partners`
- RPC: `get_my_affiliate_id()` instead of `get_my_partner_id()`
- Cookie: `wallet_view_as` instead of `mrp_view_as`
- Interface: `AffiliateContext` with `affiliate`, `affiliateId`, `isViewingAs`, `viewingAsName`
- Same three modes: normal (RLS), view-as (service client), preview bypass

**Step 5: Write `src/lib/funnel-colors.ts`**

Replace MRP's 9-stage pipeline colors with 5-stage funnel:

```typescript
const FUNNEL_COLORS: Record<string, string> = {
  signed_up: '#BBF7D0',       // green-200 — entry
  transaction_run: '#4ADE80',  // green-400 — earning trigger
  funds_in_wallet: '#22C55E',  // green-500 — funds received
  ach_initiated: '#16A34A',    // green-600 — transfer started
  funds_in_bank: '#00DE8F',    // Kashu mint — complete
};

const FUNNEL_LABEL_COLORS: Record<string, string> = {
  signed_up: '#15803D',        // dark text for light bg
  transaction_run: '#ffffff',
  funds_in_wallet: '#ffffff',
  ach_initiated: '#ffffff',
  funds_in_bank: '#0C5147',
};

const FUNNEL_LABELS: Record<string, string> = {
  signed_up: 'Signed Up',
  transaction_run: 'Transaction Run',
  funds_in_wallet: 'Funds in Wallet',
  ach_initiated: 'ACH Initiated',
  funds_in_bank: 'Funds in Bank',
};

export function funnelColor(slug: string): string {
  return FUNNEL_COLORS[slug] ?? '#E5E7EB';
}

export function funnelLabelColor(slug: string): string {
  return FUNNEL_LABEL_COLORS[slug] ?? '#374151';
}

export function funnelLabel(slug: string): string {
  return FUNNEL_LABELS[slug] ?? slug;
}
```

**Step 6: Write `src/lib/milestones.ts`**

Adapt from MRP. Replace merchant milestones with user milestones:
- User milestones: 1, 10, 25, 50, 100, 250, 500 referred users
- Earnings milestones: $50, $250, $1K, $5K, $10K, $50K
- Volume milestone: $250K (Platinum upgrade — special notification)

**Step 7: Commit**

```bash
git add src/lib/
git commit -m "feat: add core library files (supabase, formatters, tier, context)"
```

---

### Task 4: Middleware & Auth

**Files:**
- Create: `src/middleware.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/login/page.tsx`
- Create: `src/components/auth/LoginForm.tsx`
- Create: `src/app/auth/callback/route.ts`
- Create: `src/app/setup-password/page.tsx`
- Create: `src/components/auth/SetupPasswordForm.tsx`
- Create: `src/app/api/auth/post-login/route.ts`
- Create: `src/app/api/auth/setup-password/route.ts`

**Step 1: Write `src/middleware.ts`**

Fork from MRP's middleware. Changes:
- Remove `isFinanceEmail()` check (no finance role)
- Remove finance-specific route gating (`/admin/commissions` restriction)
- Change partner table check to `affiliates` table
- Change `mrp_view_as` cookie to `wallet_view_as`
- Remove `/api/automation/**` skip (no automation endpoints)
- Keep: session refresh, demo bypass, admin check, password requirement, suspension check

**Step 2: Write `src/app/layout.tsx`**

Fork from MRP. Change:
- Title: "Kashu | Wallet Affiliate Portal"
- Keep DM Sans + DM Mono fonts
- Same structure

**Step 3: Write auth pages**

Fork login page, callback route, setup-password page from MRP:
- `src/app/login/page.tsx` — same magic link flow
- `src/components/auth/LoginForm.tsx` — copy from MRP
- `src/app/auth/callback/route.ts` — copy from MRP (if exists) or handle via Supabase SSR
- `src/app/setup-password/page.tsx` — change `partners` table check to `affiliates`
- `src/components/auth/SetupPasswordForm.tsx` — copy from MRP

**Step 4: Write auth API routes**

Fork from MRP:
- `src/app/api/auth/post-login/route.ts` — change `partners` → `affiliates`, remove finance role handling
- `src/app/api/auth/setup-password/route.ts` — change `partners` → `affiliates`

**Step 5: Verify auth flow compiles**

```bash
npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add src/middleware.ts src/app/layout.tsx src/app/login/ src/app/auth/ src/app/setup-password/ src/components/auth/ src/app/api/auth/
git commit -m "feat: add auth flow (magic link, middleware, password setup)"
```

---

### Task 5: Supabase Migrations

**Files:**
- Create: `supabase/migrations/000_initial_schema.sql`

**Step 1: Write the initial migration**

Single migration file with all tables, RLS policies, RPC functions, and seed data:

```sql
-- Affiliates table
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

-- Funnel statuses (seed data)
CREATE TABLE funnel_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

INSERT INTO funnel_statuses (slug, label, color, sort_order) VALUES
  ('signed_up', 'Signed Up', '#BBF7D0', 1),
  ('transaction_run', 'Transaction Run', '#4ADE80', 2),
  ('funds_in_wallet', 'Funds in Wallet', '#22C55E', 3),
  ('ach_initiated', 'ACH Initiated', '#16A34A', 4),
  ('funds_in_bank', 'Funds in Bank', '#00DE8F', 5);

-- Referred users
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

-- Funnel events (immutable audit log)
CREATE TABLE funnel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referred_user_id UUID NOT NULL REFERENCES referred_users(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Earnings
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

-- Notifications
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

-- Leaderboard snapshots
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

-- Payouts
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

-- Payout accounts
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

-- Payout settings (singleton)
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

-- Admins
CREATE TABLE admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Security audit log
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

-- Webhook events (idempotency)
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

-- RLS helper
CREATE OR REPLACE FUNCTION public.get_my_affiliate_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.affiliates WHERE user_id = auth.uid() LIMIT 1;
$$;

-- Atomic payout request
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

-- RLS Policies
ALTER TABLE affiliates ENABLE ROW LEVEL SECURITY;
ALTER TABLE referred_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_accounts ENABLE ROW LEVEL SECURITY;

-- Affiliate can read own row
CREATE POLICY "affiliates_select_own" ON affiliates FOR SELECT USING (user_id = auth.uid());
-- Referred users scoped to affiliate
CREATE POLICY "referred_users_select_own" ON referred_users FOR SELECT USING (affiliate_id = public.get_my_affiliate_id());
-- Funnel events scoped via referred_users
CREATE POLICY "funnel_events_select_own" ON funnel_events FOR SELECT USING (
  referred_user_id IN (SELECT id FROM referred_users WHERE affiliate_id = public.get_my_affiliate_id())
);
-- Earnings scoped to affiliate
CREATE POLICY "earnings_select_own" ON earnings FOR SELECT USING (affiliate_id = public.get_my_affiliate_id());
-- Notifications scoped to affiliate
CREATE POLICY "notifications_select_own" ON notifications FOR SELECT USING (affiliate_id = public.get_my_affiliate_id());
CREATE POLICY "notifications_update_own" ON notifications FOR UPDATE USING (affiliate_id = public.get_my_affiliate_id());
-- Leaderboard readable by all authenticated (for ranking display)
CREATE POLICY "leaderboard_select_all" ON leaderboard_snapshots FOR SELECT USING (auth.uid() IS NOT NULL);
-- Payouts scoped to affiliate
CREATE POLICY "payouts_select_own" ON payouts FOR SELECT USING (affiliate_id = public.get_my_affiliate_id());
-- Payout accounts scoped to affiliate
CREATE POLICY "payout_accounts_select_own" ON payout_accounts FOR SELECT USING (affiliate_id = public.get_my_affiliate_id());
CREATE POLICY "payout_accounts_insert_own" ON payout_accounts FOR INSERT WITH CHECK (affiliate_id = public.get_my_affiliate_id());
CREATE POLICY "payout_accounts_update_own" ON payout_accounts FOR UPDATE USING (affiliate_id = public.get_my_affiliate_id());

-- Funnel statuses readable by all
ALTER TABLE funnel_statuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "funnel_statuses_select_all" ON funnel_statuses FOR SELECT USING (true);

-- Payout settings readable by all authenticated
ALTER TABLE payout_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payout_settings_select_all" ON payout_settings FOR SELECT USING (auth.uid() IS NOT NULL);

-- Auth trigger: link affiliate on signup
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
```

**Step 2: Commit**

```bash
git add supabase/
git commit -m "feat: add Supabase migration (tables, RLS, RPCs, trigger)"
```

---

## Phase 2: Webhook Handler & Earnings Engine

### Task 6: Wallet Webhook Handler

**Files:**
- Create: `src/app/api/webhooks/wallet/route.ts`

**Step 1: Write the webhook handler**

This is the core data ingestion point. Pattern forked from MRP's Airtable webhook but adapted for wallet events:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { calculateEarning, getTierForVolume } from '@/lib/tier';
import { checkUserMilestone, checkEarningsMilestone } from '@/lib/milestones';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// Timing-safe webhook secret validation (from MRP pattern)
function verifyWebhookSecret(request: NextRequest): boolean {
  const secret = request.headers.get('x-webhook-secret') ?? '';
  const expected = process.env.WALLET_WEBHOOK_SECRET ?? '';
  if (!expected) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a); // burn constant time
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!verifyWebhookSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { event_type, idempotency_key, data } = body;

  if (!event_type || !idempotency_key) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const db = createServiceClient();

  // Idempotency check
  const { data: existing } = await db
    .from('webhook_events')
    .select('id')
    .eq('idempotency_key', idempotency_key)
    .single();

  if (existing) {
    return NextResponse.json({ status: 'already_processed' });
  }

  // Log webhook event
  await db.from('webhook_events').insert({
    idempotency_key,
    event_type,
    payload: body,
  });

  try {
    switch (event_type) {
      case 'user.signed_up':
        await handleSignUp(db, data);
        break;
      case 'transaction.completed':
        await handleTransaction(db, data);
        break;
      case 'wallet.funded':
        await handleStageUpdate(db, data, 'funds_in_wallet');
        break;
      case 'ach.initiated':
        await handleStageUpdate(db, data, 'ach_initiated');
        break;
      case 'ach.completed':
        await handleStageUpdate(db, data, 'funds_in_bank');
        break;
      default:
        break; // ignore unknown events
    }

    await db
      .from('webhook_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('idempotency_key', idempotency_key);

    return NextResponse.json({ status: 'ok' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await db
      .from('webhook_events')
      .update({ error_message: message })
      .eq('idempotency_key', idempotency_key);

    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}

async function handleSignUp(db: any, data: any) {
  const { wallet_user_id, affiliate_attribution_id, full_name, email, phone } = data;

  // Find affiliate by attribution_id
  const { data: affiliate } = await db
    .from('affiliates')
    .select('id')
    .eq('attribution_id', affiliate_attribution_id)
    .single();

  if (!affiliate) return; // no matching affiliate — ignore

  // Upsert referred user
  const { data: user } = await db
    .from('referred_users')
    .upsert({
      wallet_user_id,
      affiliate_id: affiliate.id,
      full_name,
      email,
      phone,
      status_slug: 'signed_up',
    }, { onConflict: 'wallet_user_id' })
    .select('id')
    .single();

  if (!user) return;

  // Log funnel event
  await db.from('funnel_events').insert({
    referred_user_id: user.id,
    from_status: null,
    to_status: 'signed_up',
  });

  // Notify affiliate
  await db.from('notifications').insert({
    affiliate_id: affiliate.id,
    type: 'funnel_change',
    title: 'New User Signed Up',
    body: `${full_name || email || 'A user'} signed up via your referral link.`,
    metadata: { referred_user_id: user.id },
  });
}

async function handleTransaction(db: any, data: any) {
  const { wallet_user_id, transaction_amount, transaction_fee } = data;

  // Find referred user
  const { data: user } = await db
    .from('referred_users')
    .select('id, affiliate_id, first_transaction_at')
    .eq('wallet_user_id', wallet_user_id)
    .single();

  if (!user) return;

  // Only earn on FIRST transaction
  if (user.first_transaction_at) {
    // Just update stage if not already past transaction_run
    await advanceStage(db, user.id, 'transaction_run');
    return;
  }

  // Get affiliate for tier
  const { data: affiliate } = await db
    .from('affiliates')
    .select('id, tier, tier_override, referred_volume_total')
    .eq('id', user.affiliate_id)
    .single();

  if (!affiliate) return;

  const earningAmount = calculateEarning(transaction_fee, affiliate.tier);

  // Update referred user with first transaction data
  await db
    .from('referred_users')
    .update({
      status_slug: 'transaction_run',
      first_transaction_amount: transaction_amount,
      first_transaction_fee: transaction_fee,
      first_transaction_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  // Log funnel event
  await db.from('funnel_events').insert({
    referred_user_id: user.id,
    from_status: 'signed_up',
    to_status: 'transaction_run',
  });

  // Create earning
  await db.from('earnings').insert({
    affiliate_id: affiliate.id,
    referred_user_id: user.id,
    amount: earningAmount,
    transaction_fee_amount: transaction_fee,
    tier_at_earning: affiliate.tier,
  });

  // Update affiliate's referred volume
  const newVolume = (affiliate.referred_volume_total || 0) + transaction_amount;
  await db
    .from('affiliates')
    .update({ referred_volume_total: newVolume, updated_at: new Date().toISOString() })
    .eq('id', affiliate.id);

  // Check tier upgrade (only if not manually overridden)
  if (!affiliate.tier_override && affiliate.tier === 'gold') {
    const newTier = getTierForVolume(newVolume);
    if (newTier === 'platinum') {
      await db
        .from('affiliates')
        .update({ tier: 'platinum', updated_at: new Date().toISOString() })
        .eq('id', affiliate.id);

      await db.from('notifications').insert({
        affiliate_id: affiliate.id,
        type: 'tier_upgrade',
        title: 'Upgraded to Platinum!',
        body: 'Your referred volume crossed $250K. You now earn 10% on transaction fees.',
      });
    }
  }

  // Notify affiliate of earning
  await db.from('notifications').insert({
    affiliate_id: affiliate.id,
    type: 'earning_credited',
    title: 'Commission Earned',
    body: `You earned $${earningAmount.toFixed(2)} from a first transaction.`,
    metadata: { referred_user_id: user.id, amount: earningAmount },
  });
}

async function handleStageUpdate(db: any, data: any, newStage: string) {
  const { wallet_user_id } = data;
  const { data: user } = await db
    .from('referred_users')
    .select('id, status_slug, affiliate_id')
    .eq('wallet_user_id', wallet_user_id)
    .single();

  if (!user) return;
  await advanceStage(db, user.id, newStage);
}

async function advanceStage(db: any, userId: string, newStage: string) {
  const { data: user } = await db
    .from('referred_users')
    .select('status_slug')
    .eq('id', userId)
    .single();

  if (!user || user.status_slug === newStage) return;

  await db.from('funnel_events').insert({
    referred_user_id: userId,
    from_status: user.status_slug,
    to_status: newStage,
  });

  await db
    .from('referred_users')
    .update({ status_slug: newStage, updated_at: new Date().toISOString() })
    .eq('id', userId);
}
```

**Step 2: Commit**

```bash
git add src/app/api/webhooks/
git commit -m "feat: add wallet webhook handler with idempotent event processing"
```

---

## Phase 3: Dashboard Layout & Components

### Task 7: Layout Shell (Sidebar + Header)

**Files:**
- Create: `src/app/dashboard/layout.tsx`
- Create: `src/components/layout/AppSidebar.tsx`
- Create: `src/components/layout/NotificationBell.tsx`
- Create: `src/components/ui/PageTitle.tsx`
- Create: `src/components/ui/TierBadge.tsx`

**Step 1: Fork `AppSidebar.tsx` from MRP**

Adapt nav items for wallet affiliate:
- Dashboard (overview)
- Users (referred users list)
- Earnings
- Payouts
- Analytics (funnel)
- Referral Links
- Support

Remove: Leads, Merchants, Pipeline, Tools, Team/Sub-Partners nav items.
Keep: All SVG icons, responsive mobile drawer, user card, sign out, tier badge.

**Step 2: Fork `dashboard/layout.tsx` from MRP**

Changes:
- Nav items array: 7 items (see above) instead of MRP's 10+
- Replace `getPartnerContext()` with `getAffiliateContext()`
- Replace `mrp_view_as` cookie with `wallet_view_as`
- Remove Intercom JWT signing (add later if needed)
- Keep: view-as banner, sticky top bar, ambient orbs, AutoRefresh

**Step 3: Fork `NotificationBell.tsx`, `PageTitle.tsx`, `TierBadge.tsx` from MRP**

- `NotificationBell.tsx` — change query from `notifications` table (same schema, no changes needed)
- `PageTitle.tsx` — copy verbatim
- `TierBadge.tsx` — change from Silver/Gold/Platinum performance tiers to Gold/Platinum affiliate tiers

**Step 4: Build and verify**

```bash
npx tsc --noEmit
npm run build
```

**Step 5: Commit**

```bash
git add src/app/dashboard/layout.tsx src/components/layout/ src/components/ui/
git commit -m "feat: add dashboard layout shell with sidebar and header"
```

---

### Task 8: Overview Page

**Files:**
- Create: `src/app/dashboard/page.tsx`
- Create: `src/components/dashboard/StatsRow.tsx`
- Create: `src/components/dashboard/ReferralLinkCard.tsx`
- Create: `src/components/dashboard/RecentActivity.tsx`
- Create: `src/components/dashboard/EarningsCard.tsx`
- Create: `src/components/dashboard/FunnelChart.tsx` (new — replaces MerchantMoMChart)

**Step 1: Fork `StatsRow.tsx`**

Change 4 stat cards from MRP:
- Total Referred → Total Users (count of referred_users)
- In Pipeline → Transacted (status_slug = transaction_run or later)
- Approved → Completed (status_slug = funds_in_bank)
- Conversion Rate → Conversion Rate (signed_up → transaction_run)

**Step 2: Fork `ReferralLinkCard.tsx`**

Single variant (not merchant + MRP). Affiliate referral link using `attribution_id`.

**Step 3: Fork `RecentActivity.tsx`**

Change from pipeline events to funnel events. Same timeline UI, different stage labels/colors using `funnelColor()` and `funnelLabel()`.

**Step 4: Fork `EarningsCard.tsx`**

Simplify:
- Remove "Estimated Monthly Recurring" (no residuals)
- Keep: Lifetime Earnings, This Month, Pending, Paid
- Add: Current Tier badge (Gold/Platinum), Volume to Platinum progress

**Step 5: Create `FunnelChart.tsx`**

New component — 5-stage horizontal funnel visualization. Fork the visual pattern from MRP's `ConversionFunnel.tsx` but with 5 stages instead of 8.

**Step 6: Wire up `dashboard/page.tsx`**

Server component that:
- Calls `getAffiliateContext()`
- Queries `referred_users`, `funnel_statuses`, `earnings`, `funnel_events`
- Renders: greeting, ReferralLinkCard, StatsRow, FunnelChart, RecentActivity, EarningsCard

**Step 7: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 8: Commit**

```bash
git add src/app/dashboard/page.tsx src/components/dashboard/
git commit -m "feat: add dashboard overview page with stats, funnel, activity, earnings"
```

---

### Task 9: Users Page

**Files:**
- Create: `src/app/dashboard/users/page.tsx`
- Create: `src/components/dashboard/UserTable.tsx`

**Step 1: Fork `MerchantTable.tsx` → `UserTable.tsx`**

Change columns:
- Name, Email, Phone (keep)
- Status badge using `funnelColor()` / `funnelLabel()`
- First Transaction Amount (new)
- Signed Up date
- Remove: processing volume, processor, merchant external ID

Add filtering by funnel stage (dropdown with 5 stages).

**Step 2: Wire up `users/page.tsx`**

Server component querying `referred_users` with `funnel_statuses` join.

**Step 3: Build and commit**

```bash
npx tsc --noEmit && npm run build
git add src/app/dashboard/users/ src/components/dashboard/UserTable.tsx
git commit -m "feat: add referred users page with filterable table"
```

---

### Task 10: Earnings Page

**Files:**
- Create: `src/app/dashboard/earnings/page.tsx`
- Create: `src/components/dashboard/EarningsTable.tsx`

**Step 1: Fork `EarningsTable.tsx` from MRP**

Simplify:
- Remove earning type column (no upfront vs residual distinction)
- Add: tier at earning (Gold/Platinum badge), transaction fee amount
- Keep: amount, status badge, date, referred user name

**Step 2: Wire up `earnings/page.tsx`**

Server component querying `earnings` with `referred_users` join.
Show: EarningsCard summary at top, EarningsTable below.

**Step 3: Build and commit**

```bash
npx tsc --noEmit && npm run build
git add src/app/dashboard/earnings/
git commit -m "feat: add earnings page with history table"
```

---

### Task 11: Payouts Page

**Files:**
- Create: `src/app/dashboard/payouts/page.tsx`
- Create: `src/components/dashboard/PayoutsClient.tsx`
- Create: `src/components/dashboard/PayoutAccountCard.tsx`
- Create: `src/components/dashboard/PayoutHistory.tsx`
- Create: `src/components/dashboard/PayoutRequestModal.tsx`
- Create: `src/components/dashboard/PayoutSummary.tsx`
- Create: `src/components/dashboard/BankAccountForm.tsx`
- Create: `src/app/api/payouts/request/route.ts`
- Create: `src/app/api/payouts/stripe-connect/route.ts`
- Create: `src/app/api/payouts/mercury-account/route.ts`

**Step 1: Fork all payout components from MRP**

These are nearly identical — just change `partner_id` → `affiliate_id` in queries and props:
- `PayoutsClient.tsx` — orchestrates payout page state
- `PayoutAccountCard.tsx` — display linked accounts
- `PayoutHistory.tsx` — past payout table
- `PayoutRequestModal.tsx` — request new payout modal
- `PayoutSummary.tsx` — available balance display
- `BankAccountForm.tsx` — bank details entry

**Step 2: Fork payout API routes from MRP**

- `request/route.ts` — change `partners` → `affiliates`, use `get_my_affiliate_id()`
- `stripe-connect/route.ts` — change `partners` → `affiliates`
- `mercury-account/route.ts` — change `partners` → `affiliates`

**Step 3: Build and commit**

```bash
npx tsc --noEmit && npm run build
git add src/app/dashboard/payouts/ src/components/dashboard/Payout* src/components/dashboard/BankAccountForm.tsx src/app/api/payouts/
git commit -m "feat: add payout system (Stripe Connect, Mercury, manual)"
```

---

### Task 12: Analytics Page

**Files:**
- Create: `src/app/dashboard/analytics/page.tsx`
- Create: `src/components/dashboard/ConversionFunnel.tsx`
- Create: `src/components/dashboard/DropOffAnalysis.tsx`

**Step 1: Fork `ConversionFunnel.tsx` from MRP**

Adapt for 5-stage funnel:
- signed_up → transaction_run → funds_in_wallet → ach_initiated → funds_in_bank
- Use `funnelColor()` / `funnelLabel()`
- Same SVG trapezoid visual pattern
- Show conversion rates between each stage

**Step 2: Fork `DropOffAnalysis.tsx` from MRP**

Adapt for wallet funnel — show where users drop off at each of the 5 stages.

**Step 3: Wire up `analytics/page.tsx`**

Server component with funnel metrics computed from `referred_users` status counts.

**Step 4: Build and commit**

```bash
npx tsc --noEmit && npm run build
git add src/app/dashboard/analytics/
git commit -m "feat: add analytics page with conversion funnel and drop-off analysis"
```

---

### Task 13: Referral Links, Profile, Support Pages

**Files:**
- Create: `src/app/dashboard/referral-link/page.tsx`
- Create: `src/components/dashboard/QRCodeGenerator.tsx`
- Create: `src/app/dashboard/profile/page.tsx`
- Create: `src/components/dashboard/UpdatePasswordForm.tsx`
- Create: `src/app/dashboard/support/page.tsx`

**Step 1: Fork referral link page from MRP**

- Single referral link (not merchant + MRP variants)
- QR code generator — copy from MRP verbatim
- Marketing assets section (simple download links for banners/copy)

**Step 2: Fork profile page from MRP**

- Password update form — copy from MRP
- Account settings display
- Remove: tax documents section

**Step 3: Fork support page from MRP**

- Keep Intercom integration placeholder
- Keep calendar embed if using GHL
- Simplify resources section

**Step 4: Build and commit**

```bash
npx tsc --noEmit && npm run build
git add src/app/dashboard/referral-link/ src/app/dashboard/profile/ src/app/dashboard/support/ src/components/dashboard/QRCodeGenerator.tsx src/components/dashboard/UpdatePasswordForm.tsx
git commit -m "feat: add referral links, profile, and support pages"
```

---

### Task 14: Leaderboard

**Files:**
- Create: `src/components/dashboard/LeaderboardCard.tsx`
- Create: `src/components/dashboard/LeaderboardTable.tsx`
- Create: `src/lib/refresh-leaderboard.ts`
- Create: `src/app/api/cron/refresh-leaderboard/route.ts`
- Create: `src/app/api/admin/refresh-leaderboard/route.ts`

**Step 1: Fork `LeaderboardCard.tsx` from MRP**

Change tier progression:
- Gold → Platinum (at $250K volume)
- Show volume progress bar instead of merchant count progress
- Keep: rank display, percentile, rank change arrows

**Step 2: Fork `LeaderboardTable.tsx` from MRP**

Change columns: rank, name, referred users, volume, earnings, conversion rate, tier badge.

**Step 3: Fork `refresh-leaderboard.ts` from MRP**

Change ranking criteria:
- Rank by: referred_volume DESC → total_earnings DESC → created_at ASC
- Tier: platinum if volume >= $250K or tier_override, else gold
- Compute from `affiliates` + `earnings` tables

**Step 4: Fork cron route from MRP**

Same pattern — validate `CRON_SECRET`, call refresh function.

**Step 5: Build and commit**

```bash
npx tsc --noEmit && npm run build
git add src/components/dashboard/Leaderboard* src/lib/refresh-leaderboard.ts src/app/api/cron/ src/app/api/admin/refresh-leaderboard/
git commit -m "feat: add leaderboard system with cron refresh"
```

---

## Phase 4: Admin Panel

### Task 15: Admin Layout & Overview

**Files:**
- Create: `src/app/admin/layout.tsx`
- Create: `src/app/admin/page.tsx`

**Step 1: Fork admin layout from MRP**

Admin nav items:
- Overview
- Affiliates
- Users
- Funnel
- Earnings
- Payouts
- Settings

Remove: Revenue, Reports, Commissions (4-tab), Analytics (GA4/GHL)

**Step 2: Fork admin overview page**

Dashboard cards:
- Total affiliates (active/pending/suspended)
- Total referred users
- Total referred volume
- Total earnings (pending/approved/paid)
- Recent activity feed

Remove: ReferralTrendChart, ProcessingRateChart, AttributionAccuracyCard, SyncDiscrepanciesCard, SourceBreakdown, RevenueGrossProfit

**Step 3: Build and commit**

```bash
npx tsc --noEmit && npm run build
git add src/app/admin/
git commit -m "feat: add admin layout and overview page"
```

---

### Task 16: Admin Affiliates Page

**Files:**
- Create: `src/app/admin/affiliates/page.tsx`
- Create: `src/components/admin/AffiliateTable.tsx`
- Create: `src/components/admin/InviteAffiliateModal.tsx`
- Create: `src/app/api/admin/invite-affiliate/route.ts`
- Create: `src/app/api/admin/update-affiliate-status/route.ts`
- Create: `src/app/api/admin/override-tier/route.ts`
- Create: `src/app/api/admin/view-as/route.ts`

**Step 1: Fork `PartnerTable.tsx` → `AffiliateTable.tsx`**

Columns: Name, Email, Status, Tier (with override badge), Referred Users, Volume, Earnings, Actions (view-as, edit tier, suspend).

**Step 2: Fork `InvitePartnerModal.tsx` → `InviteAffiliateModal.tsx`**

Same flow — email input, sends magic link via Supabase invite.

**Step 3: Fork admin API routes from MRP**

- `invite-affiliate/route.ts` — change `partners` → `affiliates`
- `update-affiliate-status/route.ts` — change `partners` → `affiliates`
- `view-as/route.ts` — change cookie name to `wallet_view_as`, table to `affiliates`

**Step 4: Write new `override-tier/route.ts`**

```typescript
// POST /api/admin/override-tier
// Body: { affiliate_id: string, tier: 'gold' | 'platinum' }
// Sets tier + tier_override = true
// Admin-only, audit logged
```

**Step 5: Build and commit**

```bash
npx tsc --noEmit && npm run build
git add src/app/admin/affiliates/ src/components/admin/ src/app/api/admin/
git commit -m "feat: add admin affiliates page with invite, tier override, view-as"
```

---

### Task 17: Admin Users Page

**Files:**
- Create: `src/app/admin/users/page.tsx`
- Create: `src/components/admin/AdminUserTable.tsx`

**Step 1: Fork `AdminMerchantTable.tsx` → `AdminUserTable.tsx`**

Columns: Name, Email, Affiliate (who referred them), Funnel Stage, First Transaction, Signed Up date.
Filters: by funnel stage, by affiliate.

**Step 2: Wire up admin users page**

Service client query — all referred_users with affiliate join.

**Step 3: Build and commit**

```bash
npx tsc --noEmit && npm run build
git add src/app/admin/users/ src/components/admin/AdminUserTable.tsx
git commit -m "feat: add admin users page with filterable table"
```

---

### Task 18: Admin Funnel Analytics

**Files:**
- Create: `src/app/admin/funnel/page.tsx`
- Create: `src/components/admin/AdminFunnel.tsx`

**Step 1: Create admin funnel page**

Shows system-wide funnel metrics (not scoped to one affiliate):
- Total users at each stage
- Stage-to-stage conversion rates
- Average time in each stage (from funnel_events timestamps)
- Reuse `ConversionFunnel` component with admin-level data

**Step 2: Build and commit**

```bash
npx tsc --noEmit && npm run build
git add src/app/admin/funnel/
git commit -m "feat: add admin funnel analytics page"
```

---

### Task 19: Admin Earnings & Payouts

**Files:**
- Create: `src/app/admin/earnings/page.tsx`
- Create: `src/components/admin/AdminEarningsTable.tsx`
- Create: `src/app/admin/payouts/page.tsx`
- Create: `src/components/admin/PayoutBatchManager.tsx`
- Create: `src/app/api/admin/earnings/approve/route.ts`
- Create: `src/app/api/admin/payouts/create-batch/route.ts`
- Create: `src/app/api/admin/payouts/execute-batch/route.ts`
- Create: `src/app/api/admin/payouts/update-status/route.ts`
- Create: `src/app/api/cron/check-mercury-payouts/route.ts`

**Step 1: Fork admin earnings from MRP**

- `AdminEarningsTable.tsx` — show all earnings across all affiliates, with approve/reverse actions
- Bulk approve button for pending earnings
- `approve/route.ts` — change `partners` → `affiliates`, same approval logic

**Step 2: Fork admin payouts from MRP**

- `PayoutBatchManager.tsx` — create batch, execute batch, status tracking
- All three payout API routes — change `partners` → `affiliates`
- Mercury cron route — change `partners` → `affiliates`

**Step 3: Build and commit**

```bash
npx tsc --noEmit && npm run build
git add src/app/admin/earnings/ src/app/admin/payouts/ src/components/admin/AdminEarningsTable.tsx src/components/admin/PayoutBatchManager.tsx src/app/api/admin/earnings/ src/app/api/admin/payouts/ src/app/api/cron/check-mercury-payouts/
git commit -m "feat: add admin earnings approval and payout batch execution"
```

---

### Task 20: Admin Settings

**Files:**
- Create: `src/app/admin/settings/page.tsx`
- Create: `src/app/api/admin/payout-settings/route.ts`

**Step 1: Create settings page**

Admin config page with:
- Minimum payout amount
- Default payout provider
- Auto-approve earnings toggle
- Tier threshold display ($250K — read-only for now)

**Step 2: Fork payout settings API from MRP**

Same pattern — update `payout_settings` singleton row.

**Step 3: Build and commit**

```bash
npx tsc --noEmit && npm run build
git add src/app/admin/settings/ src/app/api/admin/payout-settings/
git commit -m "feat: add admin settings page"
```

---

## Phase 5: Demo Mode & Polish

### Task 21: Demo Mode

**Files:**
- Create: `src/lib/demo-data.ts`
- Create: `src/app/demo/page.tsx`
- Create: `src/app/demo/layout.tsx`

**Step 1: Write demo data**

Adapt from MRP's demo data:
- Demo affiliate "Alex Rivera" (Platinum tier, $320K volume)
- 30 demo referred users across 5 funnel stages
- Demo earnings (15 transactions)
- Demo leaderboard (10 affiliates)

**Step 2: Create demo layout and page**

Fork from MRP's demo routes. No auth required. Same dashboard UI with mock data.

**Step 3: Build and commit**

```bash
npx tsc --noEmit && npm run build
git add src/lib/demo-data.ts src/app/demo/
git commit -m "feat: add public demo mode with mock data"
```

---

### Task 22: Environment & Deployment

**Files:**
- Create: `.env.local.example`
- Create: `vercel.json` (cron config)
- Update: `README.md` (if exists)

**Step 1: Create env example file**

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
ADMIN_EMAILS=
WALLET_WEBHOOK_SECRET=
STRIPE_SECRET_KEY=
MERCURY_API_TOKEN=
MERCURY_ACCOUNT_ID=
CRON_SECRET=
```

**Step 2: Create Vercel cron config**

```json
{
  "crons": [
    { "path": "/api/cron/refresh-leaderboard", "schedule": "0 0 1 * *" },
    { "path": "/api/cron/check-mercury-payouts", "schedule": "*/15 * * * *" }
  ]
}
```

**Step 3: Final build verification**

```bash
npx tsc --noEmit && npm run build
```

**Step 4: Commit**

```bash
git add .env.local.example vercel.json
git commit -m "feat: add environment config and Vercel cron setup"
```

---

### Task 23: Final Verification & CLAUDE.md

**Files:**
- Create: `CLAUDE.md`

**Step 1: Write CLAUDE.md for the new project**

Adapt from MRP's CLAUDE.md with:
- New project identity (Wallet Affiliate Dashboard)
- Same design system section
- Updated architecture reference (affiliates, not partners)
- Updated DB quick reference
- Same safe update protocol
- New environment variables list
- Funnel stages instead of pipeline stages

**Step 2: Full build + TypeScript check**

```bash
npx tsc --noEmit && npm run build
```

**Step 3: Final commit**

```bash
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md project instructions"
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | Tasks 1-5 | Scaffolding, types, core libs, auth, DB migrations |
| 2 | Task 6 | Webhook handler + earnings engine |
| 3 | Tasks 7-14 | Dashboard pages (overview, users, earnings, payouts, analytics, referrals, profile, leaderboard) |
| 4 | Tasks 15-20 | Admin panel (overview, affiliates, users, funnel, earnings/payouts, settings) |
| 5 | Tasks 21-23 | Demo mode, deployment config, CLAUDE.md |

**Total: 23 tasks across 5 phases**

Every task ends with `npx tsc --noEmit && npm run build` and a commit. The MRP dashboard at `/Users/milespietsch/Desktop/Claude/Workspace/mrp-dashboard` is READ ONLY — referenced for forking patterns but never modified.
