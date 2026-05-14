-- 021_payout_account_address.sql
-- Adds the recipient mailing address fields to payout_accounts so we stop
-- using Kashu's address on every Mercury recipient. Fields are nullable to
-- avoid breaking existing rows; backfill script runs after this migration.

alter table public.payout_accounts
  add column if not exists address1     text,
  add column if not exists address2     text,
  add column if not exists city         text,
  add column if not exists region       text,
  add column if not exists postal_code  text,
  add column if not exists country      text default 'US';
