-- 020_payment_batches.sql
-- Adds batch metadata to payouts + payout_id FK on earnings for the
-- AM→Finance review flow. Status CHECK is extended to allow the new
-- pending_review and rejected values.

alter table public.payouts
  add column if not exists batch_id      uuid,
  add column if not exists submitted_by  text,
  add column if not exists submitted_at  timestamptz,
  add column if not exists reviewed_by   text,
  add column if not exists reviewed_at   timestamptz,
  add column if not exists review_notes  text;

create index if not exists payouts_batch_id_idx on public.payouts (batch_id);

alter table public.payouts drop constraint if exists payouts_status_check;
alter table public.payouts add constraint payouts_status_check check (
  status in ('pending_review','requested','processing','completed','failed','rejected')
);

alter table public.earnings
  add column if not exists payout_id uuid references public.payouts(id) on delete set null;

create index if not exists earnings_payout_id_idx on public.earnings (payout_id);
