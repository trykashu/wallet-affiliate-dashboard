# CLAUDE.md — Kashu Wallet Affiliate Dashboard: Agent Memory & Process Protocol

> **Read this file at the start of every session.**
> This is a living document. After every significant session, append new lessons to the
> "Self-Annealing Log" section. Never remove old lessons — only add.

---

## 1. Project Identity

- **App:** Kashu Wallet Affiliate Dashboard
- **Stack:** Next.js 15 (App Router), Supabase (auth + DB + RLS), Tailwind CSS, TypeScript
- **Repo:** `github.com/milespietsch/wallet-affiliate-dashboard` (branch: `main` → auto-deploys to Vercel)
- **One Vercel project only** — under `milespietschs-projects`
- **Sibling project:** MRP Dashboard (`mrp-dashboard`) — same Kashu brand, different business domain

---

## 2. Current Design System (Source of Truth)

### Brand Colors (`tailwind.config.ts`)
```
brand-600:  #0C5147   ← Kashu PRIMARY teal (sidebar bg, buttons, links)
brand-700:  #0A4039   ← hover dark teal
accent:     #00DE8F   ← Kashu bright mint (chart lines, active states, success)
highlight:  #E1FFA0   ← Kashu soft lime (do NOT use as text on white — invisible)
```

### Theme: WHITE/LIGHT with dark sidebar
```
Page background:  bg-gray-50 (#F8FAFC)
Cards:            bg-white, border border-gray-100, shadow-card
Sidebar:          bg-brand-600 (#0C5147) — STAYS DARK, text-white OK here
Header:           bg-white/70 backdrop-blur-xl border-b border-surface-200/60
Body text:        text-gray-900
Muted text:       text-brand-400 (#64748B slate-500)
Borders:          border-surface-200/60 (cards) or border-gray-200 (inputs)
Accent text:      text-accent (#00DE8F)
```

### Funnel Stage Colors (`src/lib/funnel-colors.ts`)
```
signed_up:        #BBF7D0  (green-200)  – entry
transaction_run:  #4ADE80  (green-400)  – first action
funds_in_wallet:  #22C55E  (green-500)  – wallet funded
ach_initiated:    #16A34A  (green-600)  – withdrawal started
funds_in_bank:    #00DE8F  (Kashu mint) – completed
```
> **Note:** Funnel colors are a green-based gradient by design (matching MRP pipeline).
> Light stage colors (signed_up) use `#15803D` text overrides for label legibility.

### CSS Design Tokens (`globals.css`)
```
.card           — bg-white border border-gray-100 rounded-2xl shadow-card
.stat-card      — card p-5 hover:shadow-card-md
.stat-card-accent — stat-card with accent border/shadow
.btn-primary    — bg-brand-600 text-white hover:bg-brand-700
.btn-accent     — bg-accent text-brand-600 hover:bg-accent-600
.badge-accent   — bg-accent/10 text-brand-600 border-accent/30
.badge-amber    — bg-amber-50 text-amber-700 border-amber-200
.text-gradient  — linear-gradient(135deg, #0C5147, #00DE8F)
.accent-top     — border-t-2 border-top-color: #00DE8F
.nav-item       — sidebar nav item (text-white/60 → text-white) — DARK SIDEBAR ONLY
.input-base     — bg-white border-gray-200 text-gray-900
```

### SVG Chart Colors
```
Line/area fill:  #00DE8F (accent mint)
Grid lines:      #E5E7EB (gray-200, dashed)
Dot fill:        #ffffff (white)
Dot stroke:      #00DE8F
Y-axis labels:   #94A3B8 (slate-400)
```

### BANNED COLORS (old kashupay.com palette — never use)
```
❌ #cfff45  (old lime — replaced by #00DE8F)
❌ #0c3a30  (old dark green — replaced by #E5E7EB for grid lines)
❌ #19362d  (old dark green — replaced by #ffffff for dot fills)
❌ #0b5147  (slight variant — use #0C5147 only)
```

### Typography Hierarchy (Mercury-Grade)
```
Page title:       text-2xl font-bold text-gray-900
Section heading:  text-sm font-bold text-brand-400 uppercase tracking-wider
Card title:       text-sm font-semibold text-gray-900
Stat value hero:  text-display-sm sm:text-display font-bold text-gray-900 tabular-nums
Stat value sec:   text-stat font-bold text-gray-900 tabular-nums
Stat label:       text-[10px] text-brand-400 uppercase tracking-wider font-medium
Body text:        text-sm text-gray-600
Muted text:       text-brand-400 text-sm  ← ALWAYS brand-400, NEVER gray-500
Table header:     .th class (text-brand-400, text-[10px], uppercase)
Table body:       text-sm text-gray-600
Badge:            text-[10px] font-semibold px-2 py-0.5 rounded-full
```

### Number Formatting (`src/lib/fmt.ts` — ALWAYS use, never inline)
```
fmt.currency(n)         → $12,345.67    (all dollar amounts)
fmt.currencyCompact(n)  → $12.3K        (large stat cards)
fmt.count(n)            → 1,234         (user counts)
fmt.percent(0.25)       → 25.0%         (conversion rates, tier %)
fmt.rate(0.00375)       → 0.375%        (commission rates)
fmt.date("2026-03-15")  → Mar 15, 2026  (all dates)
fmt.relative(date)      → 2h ago        (activity feeds)
```
> All numeric displays MUST use `tabular-nums` class for column alignment.

### BANNED Tailwind Classes
```
❌ text-gray-500      → use text-brand-400
❌ text-gray-400 (text)→ use text-brand-400 (ok on icons)
❌ rounded-lg (inputs) → use rounded-xl
❌ text-3xl (stats)    → use text-display-sm
❌ text-5xl (stats)    → use text-display
❌ .toFixed(2)         → use fmt.currency()
❌ .toLocaleString()   → use fmt.currency() or fmt.count()
```

---

## 3. Architecture Reference

| Layer | Detail |
|-------|--------|
| **Auth** | Supabase Magic Link OTP; `isAdminEmail()` for admin routing |
| **DB** | Supabase Postgres — 13 tables (see Section 8) |
| **RLS** | `get_my_affiliate_id()` helper; affiliates see own data; service role for webhooks/admin |
| **Patterns** | Prop drilling (no state lib), `supabase as any` cast, `force-dynamic` on all pages, `useMemo` for all computations |
| **Charts** | Pure inline SVG with cubic bezier paths — NO chart library |
| **Tier system** | Gold (5% commission) / Platinum ($250K+ volume, 10% commission) |
| **Funnel** | 5-stage: signed_up → transaction_run → funds_in_wallet → ach_initiated → funds_in_bank |

### Key Files
```
tailwind.config.ts                     ← design tokens (read before ANY color change)
src/app/globals.css                    ← CSS utility classes
src/lib/funnel-colors.ts               ← funnel stage color overrides
src/lib/tier.ts                        ← tier logic (Gold/Platinum, commission rates)
src/lib/fmt.ts                         ← number/date formatting (always use)
src/lib/demo-data.ts                   ← mock data for /demo route
src/types/database.ts                  ← all TypeScript types
src/middleware.ts                      ← route protection
src/lib/affiliate-context.ts           ← affiliate resolution (RLS + view-as)
src/components/layout/AppSidebar.tsx   ← DARK sidebar — text-white is CORRECT here
src/app/dashboard/layout.tsx           ← dashboard layout (light theme)
src/app/dashboard/page.tsx             ← overview page
src/app/demo/page.tsx                  ← public demo (no auth)
```

### Component Inventory (`src/components/dashboard/`)
```
StatsRow              FunnelChart          ConversionFunnel
DropOffAnalysis       EarningsCard         EarningsTable
RecentActivity        ReferralLinkCard     QRCodeGenerator
LeaderboardCard       LeaderboardTable     UserTable
PayoutSummary         PayoutHistory        PayoutAccountCard
PayoutRequestModal    PayoutsClient        BankAccountForm
UpdatePasswordForm
```

### Component Inventory (`src/components/ui/`)
```
PageTitle             TierBadge            Toast
```

---

## 4. Safe Update Protocol (Follow This Every Time)

### 4A. Before Making Changes
```bash
# 1. Read the file first (ALWAYS — Edit/Write tools fail without this)
# 2. Check what color classes are in use
grep -rn "text-white\|bg-brand-\|#[0-9a-f]" src/components/dashboard/TargetFile.tsx
# 3. Read tailwind.config.ts if touching any colors
```

### 4B. Making Text/Class Changes
```bash
# USE PYTHON for string replacements — sed has quoting hell with JSX
python3 << 'PYEOF'
with open('path/to/file.tsx', 'r') as f:
    content = f.read()
content = content.replace('old string', 'new string')
with open('path/to/file.tsx', 'w') as f:
    f.write(content)
PYEOF

# For bulk multi-file replacements, ALWAYS use Python, NOT sed
python3 << 'PYEOF'
import glob
for fpath in glob.glob("src/components/**/*.tsx", recursive=True):
    with open(fpath, 'r') as f: content = f.read()
    original = content
    content = content.replace('old', 'new')
    if content != original:
        with open(fpath, 'w') as f: f.write(content)
PYEOF
```

### 4C. Before Every Push — Mandatory Checklist
```bash
# 1. TypeScript check (catches type errors)
npx tsc --noEmit

# 2. Full build (catches JSX syntax errors TypeScript misses)
npm run build

# Both must pass with ZERO errors before pushing.
# If either fails, fix ALL errors before proceeding.
```

### 4D. Push
```bash
git add <specific files>   # Never use git add -A blindly
git commit -m "..."
git push origin main
```

### 4E. Post-Push Verification
- Wait ~60s for Vercel to deploy
- Visit the live URL and check for 500 errors
- Check Vercel logs if errors appear

---

## 5. Common Gotchas & How to Avoid Them

### Gotcha: Edit/Write tool fails with "File has not been read yet"
**Cause:** Edit and Write tools require the file to be read in the current session first.
**Fix:** Always use `Read` tool on the file before attempting `Edit` or `Write`.

### Gotcha: sed breaks JSX ternary expressions
**Cause:** `sed 's/? "old"/"new"/g'` removes the `?` operator from ternaries.
**Fix:** Use Python `.replace()` with the FULL surrounding context including the `? ` prefix.

### Gotcha: sed quote escaping failures
**Cause:** Bash single-quote heredocs can't contain single quotes; double-quotes require escaping.
**Fix:** Always use Python for string replacements with complex JSX/TSX content.

### Gotcha: Invalid JSX expression
**Cause:** JSX `{}` expressions can only contain a single expression, not element + trailing text.
**Fix:** Remove outer braces when mixing JSX elements with text.

### Gotcha: `text-highlight` (#E1FFA0) on white background
**Cause:** `#E1FFA0` (soft lime) is nearly invisible on white. Only use on dark backgrounds.
**Fix:** Use `text-amber-500` for pending amounts, `text-accent` for success values.

### Gotcha: `text-white` in content components (light theme)
**Cause:** After white/light theme, any `text-white` in dashboard components makes text invisible.
**Exception:** `AppSidebar.tsx` uses dark sidebar — `text-white` IS CORRECT there.
**Fix:** `text-gray-900` for all content component headings/values.

### Gotcha: TypeScript passes but build fails
**Cause:** JSX syntax errors can pass `tsc --noEmit` but fail `npm run build`.
**Fix:** ALWAYS run both `npx tsc --noEmit` AND `npm run build` before pushing.

### Gotcha: Unused imports left in rewritten files
**Cause:** When rewriting files, old import statements may be included but unused.
**Fix:** After rewriting, scan for unused imports and verify each is used.

---

## 6. Self-Annealing Log

> Append new lessons here after each significant session. Format: `### [DATE] — [TOPIC]`

### [2026-04-07] — Initial Project Build
- **Context:** Full build of Wallet Affiliate Dashboard, adapted from MRP Dashboard architecture
- **Key decisions:**
  1. 5-stage funnel (signed_up → funds_in_bank) instead of MRP's 8-stage pipeline
  2. Gold/Platinum tier system based on referred transaction volume ($250K threshold)
  3. Commission model: percentage of transaction fees (5% Gold, 10% Platinum)
  4. Same Kashu brand design system as MRP (shared brand-600, accent, typography)
  5. 13 DB tables (streamlined from MRP's 19+)

---

## 7. Feature Roadmap Status

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Project scaffold + types + design system | DONE |
| 2 | Auth (login/signup/middleware) | DONE |
| 3 | Dashboard layout + sidebar | DONE |
| 4 | Affiliate context + view-as | DONE |
| 5 | Overview page (stats, funnel, activity, earnings) | DONE |
| 6 | User management (UserTable, user detail) | DONE |
| 7 | Earnings system + EarningsTable | DONE |
| 8 | Funnel analytics (ConversionFunnel, DropOffAnalysis) | DONE |
| 9 | Leaderboard + tiering | DONE |
| 10 | Referral links + QR codes | DONE |
| 11 | Payout system (accounts, requests, history) | DONE |
| 12 | Admin panel (affiliates, earnings, payouts) | DONE |
| 13 | Webhook ingestion (wallet events) | DONE |
| 14 | Cron jobs (leaderboard refresh, Mercury payout checks) | DONE |
| 15 | Notification system | DONE |
| 16 | Profile + password management | DONE |
| 17 | Support page | DONE |
| 18 | Security hardening (headers, crypto, TOCTOU) | DONE |
| 19 | Data health + monitoring | DONE |
| 20 | Performance (caching, dedup) | DONE |
| 21 | Public demo mode | DONE |
| 22 | Environment + deployment config | DONE |
| 23 | CLAUDE.md project instructions | DONE |

---

## 8. Supabase DB Quick Reference

```sql
-- 13 tables
affiliates            (id, user_id, agent_name, business_name, email, tier, status, referred_volume_total, attribution_id, ...)
referred_users        (id, affiliate_id, full_name, email, status_slug, first_transaction_amount, first_transaction_fee, wallet_user_id, ...)
funnel_statuses       (id, slug, label, color, sort_order)
funnel_events         (id, referred_user_id, from_status, to_status, created_at)
earnings              (id, affiliate_id, referred_user_id, amount, transaction_fee_amount, tier_at_earning, status, ...)
notifications         (id, affiliate_id, type, title, body, is_read, ...)
leaderboard_snapshots (id, period, affiliate_id, rank, referred_user_count, referred_volume, total_earnings, conversion_rate, percentile, ...)
payouts               (id, affiliate_id, payout_account_id, amount, currency, status, period, ...)
payout_accounts       (id, affiliate_id, provider, account_name, is_default, is_verified, ...)
payout_settings       (id, min_payout_amount, default_provider, auto_approve_earnings, ...)
admins                (id, user_id, email, role, ...)
security_audit_logs   (id, user_id, action, resource_type, ip_address, ...)
webhook_events        (id, idempotency_key, event_type, payload, processed, ...)

-- Key RLS helper
SELECT get_my_affiliate_id();  -- returns current user's affiliate id

-- Key RPC functions
SELECT * FROM request_payout(p_affiliate_id := 'uuid', p_amount := 100.00);  -- atomic balance check + insert
```

---

## 9. Environment Variables Required
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
APP_URL                   (required in production)
NEXT_PUBLIC_APP_URL       (client-accessible variant — should match APP_URL)
ADMIN_EMAILS              (comma-separated admin email list)
WALLET_WEBHOOK_SECRET     (shared secret for wallet webhook auth)
STRIPE_SECRET_KEY         (for payout Stripe Connect)
MERCURY_API_TOKEN         (Mercury bank API for payout tracking)
MERCURY_ACCOUNT_ID        (Mercury bank account)
CRON_SECRET               (auth for cron job endpoints)
```
