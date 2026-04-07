# Kashu Wallet Affiliate Dashboard — Design Document

> **Date:** 2026-04-07
> **Approach:** Fork from MRP Dashboard (Approach A)
> **Source repo:** `mrp-dashboard` (reference only — no modifications)
> **New repo:** `wallet-affiliate-dashboard` (entirely separate project)

---

## 1. Product Overview

Affiliates refer users to the Kashu wallet for credit conversion. Affiliates earn a one-time commission on Kashu's transaction fee from each referred user's first transaction.

**Key differences from MRP Dashboard:**
- Users, not merchants (simpler entity)
- 5-stage funnel (not 8-stage pipeline)
- One-time earnings per user (no recurring residuals)
- No sub-affiliates
- Webhook-driven data (no Airtable/HighLevel sync)
- 2 tiers: Gold (5%) / Platinum (10%) — not Free/Pro feature gating

---

## 2. Tier System

| Tier | Commission Rate | Qualification |
|------|----------------|---------------|
| Gold | 5% of Kashu's transaction fee | Default tier |
| Platinum | 10% of Kashu's transaction fee | $250K+ referred transaction volume OR admin override (grandfathered) |

- Auto-upgrade: when `referred_volume_total >= $250,000`, affiliate upgrades to Platinum + notification
- Admin override: manual tier assignment for grandfathered partners (persists regardless of volume)
- No downgrade path — once Platinum, stays Platinum

---

## 3. Funnel Stages

```
signed_up → transaction_run → funds_in_wallet → ach_initiated → funds_in_bank
```

| Stage | Trigger | Affiliate Earns? |
|-------|---------|-------------------|
| `signed_up` | User creates wallet account via affiliate link | No |
| `transaction_run` | User completes first credit conversion | **Yes — earning created** |
| `funds_in_wallet` | Converted funds deposited in wallet | No |
| `ach_initiated` | User initiates ACH transfer to bank | No |
| `funds_in_bank` | ACH completes, funds in bank account | No |

Users can drop off at any stage. A user who never completes their first transaction generates no earning.

---

## 4. Earnings Flow

### Calculation
```
earning = transaction_fee * (affiliate.tier === 'platinum' ? 0.10 : 0.05)
```

### Lifecycle
```
pending → approved → paid
              ↘ reversed (if chargeback/fraud)
```

- **Pending:** Auto-created on `transaction.completed` webhook
- **Approved:** Admin approves (or auto-approve if enabled in settings)
- **Paid:** Included in a payout batch and executed
- **Reversed:** Admin reverses for fraud/chargeback

### Tier Upgrade Check
After each earning, recalculate `referred_volume_total`. If it crosses $250K and tier is not admin-overridden, auto-upgrade to Platinum and create notification.

---

## 5. Data Model

### Tables (12 + 1 new)

#### `affiliates` (forked from `partners`)
```
id, user_id, agent_name, business_name, email, phone,
tier (gold | platinum), tier_override (boolean — admin-assigned),
status (pending | active | suspended),
referred_volume_total (decimal — running total for tier calc),
attribution_id (unique referral code),
has_password, agreement_status, last_login_at,
created_at, updated_at
```

#### `referred_users` (forked from `merchants`)
```
id, affiliate_id, full_name, email, phone,
status_slug (FK → funnel_statuses),
first_transaction_amount (decimal),
first_transaction_fee (decimal),
first_transaction_at (timestamp),
wallet_user_id (external ID from wallet platform),
created_at, updated_at
```

#### `funnel_statuses` (forked from `pipeline_statuses`)
```
id, slug, label, color, sort_order
```
Seeded with: signed_up, transaction_run, funds_in_wallet, ach_initiated, funds_in_bank

#### `funnel_events` (forked from `pipeline_events`)
```
id, referred_user_id, from_status, to_status, created_at
```

#### `earnings`
```
id, affiliate_id, referred_user_id,
amount (decimal), transaction_fee_amount (decimal),
tier_at_earning (gold | platinum),
status (pending | approved | paid | reversed),
created_at, updated_at
```

#### `notifications`
```
id, affiliate_id, type, title, body, is_read, metadata (jsonb), created_at
```
Types: funnel_change, earning_credited, tier_upgrade, payout_processed, system_announcement

#### `leaderboard_snapshots`
```
id, period (YYYY-MM), affiliate_id,
rank, referred_user_count, referred_volume, total_earnings,
conversion_rate, percentile,
created_at
```

#### `payouts`
```
id, affiliate_id, payout_account_id,
amount, currency, status (requested | processing | completed | failed),
provider_reference_id, period,
created_at, updated_at
```

#### `payout_accounts`
```
id, affiliate_id,
provider (stripe_connect | mercury | manual),
provider_id, account_name, routing_number, account_number_last4,
is_default, is_verified,
created_at, updated_at
```

#### `payout_settings`
```
id, min_payout_amount, default_provider, auto_approve_earnings (boolean),
created_at, updated_at
```

#### `admins`
```
id, user_id, email, role, created_at
```

#### `security_audit_log`
```
id, user_id, event_type, ip_address, user_agent, metadata (jsonb), created_at
```

#### `webhook_events` (NEW)
```
id, idempotency_key (unique), event_type, payload (jsonb),
processed (boolean), error_message, created_at, processed_at
```

---

## 6. Pages & Routes

### Affiliate Dashboard

| Route | Description |
|-------|-------------|
| `/dashboard` | Overview: greeting, stats row, funnel chart, recent activity, earnings card |
| `/dashboard/users` | Referred users table with funnel stage badges, search, filter |
| `/dashboard/earnings` | Earnings summary, history table, tier info |
| `/dashboard/payouts` | Payout accounts (Stripe/Mercury/manual), request payout, history |
| `/dashboard/analytics` | 5-stage conversion funnel, drop-off analysis |
| `/dashboard/profile` | Password, account settings |
| `/dashboard/referral-link` | QR codes, share links, marketing assets |
| `/dashboard/support` | Intercom chat, calendar widget |

### Admin Panel

| Route | Description |
|-------|-------------|
| `/admin` | Overview: affiliate count, user count, volume, earnings summary |
| `/admin/affiliates` | All affiliates table, tier management, manual overrides, invite |
| `/admin/users` | All referred users, funnel status, attribution |
| `/admin/funnel` | Funnel analytics, conversion rates, bottlenecks |
| `/admin/earnings` | Earnings approval workflow |
| `/admin/payouts` | Payout batch creation + execution |
| `/admin/analytics` | KPI funnel, visitor trends (if GA4 connected) |
| `/admin/settings` | System config, payout defaults, auto-approve toggle |

### Auth

| Route | Description |
|-------|-------------|
| `/login` | Magic link login |
| `/auth/callback` | Supabase OAuth callback |
| `/setup-password` | Initial password setup |

### Demo

| Route | Description |
|-------|-------------|
| `/demo` | Public demo with mock data |

---

## 7. API Routes

### Webhooks
| Route | Purpose |
|-------|---------|
| `POST /api/webhooks/wallet` | Receives all wallet platform events, routes by `event_type` |

### Auth
| Route | Purpose |
|-------|---------|
| `POST /api/auth/post-login` | Admin detection, redirect logic |
| `POST /api/auth/setup-password` | Initial password setup |

### Payouts
| Route | Purpose |
|-------|---------|
| `POST /api/payouts/request` | Atomic balance check + payout request |
| `POST /api/payouts/stripe-connect` | Stripe Connect OAuth flow |
| `POST /api/payouts/mercury-account` | Link Mercury bank account |

### Admin
| Route | Purpose |
|-------|---------|
| `POST /api/admin/invite-affiliate` | Send magic link invite |
| `POST /api/admin/update-affiliate-status` | Activate/suspend affiliate |
| `POST /api/admin/override-tier` | Manually set Gold/Platinum |
| `POST /api/admin/view-as` | Admin impersonate affiliate |
| `POST /api/admin/payout-settings` | Configure payout defaults |
| `POST /api/admin/earnings/approve` | Approve pending earnings |
| `POST /api/admin/payouts/create-batch` | Create payout batch |
| `POST /api/admin/payouts/execute-batch` | Execute via Mercury/Stripe |
| `POST /api/admin/payouts/update-status` | Update payout status |
| `POST /api/admin/refresh-leaderboard` | Refresh leaderboard snapshots |

### Cron
| Route | Purpose |
|-------|---------|
| `GET /api/cron/refresh-leaderboard` | Monthly leaderboard refresh |
| `GET /api/cron/check-mercury-payouts` | Poll Mercury for payout status |

---

## 8. Integrations

| Service | Purpose | Kept from MRP? |
|---------|---------|----------------|
| Supabase Auth | Magic link auth, RLS | Yes |
| Supabase DB | All data persistence | Yes |
| Stripe Connect | Affiliate payout linking | Yes |
| Mercury | ACH payout execution | Yes |
| Intercom | In-app support chat | Yes |
| Wallet Platform | Webhook events (signup, transaction, ACH) | **New** |

### Removed Integrations
Airtable, HighLevel, GA4, PandaDoc, n8n automation

---

## 9. Environment Variables

### Required
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
APP_URL
NEXT_PUBLIC_APP_URL
ADMIN_EMAILS
WALLET_WEBHOOK_SECRET
STRIPE_SECRET_KEY
MERCURY_API_TOKEN
MERCURY_ACCOUNT_ID
CRON_SECRET
```

### Optional
```
GA4_PROPERTY_ID + Google OAuth    (admin visitor analytics)
INTERCOM_APP_ID                   (support chat)
```

---

## 10. What to Fork vs Remove

### Fork & Adapt
- Auth flow (magic link, middleware, password setup)
- Design system (Tailwind config, globals.css, brand colors)
- Layout (sidebar, header, notification bell)
- RLS pattern (`get_my_affiliate_id()` helper)
- Payout system (Stripe Connect, Mercury, request flow)
- Audit logging
- Formatters (`fmt.ts`)
- Leaderboard system
- Notification system
- Demo mode
- Webhook validation pattern (timing-safe compare)
- Atomic payout RPC

### Remove Entirely
- Sub-partner system (components, API routes, DB tables)
- Tools suite (15 pages of calculators, scripts, templates)
- Airtable sync + webhooks
- HighLevel sync + attribution healing
- Processor reports + reconciliation
- Commission batch workflow
- Multi-source attribution audit
- Revenue actuals
- Sales KPIs (GA4/GHL fetchers)
- Residual earnings calculation
- n8n automation endpoints

---

## 11. Architecture Decisions

1. **Single webhook endpoint** — all wallet events go to `/api/webhooks/wallet`, routed by `event_type`. Simpler than MRP's multi-source approach.
2. **Auto-calculated earnings** — no manual commission calculation. Earning created instantly on transaction webhook.
3. **Idempotent webhook processing** — `webhook_events` table with unique `idempotency_key` prevents double-processing.
4. **Same security patterns** — timing-safe webhook validation, atomic payout RPC, admin re-verification on view-as, audit logging.
5. **Simplified admin** — no reconciliation, no processor reports, no attribution healing. Just affiliates, earnings, payouts, funnel analytics.
6. **Separate deployment** — own Vercel project, own Supabase project, own repo. No shared infrastructure with MRP dashboard.
