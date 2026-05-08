# Affiliate /tools Tab — Design

**Date:** 2026-05-08
**Status:** Design approved, ready for implementation plan
**Approach:** A — one-shot consolidated build

## Problem

The affiliate dashboard has no central place for promotional materials. The existing `/dashboard/referral-link` page covers the share link + QR but misses everything else affiliates need: brand assets, tutorial videos for their leads, FAQs, code of conduct, and pre-written social copy. The `Affiliate Content Package/` directory now contains these materials but they're not exposed to users.

## Goal

A single `/dashboard/tools` tab that consolidates **share assets** (referral link/QR + social copy library) and a **resource library** (videos, PDFs, brand assets), backed by an admin CMS so content can be added without deploys.

## Architecture

### Routes

| Route | Type | Purpose |
|---|---|---|
| `/dashboard/tools` | new | affiliate-facing, sub-tabbed (`?tab=share\|resources`), default `share` |
| `/demo/tools` | new | public demo mirror with mock data |
| `/admin/resources` | new | CRUD for resource library |
| `/admin/share-templates` | new | CRUD for social copy templates |
| `/dashboard/referral-link` | modified | server `redirect("/dashboard/tools?tab=share")` |
| `/demo/referral-link` | modified | server `redirect("/demo/tools?tab=share")` |

### Sidebar

Replace the existing `Referral Links` nav item with `Tools` (same slot order). Admin sidebar gets two new entries: `Resources` and `Share Templates`.

### Render strategy

Server components fetch resources + templates + affiliate context (for `{{referral_link}}` interpolation) and pass to a client tab router. `force-dynamic` per project convention. Tab selection lives in the URL via `?tab=`, no client state library.

## Data model

Two new tables. Both are pure content metadata — no per-affiliate state.

### `affiliate_resources`

```sql
id              uuid primary key default gen_random_uuid()
title           text not null
description     text
kind            text not null              -- 'video' | 'pdf' | 'image' | 'archive'
category        text not null              -- 'onboarding' | 'tutorial' | 'brand' | 'compliance' | 'guide'
storage_path    text not null unique       -- 'videos/verify_identity.mp4'
public_url      text not null
thumbnail_path  text
file_size_bytes bigint
duration_seconds int                       -- videos only
sort_order      int not null default 0
is_published    boolean not null default true
created_at      timestamptz not null default now()
updated_at      timestamptz not null default now()
```
Index: `(is_published, category, sort_order)`.

### `affiliate_share_templates`

```sql
id           uuid primary key default gen_random_uuid()
title        text not null
platform     text not null                 -- 'instagram' | 'twitter' | 'linkedin' | 'general'
category     text not null                 -- 'intro' | 'case-study' | 'promo' | 'follow-up'
body         text not null                 -- contains {{referral_link}}, {{agent_name}}, {{business_name}}
sort_order   int not null default 0
is_published boolean not null default true
created_at   timestamptz not null default now()
updated_at   timestamptz not null default now()
```
Index: `(is_published, platform, sort_order)`.

### RLS

```sql
alter table affiliate_resources         enable row level security;
alter table affiliate_share_templates   enable row level security;

create policy resources_read_published on affiliate_resources
  for select using (is_published = true);

create policy templates_read_published on affiliate_share_templates
  for select using (is_published = true);

-- writes: service role only (no policy = denied to anon/authenticated)
```

### Variable substitution

Tiny helper at `src/lib/template-vars.ts`:

```ts
export const TEMPLATE_VARS = ["referral_link", "agent_name", "business_name"] as const;
export function interpolate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}
```

The card renders the **interpolated** preview and the Copy button copies the **interpolated** string — what you see is what you paste.

## Storage

Single Supabase Storage bucket: `affiliate-content` (public, 1GB file size limit).

Layout:
```
affiliate-content/
  videos/
    onboarding.mp4
    overview.mp4
    creating_account.mp4
    verify_identity.mp4
    connecting_credit_card.mp4
    depositing_funds.mp4
    moving_funds.mp4
    thumbs/
      <slug>.jpg
  docs/
    creator_playbook.pdf
    affiliate_faqs.pdf
    use_cases.pdf
    code_of_conduct.pdf
  brand/
    brand_kit.pdf
    logo.svg
    logo.png
    icon.svg
    brand_assets.zip
```

Public bucket because these assets are meant to be shared on social. `public_url` column abstracts this — if any asset later needs gating, swap to signed URLs without schema changes.

## Components

```
src/app/dashboard/tools/page.tsx              # server: fetch + auth + affiliate ctx
src/app/dashboard/referral-link/page.tsx      # server: redirect()
src/app/demo/tools/page.tsx                   # server: mock data
src/app/demo/referral-link/page.tsx           # server: redirect()

src/components/tools/ToolsClient.tsx          # client: tab router (?tab=)
src/components/tools/ShareTab.tsx             # link/QR + copy library
src/components/tools/ResourcesTab.tsx         # video grid + docs + brand assets
src/components/tools/ReferralLinkCard.tsx     # extracted from existing component
src/components/tools/SocialCopyCard.tsx       # one template; copy w/ interpolation
src/components/tools/SocialCopyFilter.tsx     # platform pills
src/components/tools/VideoCard.tsx            # inline <video> w/ poster
src/components/tools/ResourceCard.tsx         # PDFs/zips/images

src/components/admin/AdminResources.tsx       # CRUD list + drawer form
src/components/admin/AdminShareTemplates.tsx  # CRUD list + drawer form
src/app/admin/resources/page.tsx
src/app/admin/share-templates/page.tsx

src/lib/template-vars.ts                      # interpolate() + var registry
src/lib/affiliate-resources.ts                # server fetch helpers
src/types/database.ts                         # add AffiliateResource, ShareTemplate
```

### ShareTab layout

- Top: `ReferralLinkCard` (link + QR + copy buttons)
- Below: `SocialCopyFilter` row (All • Instagram • X • LinkedIn • General) and a `SocialCopyCard` grid (2-col desktop, 1-col mobile). Each card shows interpolated preview, platform + category badges, **Copy** button.

### ResourcesTab layout

Three section headings, each a labeled grid:
1. **Tutorial Videos** — `VideoCard` × 7 (the 6 unpacked tutorials + onboarding)
2. **Documents** — `ResourceCard` × 4 (Creator Playbook, FAQs, Use Cases, Code of Conduct)
3. **Brand Assets** — `ResourceCard` × N (logo SVG/PNG, icon, brand kit PDF) + "Download all (zip)" link

Sections are rendered from `groupBy(category)` so a new category becomes a new section automatically.

### Mobile

- Sub-tabs collapse to a full-width pill row at top.
- Resource grids: 1-col under sm, 2-col md, 3-col lg.
- `<video preload="metadata" poster={thumbnail} controls>` — plays inline, no autoplay.

## Asset upload pipeline

Two scripts, both gated on `SUPABASE_SERVICE_ROLE_KEY`.

### `scripts/upload-affiliate-content.ts`

1. Reads from `Affiliate Content Package/` (gitignored).
2. Unzips `How to Use Kashu.zip` and `Brand Assets.zip` to `Affiliate Content Package/_unpacked/` (gitignored).
3. Ensures `affiliate-content` bucket exists.
4. Uploads each file via `supabase.storage.from("affiliate-content").upload(path, buffer, { upsert: true })`.
5. Generates video thumbnails via local `ffmpeg -ss 00:00:02 -vframes 1` (skip with warning if not installed).
6. Upserts into `affiliate_resources` keyed on `storage_path`.
7. Logs "skip (already uploaded)" when size matches — re-runs are cheap.

### `scripts/seed-share-templates.ts`

Upserts ~8–12 starter templates (3 platforms × 3-4 categories), keyed on `title + platform`. Edit/expand from admin UI after.

### Run

```bash
npx tsx scripts/upload-affiliate-content.ts
npx tsx scripts/seed-share-templates.ts
```

## Admin CMS

Pattern matches existing admin pages (light theme, white cards, server fetch + service client, drawer edit forms).

### `/admin/resources`

- Columns: Thumbnail • Title • Kind • Category • Size • Order • Published • Actions
- **+ Add resource** → slide-over drawer with file uploader (writes `storage_path` + `public_url`), thumbnail uploader, kind/category selects, sort_order, published toggle
- Per-row: edit, toggle published, sort_order via number input

### `/admin/share-templates`

- Columns: Title • Platform • Category • Body preview (first 80 chars) • Order • Published • Actions
- **+ Add template** → drawer with title, platform select, category select, body textarea, variable picker chips (`{{referral_link}}`, `{{agent_name}}`, `{{business_name}}`) that insert at cursor, live interpolation preview pane

### Server actions

- `src/app/admin/resources/_actions.ts` — `createResource`, `updateResource`, `deleteResource`, `uploadFile`
- `src/app/admin/share-templates/_actions.ts` — `createTemplate`, `updateTemplate`, `deleteTemplate`

All gated by `isAdminEmail(user.email)` server-side.

### Out of v1

- Image cropping / video transcoding in admin
- Per-tier or per-affiliate template visibility
- Copy analytics (which templates get copied most)
- Bulk CSV import

## Testing & rollout

### Pre-deploy verification (per CLAUDE.md §4C)

- `npx tsc --noEmit` clean
- `npm run build` clean
- Manual smoke on `npm run dev`:
  - `/dashboard/tools` default tab renders link/QR/copy cards with interpolation
  - `/dashboard/tools?tab=resources` renders all 3 sections; video plays inline; PDF opens in new tab; zip downloads
  - `/dashboard/referral-link` redirects to `/dashboard/tools?tab=share`
  - `/demo/tools` works without auth
  - `/admin/resources` and `/admin/share-templates` CRUD round-trips work
  - Mobile viewport behaves

### Data verification post-upload

- `select count(*), category from affiliate_resources group by category` matches manifest
- Every `public_url` returns 200 with correct mime
- Total bucket size sanity-check (~1.3GB after unpacking)

### Rollout sequence

1. **Migration PR**: tables + RLS only (zero user-visible change). Deploy, confirm RLS via SQL.
2. **Upload step**: run scripts locally against prod Supabase; verify rows + URLs.
3. **Feature PR**: routes, components, admin pages, redirects, sidebar swap. Single deploy flips it on.

No feature flag — admin pages admin-gated, affiliate page auth-gated, migration is additive. To hide problematic content post-deploy, flip `is_published = false` in admin (no redeploy).

## Risks

- **Asset upload is the slow step** — ~1.3GB through residential upload could take 30+ min. Run during a quiet window. Script is resumable.
- **Public bucket** — by design (assets are shared on social anyway). Schema supports a future swap to signed URLs without migration.
- **Redirect must ship with sidebar swap** — otherwise a user clicking the cached "Referral Links" item hits a redirect during the gap.

## Decisions captured (from brainstorm)

| Question | Decision |
|---|---|
| Tab purpose | Both library + active toolkit |
| Asset hosting | Supabase Storage (public bucket) |
| Content management | DB-backed with admin UI |
| Toolkit features in v1 | Social media copy library only (no email templates, no share buttons, no banner generator) |
| Referral Links overlap | Subsume into /tools, redirect old URL |
| Page layout | Sub-tabs (Share \| Resources) |
| Copy library structure | DB-backed with auto variable injection |
| Demo mirror | Yes, /demo/tools at parity |
| Asset packaging | Unpack everything; expose individual files |
| Approach | A — one-shot consolidated build |
