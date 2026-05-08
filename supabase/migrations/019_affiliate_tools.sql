-- 019_affiliate_tools.sql
-- Adds affiliate_resources (downloadable/viewable assets) and
-- affiliate_share_templates (social copy library) for the /tools tab.

create table if not exists public.affiliate_resources (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  description      text,
  kind             text not null check (kind in ('video','pdf','image','archive')),
  category         text not null check (category in ('onboarding','tutorial','brand','compliance','guide')),
  storage_path     text not null unique,
  public_url       text not null,
  thumbnail_path   text,
  file_size_bytes  bigint,
  duration_seconds int,
  sort_order       int not null default 0,
  is_published     boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists affiliate_resources_published_idx
  on public.affiliate_resources (is_published, category, sort_order);

create table if not exists public.affiliate_share_templates (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  platform     text not null check (platform in ('instagram','twitter','linkedin','general')),
  category     text not null check (category in ('intro','case-study','promo','follow-up')),
  body         text not null,
  sort_order   int not null default 0,
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists affiliate_share_templates_published_idx
  on public.affiliate_share_templates (is_published, platform, sort_order);

alter table public.affiliate_resources         enable row level security;
alter table public.affiliate_share_templates   enable row level security;

drop policy if exists resources_read_published on public.affiliate_resources;
create policy resources_read_published on public.affiliate_resources
  for select to authenticated using (is_published = true);

drop policy if exists templates_read_published on public.affiliate_share_templates;
create policy templates_read_published on public.affiliate_share_templates
  for select to authenticated using (is_published = true);
