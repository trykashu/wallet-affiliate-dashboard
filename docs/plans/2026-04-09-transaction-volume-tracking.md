# Transaction Volume Tracking — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Sync User Transactions from Airtable's Customer Success HQ to track referred transaction volume, compute affiliate earnings, and update affiliate volume totals for tier progression.

**Architecture:** A new sync route fetches the User Transactions table from Airtable, matches transactions to referred users via the Launch List link, resolves the affiliate via the Referrer lookup field, and upserts transaction data + creates earnings. A new `transactions` DB table stores per-transaction records for volume tracking. The existing `referred_users.first_transaction_*` fields and `affiliates.referred_volume_total` are updated from this data.

**Tech Stack:** Next.js API routes, Supabase Postgres, Airtable REST API, existing `@/lib/airtable` helper

---

## Data Flow

```
Airtable: User Transactions
  → has Launch List Link (record ID)
  → Launch List record has Referrer (affiliate attribution_id)
  → Match Referrer → affiliates.attribution_id → affiliate_id
  → Upsert transaction into new `transactions` table
  → Update referred_users (first_transaction_amount, status_slug)
  → Update affiliates.referred_volume_total (sum of all Transfer In amounts)
  → Create earning if first Transfer In for that user
```

## Airtable Details

- **Base:** `appLArFbRFtS24TlZ` (Customer Success HQ) — same env var as Launch List: `AIRTABLE_LAUNCH_BASE`
- **Table:** `tblyWtDBeiZAqDm8P` (User Transactions)
- **Fields:** Name, Launch List Link, Amount, Transaction ID, Date Txn Started, Email (lookup), Assignee (lookup), Referrer (lookup), Transaction Type
- **Earning-relevant:** Only `Transfer In` transactions count toward volume and commissions
- **Referrer field:** Lookup from Launch List — contains the affiliate's attribution_id (or business name). May be an array since it's a lookup field.

---

### Task 1: Database Migration — Add `transactions` Table

**Files:**
- Create: `supabase/migrations/002_transactions_table.sql`

**Step 1: Write the migration**

```sql
-- Transactions table — stores individual user transactions from Airtable
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referred_user_id UUID REFERENCES referred_users(id) ON DELETE SET NULL,
  affiliate_id UUID REFERENCES affiliates(id) ON DELETE SET NULL,
  airtable_record_id TEXT UNIQUE NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  transaction_type TEXT NOT NULL,
  transaction_external_id TEXT,
  transaction_date TIMESTAMPTZ,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "transactions_select_own" ON transactions
  FOR SELECT USING (affiliate_id = public.get_my_affiliate_id());

-- Indexes
CREATE INDEX idx_transactions_affiliate_id ON transactions(affiliate_id);
CREATE INDEX idx_transactions_referred_user_id ON transactions(referred_user_id);
CREATE INDEX idx_transactions_airtable_record_id ON transactions(airtable_record_id);
```

**Step 2: Push the migration**

```bash
export SUPABASE_ACCESS_TOKEN=sbp_4ccb030a750b69f8fb2ffbeac96ee0ff09969c75
npx supabase db push --linked
```

**Step 3: Update TypeScript types**

Add to `src/types/database.ts`:

```typescript
export interface Transaction {
  id: string;
  referred_user_id: string | null;
  affiliate_id: string | null;
  airtable_record_id: string;
  amount: number;
  transaction_type: string;
  transaction_external_id: string | null;
  transaction_date: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
}
```

Add to `Database.public.Tables`:
```typescript
transactions: { Row: Transaction; Insert: Partial<Transaction>; Update: Partial<Transaction> };
```

**Step 4: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 5: Commit**

```bash
git add supabase/migrations/002_transactions_table.sql src/types/database.ts
git commit -m "feat: add transactions table for volume tracking"
```

---

### Task 2: Transaction Sync Route

**Files:**
- Create: `src/app/api/sync/transactions/route.ts`

**Step 1: Read existing sync patterns**

Read these files for reference:
- `/Users/milespietsch/Desktop/Claude/Workspace/wallet-affiliate-dashboard/src/lib/airtable.ts` — pagination helper
- `/Users/milespietsch/Desktop/Claude/Workspace/wallet-affiliate-dashboard/src/app/api/sync/users/route.ts` — affiliate matching pattern

**Step 2: Write the sync route**

GET endpoint that:

1. Fetches all records from User Transactions table (`tblyWtDBeiZAqDm8P`) in base `AIRTABLE_LAUNCH_BASE`
2. Pre-loads all affiliates into a lookup map (lowercase `attribution_id` → affiliate row) — reuse pattern from HighLevel sync
3. Pre-loads all referred_users into a lookup map (by `email` and `wallet_user_id`) for matching
4. For each transaction record:
   a. Extract `Referrer` field (it's a lookup array — take first value)
   b. If no Referrer, skip
   c. Match Referrer → affiliate by `attribution_id` (exact match), then fallback to `business_name` or `agent_name` (case-insensitive)
   d. Match user via `Email` lookup field → referred_users.email, OR via Launch List Link → referred_users with matching airtable origin
   e. Determine `transaction_type` — only `Transfer In` counts for volume/earnings
   f. Upsert into `transactions` table (onConflict: `airtable_record_id`)
5. After all transactions upserted:
   a. For each affiliate, compute total `Transfer In` volume from `transactions` table → update `affiliates.referred_volume_total`
   b. For each referred_user with a `Transfer In` transaction and no `first_transaction_at`, set `first_transaction_amount`, `first_transaction_fee` (Kashu's fee portion), `first_transaction_at`, and advance `status_slug` to `transaction_run` if currently earlier
   c. Check tier upgrades: if affiliate volume >= $250K and tier is gold and not overridden → upgrade to platinum + notify
   d. Create earnings for first `Transfer In` per user (if earning doesn't already exist)

**Earning calculation:**
```typescript
// Kashu's fee on the transaction (e.g., 1.5% take rate)
const KASHU_TAKE_RATE = 0.015;
const transactionFee = amount * KASHU_TAKE_RATE;
const earning = calculateEarning(transactionFee, affiliate.tier);
```

**Response format:**
```json
{
  "success": true,
  "total_fetched": 27,
  "with_referrer": 15,
  "matched_to_affiliate": 12,
  "upserted": 12,
  "volume_updates": 8,
  "earnings_created": 5,
  "tier_upgrades": 0
}
```

**Step 3: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 4: Commit**

```bash
git add src/app/api/sync/transactions/route.ts
git commit -m "feat: add transaction sync from Airtable User Transactions table"
```

---

### Task 3: Add Transaction Sync to Cron

**Files:**
- Modify: `src/app/api/cron/sync-airtable/route.ts`

**Step 1: Read the existing cron route**

It currently runs 3 syncs in order:
1. Affiliates from Airtable
2. Users from Airtable Launch List
3. Users from HighLevel

**Step 2: Add Step 4: Transaction sync**

After HighLevel sync, add:
```typescript
// Step 4: Sync transactions from Airtable
const txnRes = await fetch(`${baseUrl}/api/sync/transactions`);
const txnData = await txnRes.json();
```

Same error handling pattern — non-fatal, logs error but doesn't fail the cron.

**Step 3: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 4: Commit**

```bash
git add src/app/api/cron/sync-airtable/route.ts
git commit -m "feat: add transaction sync to daily cron"
```

---

### Task 4: Dashboard Volume Display

**Files:**
- Modify: `src/app/dashboard/page.tsx` — add volume stat to hero or stats row
- Modify: `src/components/dashboard/StatsRow.tsx` — optionally add volume as 5th stat or replace one
- Modify: `src/components/dashboard/EarningsCard.tsx` — show volume with tier progress

**Step 1: Read current components**

Read the StatsRow and EarningsCard to understand the current layout.

**Step 2: Update EarningsCard with volume tracking**

The EarningsCard already shows volume-to-Platinum progress when tier is gold. Ensure it uses the real `referred_volume_total` from the affiliate record (which is now updated by the transaction sync).

**Step 3: Add transaction volume to the overview page**

In the dashboard page, query total `Transfer In` volume for the affiliate from the `transactions` table. Display it in the hero quick-stats glass cards or add to StatsRow. Show as `fmt.currencyCompact()` (e.g., "$45.2K").

**Step 4: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 5: Commit**

```bash
git add src/app/dashboard/page.tsx src/components/dashboard/StatsRow.tsx src/components/dashboard/EarningsCard.tsx
git commit -m "feat: display transaction volume on dashboard"
```

---

### Task 5: Admin Transaction Visibility

**Files:**
- Create: `src/app/admin/transactions/page.tsx`
- Create: `src/components/admin/TransactionTable.tsx`
- Modify: `src/app/admin/layout.tsx` — add nav item
- Modify: `src/components/ui/PageTitle.tsx` — add route metadata

**Step 1: Create TransactionTable component**

Client component showing all transactions with columns:
- Date (`fmt.date()`)
- User Email
- Affiliate Name (from join)
- Amount (`fmt.currency()`)
- Type (Transfer In / Transfer Out badge)
- Transaction ID

Features: search by email, filter by type, filter by affiliate, sort by date.

**Step 2: Create admin transactions page**

Server component using service client to query all transactions with affiliate and referred_user joins.

**Step 3: Add to admin nav**

Add "Transactions" nav item to the admin layout sidebar (between Users and Funnel). Add route metadata to PageTitle.

**Step 4: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 5: Commit**

```bash
git add src/app/admin/transactions/ src/components/admin/TransactionTable.tsx src/app/admin/layout.tsx src/components/ui/PageTitle.tsx
git commit -m "feat: add admin transactions page"
```

---

### Task 6: Deploy and Test Sync

**Step 1: Add env var if needed**

The User Transactions table is in the same base as Launch List (`AIRTABLE_LAUNCH_BASE`). No new env var needed — just need a new constant for the table ID.

Add to the sync route: `const TRANSACTIONS_TABLE = 'tblyWtDBeiZAqDm8P'` (hardcoded, or use a new env var `AIRTABLE_TRANSACTIONS_TABLE`).

**Step 2: Push and deploy**

```bash
git push origin main
vercel --prod --yes
```

**Step 3: Test the sync**

```bash
curl -s https://wallet-affiliate-dashboard.vercel.app/api/sync/transactions | python3 -m json.tool
```

Expect: transactions fetched, 0 matched (since Referrer is not yet populated in Airtable). Once Referrer values appear in the Launch List records, transactions linked to those users will match.

**Step 4: Verify admin page**

Visit `/admin/transactions` to confirm the table renders.

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | DB migration — `transactions` table + types | migration SQL + database.ts |
| 2 | Transaction sync route | new API route |
| 3 | Add to daily cron | cron route update |
| 4 | Dashboard volume display | page.tsx + StatsRow + EarningsCard |
| 5 | Admin transactions page | new page + component + nav |
| 6 | Deploy and test | push + verify |

**Total: 6 tasks.** The sync route (Task 2) is the core work. Everything else is wiring it into the existing dashboard.
