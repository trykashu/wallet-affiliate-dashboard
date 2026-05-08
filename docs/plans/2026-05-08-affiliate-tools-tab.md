# Affiliate /tools Tab Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a unified `/dashboard/tools` tab with Share + Resources sub-tabs, subsume the existing `/referral-link` route, back it with two new Supabase tables and a Storage bucket of unpacked content from `Affiliate Content Package/`, and ship admin CMS pages for both libraries.

**Architecture:** Server components fetch resources + share templates + affiliate context and pass them to a client tab router (`?tab=` URL state). Two new tables (`affiliate_resources`, `affiliate_share_templates`) under RLS; assets live in a public `affiliate-content` Supabase Storage bucket and are uploaded once via `scripts/upload-affiliate-content.ts`. Admin CRUD via server actions gated by `isAdminEmail`.

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres + Storage), TypeScript, Tailwind. No test framework in this repo — verification is `npx tsc --noEmit` + `npm run build` + manual smoke (per CLAUDE.md §4C). Pure functions get ad-hoc `node -e` verification.

**Reference design:** [docs/plans/2026-05-08-affiliate-tools-tab-design.md](./2026-05-08-affiliate-tools-tab-design.md)

---

## Phase 0 — Database & types

### Task 1: Create migration

**Files:**
- Create: `supabase/migrations/019_affiliate_tools.sql`

**Step 1: Write the migration**

```sql
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

create or replace function public.set_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

drop trigger if exists set_updated_at on public.affiliate_resources;
create trigger set_updated_at before update on public.affiliate_resources
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.affiliate_share_templates;
create trigger set_updated_at before update on public.affiliate_share_templates
  for each row execute function public.set_updated_at();

alter table public.affiliate_resources         enable row level security;
alter table public.affiliate_share_templates   enable row level security;

drop policy if exists resources_read_published on public.affiliate_resources;
create policy resources_read_published on public.affiliate_resources
  for select to authenticated using (is_published = true);

drop policy if exists templates_read_published on public.affiliate_share_templates;
create policy templates_read_published on public.affiliate_share_templates
  for select to authenticated using (is_published = true);
```

**Step 2:** Apply via the Supabase SQL editor (project convention — paste-and-run; CLI migrations aren't wired here).

**Step 3:** Verify in SQL editor:
```sql
select tablename, rowsecurity from pg_tables
 where schemaname='public' and tablename in ('affiliate_resources','affiliate_share_templates');
select count(*) from public.affiliate_resources;
select count(*) from public.affiliate_share_templates;
```
Expected: 2 rows with `rowsecurity = true`; both counts = 0.

**Step 4: Commit**
```bash
git add supabase/migrations/019_affiliate_tools.sql
git commit -m "feat(db): add affiliate_resources + affiliate_share_templates tables"
```

---

### Task 2: TypeScript types

**Files:** Modify `src/types/database.ts` — append:

```ts
export interface AffiliateResource {
  id: string;
  title: string;
  description: string | null;
  kind: "video" | "pdf" | "image" | "archive";
  category: "onboarding" | "tutorial" | "brand" | "compliance" | "guide";
  storage_path: string;
  public_url: string;
  thumbnail_path: string | null;
  file_size_bytes: number | null;
  duration_seconds: number | null;
  sort_order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export interface ShareTemplate {
  id: string;
  title: string;
  platform: "instagram" | "twitter" | "linkedin" | "general";
  category: "intro" | "case-study" | "promo" | "follow-up";
  body: string;
  sort_order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}
```

Verify: `npx tsc --noEmit` clean.
Commit: `git add src/types/database.ts && git commit -m "feat(types): add AffiliateResource and ShareTemplate"`

---

## Phase 1 — Helpers

### Task 3: `interpolate()` helper

**Files:** Create `src/lib/template-vars.ts`:

```ts
export const TEMPLATE_VARS = ["referral_link", "agent_name", "business_name"] as const;
export type TemplateVar = (typeof TEMPLATE_VARS)[number];
export type TemplateVarValues = Partial<Record<TemplateVar, string>>;

export function interpolate(body: string, vars: TemplateVarValues): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k as TemplateVar];
    return v ?? `{{${k}}}`;
  });
}
```

Ad-hoc verify:
```bash
npx tsx -e "import('./src/lib/template-vars.ts').then(m => {
  const out = m.interpolate('Hi {{agent_name}}, share {{referral_link}}', { agent_name: 'Alex', referral_link: 'https://k.sh/x' });
  if (out !== 'Hi Alex, share https://k.sh/x') process.exit(1);
  console.log('OK');
})"
```
Expected: `OK`.

Commit: `git add src/lib/template-vars.ts && git commit -m "feat(lib): add interpolate() template variable helper"`

---

### Task 4: `fmt.bytes()`

**Files:** Modify `src/lib/fmt.ts` — add inside the `fmt` object:

```ts
  /** 1.2 MB / 740.0 MB / 1.3 GB */
  bytes: (n: number | null | undefined) => {
    if (n == null) return "—";
    if (n < 1024) return `${n} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    return `${(n / 1024 ** 3).toFixed(2)} GB`;
  },
```

Verify: `npx tsc --noEmit`.
Commit: `git add src/lib/fmt.ts && git commit -m "feat(fmt): add fmt.bytes() helper"`

---

### Task 5: Server fetch helpers

**Files:** Create `src/lib/affiliate-resources.ts`:

```ts
import { createServiceClient } from "@/lib/supabase/service";
import type { AffiliateResource, ShareTemplate } from "@/types/database";

export async function fetchPublishedResources(): Promise<AffiliateResource[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { data, error } = await db
    .from("affiliate_resources")
    .select("*")
    .eq("is_published", true)
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data as AffiliateResource[];
}

export async function fetchPublishedShareTemplates(): Promise<ShareTemplate[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { data, error } = await db
    .from("affiliate_share_templates")
    .select("*")
    .eq("is_published", true)
    .order("platform", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data as ShareTemplate[];
}
```

Verify: `npx tsc --noEmit`.
Commit: `git add src/lib/affiliate-resources.ts && git commit -m "feat(lib): add resource + template fetchers"`

---

## Phase 2 — Asset upload pipeline

### Task 6: Create `affiliate-content` bucket

In Supabase dashboard → Storage → New bucket: name `affiliate-content`, **public**, file size limit `1024 MB`, no MIME restrictions.

Verify: `select id, name, public from storage.buckets where name='affiliate-content';` → 1 row, `public = true`. (No commit; dashboard config.)

---

### Task 7: Upload script

**Files:**
- Create: `scripts/upload-affiliate-content.ts`
- Modify: `.gitignore` — append `Affiliate Content Package/_unpacked/`

The script uses `execFileSync` (no shell, safer) for `unzip`/`ffmpeg` — passes args as arrays to avoid injection paths.

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
// Uploads "Affiliate Content Package/" to Supabase Storage and upserts
// affiliate_resources rows. Idempotent. Run: npx tsx scripts/upload-affiliate-content.ts
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import "dotenv/config";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\\n|"|\s/g, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/\\n|"|\s/g, "");
if (!URL || !KEY) { console.error("Missing env"); process.exit(1); }

const supa = createClient(URL, KEY, { auth: { persistSession: false } });
const ROOT = resolve("Affiliate Content Package");
const UNPACKED = resolve(ROOT, "_unpacked");
const BUCKET = "affiliate-content";

function unpackZips() {
  if (!existsSync(UNPACKED)) mkdirSync(UNPACKED, { recursive: true });
  for (const z of ["How to Use Kashu.zip", "Brand Assets.zip"]) {
    const src = resolve(ROOT, z);
    const dst = resolve(UNPACKED, z.replace(/\.zip$/, ""));
    if (existsSync(dst)) { console.log(`skip unpack: ${z}`); continue; }
    mkdirSync(dst, { recursive: true });
    console.log(`unzip ${z} ...`);
    execFileSync("unzip", ["-q", src, "-d", dst]);   // execFile: no shell, no injection
  }
}

interface ManifestItem {
  localPath: string;
  storagePath: string;
  title: string;
  description: string | null;
  kind: "video" | "pdf" | "image" | "archive";
  category: "onboarding" | "tutorial" | "brand" | "compliance" | "guide";
  sort_order: number;
  generateThumb?: boolean;
}

const HOW_TO = `${UNPACKED}/How to Use Kashu`;
const BRAND  = `${UNPACKED}/Brand Assets`;

const MANIFEST: ManifestItem[] = [
  { localPath: `${ROOT}/Affiliate Onboarding Video.mp4`, storagePath: "videos/onboarding.mp4",
    title: "Affiliate Onboarding", description: "Welcome video for new Kashu affiliates.",
    kind: "video", category: "onboarding", sort_order: 0, generateThumb: true },
  { localPath: `${HOW_TO}/Overview.mp4`,                storagePath: "videos/overview.mp4",
    title: "Kashu Overview", description: "End-to-end walkthrough of the wallet.",
    kind: "video", category: "tutorial", sort_order: 10, generateThumb: true },
  { localPath: `${HOW_TO}/Creating_Account.mp4`,        storagePath: "videos/creating_account.mp4",
    title: "Creating an Account", description: "Show users how to sign up.",
    kind: "video", category: "tutorial", sort_order: 20, generateThumb: true },
  { localPath: `${HOW_TO}/Verify_Identity.mp4`,         storagePath: "videos/verify_identity.mp4",
    title: "Verifying Identity", description: "Walk through KYC.",
    kind: "video", category: "tutorial", sort_order: 30, generateThumb: true },
  { localPath: `${HOW_TO}/Connecting_Credit_Card.mp4`,  storagePath: "videos/connecting_credit_card.mp4",
    title: "Connecting a Card", description: "Funding via credit card.",
    kind: "video", category: "tutorial", sort_order: 40, generateThumb: true },
  { localPath: `${HOW_TO}/Depositing_Funds.mp4`,        storagePath: "videos/depositing_funds.mp4",
    title: "Depositing Funds", description: "Moving money into the wallet.",
    kind: "video", category: "tutorial", sort_order: 50, generateThumb: true },
  { localPath: `${HOW_TO}/Moving_Funds.mp4`,            storagePath: "videos/moving_funds.mp4",
    title: "Moving Funds", description: "Sending money out.",
    kind: "video", category: "tutorial", sort_order: 60, generateThumb: true },

  { localPath: `${ROOT}/Creator Playbook.pdf`,          storagePath: "docs/creator_playbook.pdf",
    title: "Creator Playbook", description: "Best practices for promoting Kashu.",
    kind: "pdf", category: "guide", sort_order: 10 },
  { localPath: `${ROOT}/Kashu Affiliate FAQ_s.pdf`,     storagePath: "docs/affiliate_faqs.pdf",
    title: "Affiliate FAQs", description: "Common questions, answered.",
    kind: "pdf", category: "guide", sort_order: 20 },
  { localPath: `${ROOT}/Use Cases & Examples.pdf`,      storagePath: "docs/use_cases.pdf",
    title: "Use Cases & Examples", description: "Sample scenarios you can adapt.",
    kind: "pdf", category: "guide", sort_order: 30 },
  { localPath: `${ROOT}/Kashu Affiliate Code of Conduct.pdf`, storagePath: "docs/code_of_conduct.pdf",
    title: "Affiliate Code of Conduct", description: "What we expect from you.",
    kind: "pdf", category: "compliance", sort_order: 10 },

  { localPath: `${ROOT}/Kashu Brand Kit.pdf`,           storagePath: "brand/brand_kit.pdf",
    title: "Brand Kit (PDF)", description: "Logos, colors, type — at a glance.",
    kind: "pdf", category: "brand", sort_order: 10 },
  { localPath: `${BRAND}/Logo files/SVG/Logo.svg`,      storagePath: "brand/logo.svg",
    title: "Logo (SVG)", description: "Vector logo for production design work.",
    kind: "image", category: "brand", sort_order: 20 },
  { localPath: `${ROOT}/Brand Assets.zip`,              storagePath: "brand/brand_assets.zip",
    title: "Brand Assets (full zip)", description: "Everything: logos, icons, renders.",
    kind: "archive", category: "brand", sort_order: 99 },
];

function contentTypeFor(kind: string, path: string): string {
  if (kind === "video") return "video/mp4";
  if (kind === "pdf") return "application/pdf";
  if (kind === "archive") return "application/zip";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function generateThumb(item: ManifestItem): { thumbStoragePath: string; durationSec: number | null } | null {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); }
  catch { console.warn("ffmpeg missing; skip thumb"); return null; }

  const slug = item.storagePath.split("/").pop()!.replace(/\.mp4$/, "");
  const thumbLocal = resolve(UNPACKED, `${slug}.jpg`);
  try {
    execFileSync("ffmpeg",
      ["-y", "-ss", "00:00:02", "-i", item.localPath, "-vframes", "1", "-q:v", "4", thumbLocal],
      { stdio: "ignore" });
  } catch { return null; }

  const thumbStoragePath = `videos/thumbs/${slug}.jpg`;
  const buf = readFileSync(thumbLocal);
  void supa.storage.from(BUCKET).upload(thumbStoragePath, buf, { upsert: true, contentType: "image/jpeg" });

  let durationSec: number | null = null;
  try {
    const out = execFileSync("ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", item.localPath]).toString();
    durationSec = Math.round(parseFloat(out));
  } catch {}
  return { thumbStoragePath, durationSec };
}

async function ensureUploaded(item: ManifestItem) {
  if (!existsSync(item.localPath)) { console.warn(`MISSING ${item.localPath}`); return; }
  const buf = readFileSync(item.localPath);
  const size = statSync(item.localPath).size;

  const dir = item.storagePath.split("/").slice(0, -1).join("/") || "";
  const name = item.storagePath.split("/").pop()!;
  const { data: existing } = await supa.storage.from(BUCKET).list(dir, { search: name });
  const already = existing?.find((f) => f.name === name);
  if (already && (already.metadata as any)?.size === size) {
    console.log(`skip ${item.storagePath} (unchanged)`);
  } else {
    console.log(`upload ${item.storagePath} (${(size/1024/1024).toFixed(1)} MB)`);
    const { error } = await supa.storage.from(BUCKET).upload(item.storagePath, buf, {
      upsert: true, contentType: contentTypeFor(item.kind, item.localPath),
    });
    if (error) throw error;
  }

  let thumbnail_path: string | null = null;
  let duration_seconds: number | null = null;
  if (item.generateThumb) {
    const t = generateThumb(item);
    if (t) { thumbnail_path = t.thumbStoragePath; duration_seconds = t.durationSec; }
  }

  const public_url = supa.storage.from(BUCKET).getPublicUrl(item.storagePath).data.publicUrl;

  const { error: upErr } = await (supa as any)
    .from("affiliate_resources")
    .upsert({
      title: item.title,
      description: item.description,
      kind: item.kind,
      category: item.category,
      storage_path: item.storagePath,
      public_url,
      thumbnail_path,
      file_size_bytes: size,
      duration_seconds,
      sort_order: item.sort_order,
      is_published: true,
    }, { onConflict: "storage_path" });
  if (upErr) throw upErr;
}

(async () => {
  unpackZips();
  for (const item of MANIFEST) await ensureUploaded(item);
  console.log("done");
})().catch((e) => { console.error(e); process.exit(1); });
```

Verify compile: `npx tsc --noEmit`.
Commit: `git add scripts/upload-affiliate-content.ts .gitignore && git commit -m "feat(scripts): upload-affiliate-content pipeline"`

---

### Task 8: Run upload

```bash
set -a; source .env.local; set +a
npx tsx scripts/upload-affiliate-content.ts
```
Expected logs: `unzip ...`, `upload videos/onboarding.mp4 (500.4 MB)`, etc. May take 30+ minutes.

Verify in SQL editor:
```sql
select count(*), category from public.affiliate_resources group by category order by category;
select storage_path, file_size_bytes, public_url from public.affiliate_resources order by category, sort_order;
```
Expected: ≥ 14 rows; spot-check a video URL in the browser — should stream. (No commit; runtime step.)

---

### Task 9: Seed share templates

**Files:** Create `scripts/seed-share-templates.ts`:

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\\n|"|\s/g, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/\\n|"|\s/g, "");
if (!URL || !KEY) { console.error("Missing env"); process.exit(1); }
const supa = createClient(URL, KEY, { auth: { persistSession: false } });

const TEMPLATES = [
  { title: "Intro post — long form",    platform: "linkedin",  category: "intro",
    body: "I've been recommending @Kashu to friends and clients lately — it's the cleanest wallet experience I've used. If you want to give it a try, here's my link: {{referral_link}}",
    sort_order: 10 },
  { title: "Intro post — short",        platform: "twitter",   category: "intro",
    body: "If you want to try a wallet that just works, this is it 👇 {{referral_link}}",
    sort_order: 20 },
  { title: "Instagram caption — intro", platform: "instagram", category: "intro",
    body: "New favorite app drop 🔗 — {{referral_link}}\n\n— {{agent_name}}",
    sort_order: 30 },
  { title: "Case study — testimonial",  platform: "linkedin",  category: "case-study",
    body: "Helped a client move funds in under 5 minutes. {{business_name}} stands behind Kashu — try it: {{referral_link}}",
    sort_order: 40 },
  { title: "Promo — referral nudge",    platform: "general",   category: "promo",
    body: "Thinking about trying Kashu? Use my link and I'll walk you through setup: {{referral_link}}",
    sort_order: 50 },
  { title: "Follow-up — DM",            platform: "general",   category: "follow-up",
    body: "Hey {{agent_name}} here — circling back on the wallet I mentioned. My link: {{referral_link}}",
    sort_order: 60 },
];

(async () => {
  for (const t of TEMPLATES) {
    const { data: existing } = await (supa as any)
      .from("affiliate_share_templates").select("id").eq("title", t.title).limit(1);
    if (existing?.length) continue;
    const { error } = await (supa as any).from("affiliate_share_templates")
      .insert({ ...t, is_published: true });
    if (error) throw error;
  }
  console.log("seeded ok");
})().catch((e) => { console.error(e); process.exit(1); });
```

Run: `npx tsx scripts/seed-share-templates.ts` → expect `seeded ok`.

Verify: `select count(*) from public.affiliate_share_templates;` → ≥ 6.

Commit: `git add scripts/seed-share-templates.ts && git commit -m "feat(scripts): seed initial social copy templates"`

---

## Phase 3 — Affiliate `/dashboard/tools` (Share tab)

### Task 10: `/dashboard/tools/page.tsx`

**Files:** Create `src/app/dashboard/tools/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchPublishedResources, fetchPublishedShareTemplates } from "@/lib/affiliate-resources";
import { getAffiliateContext } from "@/lib/affiliate-context";
import ToolsClient from "@/components/tools/ToolsClient";

export const dynamic = "force-dynamic";

export default async function ToolsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/dashboard");

  const [resources, templates] = await Promise.all([
    fetchPublishedResources(),
    fetchPublishedShareTemplates(),
  ]);

  return (
    <ToolsClient
      affiliate={ctx.affiliate}
      resources={resources}
      templates={templates}
    />
  );
}
```

Quick check on `getAffiliateContext`'s return shape — adjust import/destructuring if needed:
```bash
grep -nE "export (async )?function getAffiliateContext|return\s*\{" src/lib/affiliate-context.ts | head -10
```

Compile will fail until ToolsClient exists — that's the next task. (No commit yet.)

---

### Task 11: `ToolsClient.tsx` tab router + tab placeholders

**Files:**
- Create: `src/components/tools/ToolsClient.tsx`
- Create: `src/components/tools/ShareTab.tsx` (placeholder)
- Create: `src/components/tools/ResourcesTab.tsx` (placeholder)

`ShareTab.tsx`:
```tsx
"use client";
import type { Affiliate, ShareTemplate } from "@/types/database";
export default function ShareTab(_: { affiliate: Affiliate; templates: ShareTemplate[] }) {
  return <div className="card p-6">Share tab — pending implementation.</div>;
}
```

`ResourcesTab.tsx`:
```tsx
"use client";
import type { AffiliateResource } from "@/types/database";
export default function ResourcesTab(_: { resources: AffiliateResource[] }) {
  return <div className="card p-6">Resources tab — pending implementation.</div>;
}
```

`ToolsClient.tsx`:
```tsx
"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import type { Affiliate, AffiliateResource, ShareTemplate } from "@/types/database";
import PageTitle from "@/components/ui/PageTitle";
import ShareTab from "./ShareTab";
import ResourcesTab from "./ResourcesTab";

type Tab = "share" | "resources";

export default function ToolsClient({
  affiliate, resources, templates,
}: {
  affiliate: Affiliate;
  resources: AffiliateResource[];
  templates: ShareTemplate[];
}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab: Tab = params.get("tab") === "resources" ? "resources" : "share";

  const setTab = useCallback((next: Tab) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("tab", next);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }, [params, pathname, router]);

  return (
    <div className="space-y-6">
      <PageTitle title="Tools" subtitle="Everything you need to share Kashu." />
      <div className="flex gap-1 p-1 bg-surface-100 rounded-xl border border-surface-200/60 w-fit">
        <TabButton active={tab === "share"} onClick={() => setTab("share")}>Share</TabButton>
        <TabButton active={tab === "resources"} onClick={() => setTab("resources")}>Resources</TabButton>
      </div>
      {tab === "share"
        ? <ShareTab affiliate={affiliate} templates={templates} />
        : <ResourcesTab resources={resources} />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
        active ? "bg-white text-gray-900 shadow-card" : "text-brand-400 hover:text-gray-900"
      }`}>{children}</button>
  );
}
```

Verify: `npx tsc --noEmit && npm run build`. Visit `/dashboard/tools` — placeholder tabs render.
Commit: `git add src/app/dashboard/tools/page.tsx src/components/tools/ && git commit -m "feat(tools): scaffold /dashboard/tools page with tab router"`

---

### Task 12: Move `ReferralLinkCard` into `tools/`

Read the existing card first: `wc -l src/components/dashboard/ReferralLinkCard.tsx`. If it's a self-contained component (<300 lines), copy it to `src/components/tools/ReferralLinkCard.tsx` with no logic changes. Don't delete the old file yet — it may still be referenced by the redirect-bound page until Task 22.

Verify: `npx tsc --noEmit`.
Commit: `git add src/components/tools/ReferralLinkCard.tsx && git commit -m "feat(tools): copy ReferralLinkCard into tools/"`

---

### Task 13: `SocialCopyCard.tsx`

**Files:** Create `src/components/tools/SocialCopyCard.tsx`:

```tsx
"use client";
import { useState } from "react";
import type { ShareTemplate } from "@/types/database";
import { interpolate, type TemplateVarValues } from "@/lib/template-vars";

export default function SocialCopyCard({
  template, vars,
}: { template: ShareTemplate; vars: TemplateVarValues }) {
  const [copied, setCopied] = useState(false);
  const interpolated = interpolate(template.body, vars);

  async function copy() {
    await navigator.clipboard.writeText(interpolated);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">{template.title}</h3>
        <span className={badgeClass(template.platform)}>{platformLabel(template.platform)}</span>
      </div>
      <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{interpolated}</p>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">
          {template.category.replace("-", " ")}
        </span>
        <button onClick={copy} className="btn-accent text-xs px-3 py-1.5 rounded-lg">
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function platformLabel(p: ShareTemplate["platform"]) {
  return p === "twitter" ? "X" : p[0].toUpperCase() + p.slice(1);
}
function badgeClass(p: ShareTemplate["platform"]) {
  const base = "text-[10px] font-semibold px-2 py-0.5 rounded-full border";
  if (p === "instagram") return `${base} text-pink-700 bg-pink-50 border-pink-200`;
  if (p === "twitter")   return `${base} text-gray-900 bg-gray-100 border-gray-200`;
  if (p === "linkedin")  return `${base} text-sky-700 bg-sky-50 border-sky-200`;
  return `${base} text-brand-400 bg-surface-100 border-surface-200`;
}
```

Verify: `npx tsc --noEmit`.
Commit: `git add src/components/tools/SocialCopyCard.tsx && git commit -m "feat(tools): SocialCopyCard with interpolation"`

---

### Task 14: `SocialCopyFilter.tsx`

**Files:** Create `src/components/tools/SocialCopyFilter.tsx`:

```tsx
"use client";
import type { ShareTemplate } from "@/types/database";

type Platform = ShareTemplate["platform"] | "all";
const PLATFORMS: Platform[] = ["all", "instagram", "twitter", "linkedin", "general"];

export default function SocialCopyFilter({
  value, onChange,
}: { value: Platform; onChange: (p: Platform) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PLATFORMS.map((p) => (
        <button key={p} onClick={() => onChange(p)}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
            value === p
              ? "bg-brand-600 text-white border-brand-700"
              : "bg-white text-brand-400 border-gray-200 hover:text-gray-900"
          }`}>
          {label(p)}
        </button>
      ))}
    </div>
  );
}
function label(p: Platform) {
  if (p === "all") return "All";
  if (p === "twitter") return "X";
  return p[0].toUpperCase() + p.slice(1);
}
```

Verify: `npx tsc --noEmit`.
Commit: `git add src/components/tools/SocialCopyFilter.tsx && git commit -m "feat(tools): platform filter pills"`

---

### Task 15: Wire `ShareTab.tsx`

Replace `src/components/tools/ShareTab.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { Affiliate, ShareTemplate } from "@/types/database";
import ReferralLinkCard from "./ReferralLinkCard";
import SocialCopyCard from "./SocialCopyCard";
import SocialCopyFilter from "./SocialCopyFilter";

type Platform = ShareTemplate["platform"] | "all";

function buildLink(a: Affiliate): string {
  // Mirror whatever ReferralLinkCard already does. If it has its own helper,
  // import that instead of duplicating. Otherwise, inline the same logic here.
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const id = a.attribution_id ?? a.id;
  return `${base}/r/${id}`;
}

export default function ShareTab({
  affiliate, templates,
}: { affiliate: Affiliate; templates: ShareTemplate[] }) {
  const [platform, setPlatform] = useState<Platform>("all");
  const referralLink = useMemo(() => buildLink(affiliate), [affiliate]);
  const vars = useMemo(() => ({
    referral_link: referralLink,
    agent_name: affiliate.agent_name,
    business_name: affiliate.business_name ?? "",
  }), [referralLink, affiliate]);
  const filtered = useMemo(
    () => platform === "all" ? templates : templates.filter((t) => t.platform === platform),
    [platform, templates],
  );

  return (
    <div className="space-y-6">
      <ReferralLinkCard affiliate={affiliate} />

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-brand-400 uppercase tracking-wider">Social Copy</h2>
          <span className="text-xs text-brand-400 tabular-nums">{filtered.length} templates</span>
        </div>
        <SocialCopyFilter value={platform} onChange={setPlatform} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((t) => <SocialCopyCard key={t.id} template={t} vars={vars} />)}
        </div>
        {filtered.length === 0 && (
          <div className="card p-8 text-center text-sm text-brand-400">
            No templates for this platform yet.
          </div>
        )}
      </section>
    </div>
  );
}
```

**Important:** `buildLink` in this file is a placeholder. Before committing, search the existing `ReferralLinkCard` for its link-construction logic and either:
- (Preferred) factor it into `src/lib/referral-link.ts` as `buildReferralLink(a: Affiliate): string`, then import in both places
- Or copy its exact logic into `buildLink` here

```bash
grep -n "attribution_id\|/r/\|referral" src/components/tools/ReferralLinkCard.tsx | head
```

Verify: `npx tsc --noEmit && npm run build`. Smoke `/dashboard/tools`:
- Tab pills toggle (URL updates)
- Referral card shows link
- Copy button — paste into a notes app, confirm `{{referral_link}}` is replaced
- Platform pills filter

Commit: `git add src/components/tools/ShareTab.tsx src/lib/referral-link.ts && git commit -m "feat(tools): wire Share tab with copy library + filter"`

---

## Phase 4 — Resources tab

### Task 16: `VideoCard.tsx`

```tsx
"use client";
import type { AffiliateResource } from "@/types/database";
import { fmt } from "@/lib/fmt";

export default function VideoCard({ resource }: { resource: AffiliateResource }) {
  const poster = resource.thumbnail_path
    ? publicUrlForThumb(resource.public_url, resource.thumbnail_path)
    : undefined;
  return (
    <div className="card overflow-hidden flex flex-col">
      <div className="aspect-video bg-gray-100">
        <video className="w-full h-full" src={resource.public_url}
          poster={poster} preload="metadata" controls />
      </div>
      <div className="p-4 flex-1 flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-gray-900">{resource.title}</h3>
        {resource.description && (
          <p className="text-xs text-brand-400 leading-relaxed">{resource.description}</p>
        )}
        <div className="mt-auto pt-2 flex items-center justify-between text-[10px] text-brand-400 uppercase tracking-wider">
          <span>{resource.duration_seconds ? `${Math.round(resource.duration_seconds/60)} min` : "—"}</span>
          <span>{fmt.bytes(resource.file_size_bytes)}</span>
        </div>
      </div>
    </div>
  );
}

function publicUrlForThumb(videoPublicUrl: string, thumbPath: string): string {
  const u = new URL(videoPublicUrl);
  const segs = u.pathname.split("/");
  const idxBucket = segs.indexOf("affiliate-content");
  if (idxBucket >= 0) u.pathname = [...segs.slice(0, idxBucket + 1), thumbPath].join("/");
  return u.toString();
}
```

Verify + commit.

---

### Task 17: `ResourceCard.tsx`

```tsx
import type { AffiliateResource } from "@/types/database";
import { fmt } from "@/lib/fmt";

export default function ResourceCard({ resource }: { resource: AffiliateResource }) {
  return (
    <a href={resource.public_url} target="_blank" rel="noopener noreferrer"
       className="card p-5 flex items-start gap-4 hover:shadow-card-md transition-shadow">
      <div className="w-12 h-12 rounded-xl bg-brand-600 border border-brand-700 flex items-center justify-center flex-shrink-0">
        <span className="text-[10px] font-bold text-white uppercase">{kindLabel(resource.kind)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-gray-900 truncate">{resource.title}</h3>
        {resource.description && (
          <p className="text-xs text-brand-400 mt-1 leading-relaxed line-clamp-2">{resource.description}</p>
        )}
        <div className="mt-2 flex items-center gap-3 text-[10px] text-brand-400 uppercase tracking-wider">
          <span>{resource.kind}</span>
          <span>{fmt.bytes(resource.file_size_bytes)}</span>
        </div>
      </div>
    </a>
  );
}
function kindLabel(k: AffiliateResource["kind"]) {
  if (k === "pdf") return "PDF";
  if (k === "image") return "IMG";
  if (k === "archive") return "ZIP";
  return k.toUpperCase();
}
```

Verify + commit.

---

### Task 18: Wire `ResourcesTab.tsx`

Replace `src/components/tools/ResourcesTab.tsx`:

```tsx
"use client";
import { useMemo } from "react";
import type { AffiliateResource } from "@/types/database";
import VideoCard from "./VideoCard";
import ResourceCard from "./ResourceCard";

const SECTIONS: Array<{ key: AffiliateResource["category"]; label: string; intro?: string }> = [
  { key: "onboarding",  label: "Onboarding" },
  { key: "tutorial",    label: "Tutorial Videos", intro: "Send these to anyone you refer." },
  { key: "guide",       label: "Guides & FAQs" },
  { key: "compliance",  label: "Compliance" },
  { key: "brand",       label: "Brand Assets" },
];

export default function ResourcesTab({ resources }: { resources: AffiliateResource[] }) {
  const grouped = useMemo(() => {
    const m = new Map<string, AffiliateResource[]>();
    for (const r of resources) {
      const arr = m.get(r.category) ?? [];
      arr.push(r);
      m.set(r.category, arr);
    }
    return m;
  }, [resources]);

  return (
    <div className="space-y-10">
      {SECTIONS.map((section) => {
        const items = grouped.get(section.key) ?? [];
        if (!items.length) return null;
        const isVideo = items.every((i) => i.kind === "video");
        return (
          <section key={section.key} className="space-y-3">
            <div>
              <h2 className="text-sm font-bold text-brand-400 uppercase tracking-wider">{section.label}</h2>
              {section.intro && <p className="text-xs text-brand-400 mt-1">{section.intro}</p>}
            </div>
            {isVideo ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.map((r) => <VideoCard key={r.id} resource={r} />)}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {items.map((r) => <ResourceCard key={r.id} resource={r} />)}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
```

Build + smoke:
```bash
npx tsc --noEmit && npm run build
```
Visit `/dashboard/tools?tab=resources` — sections render, videos play inline, PDFs open new tab, zip downloads.

Commit: `feat(tools): wire Resources tab with sectioned grid`

---

## Phase 5 — Sidebar swap, redirects, demo

### Task 19: Sidebar swap

Modify `src/app/dashboard/layout.tsx`. In `AFFILIATE_NAV` (~line 30), replace:
```tsx
  { label: "Referral Links", href: "/dashboard/referral-link",  icon: "link"    as const },
```
with:
```tsx
  { label: "Tools",          href: "/dashboard/tools",          icon: "link"    as const },
```

Verify: `npx tsc --noEmit && npm run build`.
Commit: `feat(nav): swap 'Referral Links' for 'Tools'`

---

### Task 20: Redirects

Replace contents of `src/app/dashboard/referral-link/page.tsx`:
```tsx
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default function Page() { redirect("/dashboard/tools?tab=share"); }
```

Same for `src/app/demo/referral-link/page.tsx`:
```tsx
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default function Page() { redirect("/demo/tools?tab=share"); }
```

Smoke: `/dashboard/referral-link` → `/dashboard/tools?tab=share`.
Commit: `feat(routes): redirect /referral-link to /tools?tab=share`

---

### Task 21: Demo `/demo/tools`

Modify `src/lib/demo-data.ts` — append `DEMO_RESOURCES` and `DEMO_SHARE_TEMPLATES` arrays mirroring the production shapes. 3-4 sample resources covering at least `video`, `pdf`, and `archive` kinds across `onboarding`, `tutorial`, `brand`, `compliance`. Use placeholder URLs (e.g., `https://placehold.co/...`) — demo viewers won't actually click through. 2-3 templates across platforms.

Create `src/app/demo/tools/page.tsx`:
```tsx
import ToolsClient from "@/components/tools/ToolsClient";
import { DEMO_AFFILIATE, DEMO_RESOURCES, DEMO_SHARE_TEMPLATES } from "@/lib/demo-data";
export const dynamic = "force-dynamic";
export default function DemoToolsPage() {
  return (
    <ToolsClient
      affiliate={DEMO_AFFILIATE}
      resources={DEMO_RESOURCES}
      templates={DEMO_SHARE_TEMPLATES}
    />
  );
}
```

Build + smoke `/demo/tools` (no auth).
Commit: `feat(demo): /demo/tools mirror`

---

### Task 22: Clean up orphaned old `ReferralLinkCard`

```bash
grep -rn "components/dashboard/ReferralLinkCard" src/
```
If the only references were from the now-redirected pages, delete the old file:
```bash
git rm src/components/dashboard/ReferralLinkCard.tsx
npm run build   # confirm green
git commit -m "chore: remove orphaned dashboard/ReferralLinkCard"
```
If anything else still imports it, leave it for a follow-up.

---

## Phase 6 — Admin CMS

### Task 23: `/admin/resources` read-only list

**Files:** Create `src/app/admin/resources/page.tsx` and `src/components/admin/AdminResources.tsx`.

`page.tsx`:
```tsx
import { createServiceClient } from "@/lib/supabase/service";
import AdminResources from "@/components/admin/AdminResources";
import type { AffiliateResource } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AdminResourcesPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { data } = await db.from("affiliate_resources").select("*").order("category").order("sort_order");
  return <AdminResources initialRows={(data ?? []) as AffiliateResource[]} />;
}
```

`AdminResources.tsx` (table only — actions stub for next task):
```tsx
"use client";
import type { AffiliateResource } from "@/types/database";
import { fmt } from "@/lib/fmt";

export default function AdminResources({ initialRows }: { initialRows: AffiliateResource[] }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Resources</h1>
        <button className="btn-primary px-4 py-2 rounded-xl text-sm" disabled>+ Add resource</button>
      </div>
      <div className="card overflow-hidden">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-surface-200/60 bg-surface-50/60">
              <th className="th">Title</th><th className="th">Kind</th><th className="th">Category</th>
              <th className="th">Size</th><th className="th">Order</th>
              <th className="th">Published</th><th className="th">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-200/60">
            {initialRows.map((r) => (
              <tr key={r.id} className="hover:bg-surface-100/40">
                <td className="td">
                  <p className="text-sm font-semibold text-gray-900">{r.title}</p>
                  <p className="text-xs text-brand-400 truncate max-w-xs">{r.description}</p>
                </td>
                <td className="td text-xs uppercase text-brand-400">{r.kind}</td>
                <td className="td text-xs uppercase text-brand-400">{r.category}</td>
                <td className="td text-xs text-brand-400">{fmt.bytes(r.file_size_bytes)}</td>
                <td className="td text-xs tabular-nums text-brand-400">{r.sort_order}</td>
                <td className="td">{r.is_published ? "Yes" : "No"}</td>
                <td className="td">
                  <a href={r.public_url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 underline">Open</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

Build + smoke `/admin/resources`.
Commit: `feat(admin): /admin/resources read-only list`

---

### Task 24: Resource server actions + form drawer

**Files:**
- Create: `src/app/admin/resources/_actions.ts`
- Modify: `src/components/admin/AdminResources.tsx`

`_actions.ts`:
```ts
"use server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { revalidatePath } from "next/cache";

async function assertAdmin() {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user || !isAdminEmail(user.email)) throw new Error("Forbidden");
}

interface ResourceInput {
  id?: string; title: string; description: string | null;
  kind: "video" | "pdf" | "image" | "archive";
  category: "onboarding" | "tutorial" | "brand" | "compliance" | "guide";
  storage_path: string; public_url: string;
  thumbnail_path: string | null; file_size_bytes: number | null;
  duration_seconds: number | null; sort_order: number; is_published: boolean;
}

export async function saveResource(input: ResourceInput) {
  await assertAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { id, ...row } = input;
  const op = id
    ? db.from("affiliate_resources").update(row).eq("id", id)
    : db.from("affiliate_resources").insert(row);
  const { error } = await op;
  if (error) throw error;
  revalidatePath("/admin/resources");
  revalidatePath("/dashboard/tools");
}

export async function deleteResource(id: string) {
  await assertAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { error } = await db.from("affiliate_resources").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/resources");
  revalidatePath("/dashboard/tools");
}

export async function togglePublishedResource(id: string, isPublished: boolean) {
  await assertAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { error } = await db.from("affiliate_resources").update({ is_published: isPublished }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/resources");
  revalidatePath("/dashboard/tools");
}

export async function uploadResourceFile(formData: FormData):
  Promise<{ public_url: string; file_size_bytes: number; storage_path: string }> {
  await assertAdmin();
  const file = formData.get("file") as File;
  const storage_path = String(formData.get("storage_path") ?? "");
  if (!file || !storage_path) throw new Error("Missing file or storage_path");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const buf = Buffer.from(await file.arrayBuffer());
  const { error } = await db.storage.from("affiliate-content")
    .upload(storage_path, buf, { upsert: true, contentType: file.type });
  if (error) throw error;
  const { data } = db.storage.from("affiliate-content").getPublicUrl(storage_path);
  return { public_url: data.publicUrl, file_size_bytes: buf.length, storage_path };
}
```

Drawer form in `AdminResources.tsx`: extend the component with state `editing: ResourceInput | null` (null = closed; empty object = new). Add an **+ Add resource** button (re-enabled), per-row Edit / Toggle / Delete buttons. Drawer is `<div className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-card-md p-6 z-50 overflow-y-auto">` with a translucent backdrop. Form fields: title, description (textarea), kind (select), category (select), storage_path (text), file `<input type="file">` whose change handler calls `uploadResourceFile(formData)` server action and populates `storage_path`/`public_url`/`file_size_bytes` in the form state, sort_order (number), is_published (checkbox). On submit: `saveResource(form)` then `router.refresh()`. Toggle and Delete call their respective actions then `router.refresh()`.

Match the visual pattern of [src/components/admin/AffiliateTable.tsx](src/components/admin/AffiliateTable.tsx) so the admin section feels coherent. Keep it functional — design polish happens in Task 28.

Build + smoke:
- Add a small test image (PNG) under `brand/test.png`, kind=image, category=brand → appears on `/dashboard/tools?tab=resources` under Brand Assets
- Toggle published off → row disappears from affiliate side
- Delete the test resource

Commit: `feat(admin): resource CRUD with file upload`

---

### Task 25: `/admin/share-templates` (page + actions + form)

**Files:**
- `src/app/admin/share-templates/page.tsx`
- `src/app/admin/share-templates/_actions.ts`
- `src/components/admin/AdminShareTemplates.tsx`

`_actions.ts` (mirror resources, no file upload):
```ts
"use server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { revalidatePath } from "next/cache";

async function assertAdmin() {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user || !isAdminEmail(user.email)) throw new Error("Forbidden");
}

interface TemplateInput {
  id?: string; title: string;
  platform: "instagram" | "twitter" | "linkedin" | "general";
  category: "intro" | "case-study" | "promo" | "follow-up";
  body: string; sort_order: number; is_published: boolean;
}

export async function saveTemplate(input: TemplateInput) {
  await assertAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { id, ...row } = input;
  const op = id
    ? db.from("affiliate_share_templates").update(row).eq("id", id)
    : db.from("affiliate_share_templates").insert(row);
  const { error } = await op;
  if (error) throw error;
  revalidatePath("/admin/share-templates");
  revalidatePath("/dashboard/tools");
}

export async function deleteTemplate(id: string) {
  await assertAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { error } = await db.from("affiliate_share_templates").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/share-templates");
  revalidatePath("/dashboard/tools");
}

export async function toggleTemplatePublished(id: string, isPublished: boolean) {
  await assertAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { error } = await db.from("affiliate_share_templates").update({ is_published: isPublished }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/share-templates");
  revalidatePath("/dashboard/tools");
}
```

`page.tsx`:
```tsx
import { createServiceClient } from "@/lib/supabase/service";
import AdminShareTemplates from "@/components/admin/AdminShareTemplates";
import type { ShareTemplate } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AdminShareTemplatesPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { data } = await db.from("affiliate_share_templates").select("*").order("platform").order("sort_order");
  return <AdminShareTemplates initialRows={(data ?? []) as ShareTemplate[]} />;
}
```

`AdminShareTemplates.tsx`:
- Table columns: Title • Platform • Category • Body preview (first 80 chars) • Order • Published • Actions
- Drawer form: title, platform select, category select, body textarea (`ref` it for cursor insertion), **variable picker chips** (3 buttons) that insert `{{var}}` at the textarea cursor via `textarea.setRangeText`, **live interpolation preview** below the textarea using `interpolate(body, { referral_link: "https://k.sh/preview", agent_name: "Sample Affiliate", business_name: "Sample LLC" })`, sort_order, is_published.

Build + smoke:
- Add a template, see it on `/dashboard/tools` Share tab
- Edit, see the change
- Toggle published off, watch it vanish from affiliate side
- Delete

Commit: `feat(admin): share-template CRUD with variable picker`

---

### Task 26: Admin sidebar entries

Modify `src/app/admin/layout.tsx`. Add to `ADMIN_NAV`:
```tsx
  { label: "Resources",       href: "/admin/resources",         icon: "grid"    as const },
  { label: "Share Templates", href: "/admin/share-templates",   icon: "link"    as const },
```

Verify + commit: `feat(admin): add Resources + Share Templates to admin sidebar`

---

## Phase 7 — Final verification & polish

### Task 27: Verification matrix

**Step 1:**
```bash
npx tsc --noEmit && npm run build
```
Both clean.

**Step 2: Manual smoke matrix on `npm run dev`**

| Path | Auth | Expected |
|---|---|---|
| `/dashboard/tools` | affiliate | Share tab default; link card + filter + cards |
| `/dashboard/tools?tab=resources` | affiliate | All sections render; videos play inline |
| `/dashboard/referral-link` | affiliate | Redirect to `/dashboard/tools?tab=share` |
| `/demo/tools` | none | Both tabs render with demo data |
| `/demo/referral-link` | none | Redirect to `/demo/tools?tab=share` |
| `/admin/resources` | admin | Table + drawer add/edit/delete works |
| `/admin/share-templates` | admin | Table + variable picker + live preview |
| Mobile 375px | affiliate | Tabs collapse; video card not cropped; copy buttons reachable |
| Copy a template | affiliate | Pasted text has `{{referral_link}}` replaced |

For any failing row, fix and re-run `npx tsc --noEmit && npm run build` before moving on.

**Step 3: Data sanity**
```sql
select count(*) from public.affiliate_resources where is_published = true;       -- ≥ 14
select count(*) from public.affiliate_share_templates where is_published = true; -- ≥ 6
```

**Step 4: URL spot-check** — open onboarding video, creator playbook PDF, brand kit zip in browser; all return 200.

(no commit unless fixes were made)

---

### Task 28: Frontend design pass

The components are built for correctness. Now invoke the **frontend-design** skill to elevate the visual quality of:
- `/dashboard/tools` (both tabs) — make the Share tab feel like a *toolkit*, the Resources tab feel premium (rich video thumbnails, hierarchy by category)
- `/admin/resources` and `/admin/share-templates` — keep utilitarian but match `AffiliateTable` polish

Constraints (from CLAUDE.md §2):
- Use `text-brand-400`, never `text-gray-500`
- Use `fmt.*` helpers, never `.toFixed()` or `.toLocaleString()`
- Stay on `bg-gray-50` page background, white `card` containers
- Funnel-style colors (greens) **not** appropriate here — this is a content/tools area, lean on brand teal + accent mint

After polish, re-run Task 27 verification.

---

### Task 29: Open PR

```bash
git push -u origin <feature-branch>
gh pr create --title "feat: affiliate /tools tab with Share + Resources sub-tabs" --body "$(cat <<'EOF'
## Summary
- New `/dashboard/tools` page with Share + Resources sub-tabs
- Subsumes `/referral-link` (redirects preserved)
- Two new tables (`affiliate_resources`, `affiliate_share_templates`) under RLS
- 14+ assets uploaded to public `affiliate-content` Supabase Storage bucket
- Admin CMS at `/admin/resources` and `/admin/share-templates`
- `/demo/tools` mirror

Reference: docs/plans/2026-05-08-affiliate-tools-tab-design.md

## Test plan
- [ ] `/dashboard/tools` default tab — link card, copy library, interpolation works
- [ ] `/dashboard/tools?tab=resources` — videos play, PDFs open, zip downloads
- [ ] `/dashboard/referral-link` redirects
- [ ] `/demo/tools` works without auth
- [ ] Admin resources CRUD round-trips
- [ ] Admin templates variable picker works
- [ ] Mobile viewport behaves
EOF
)"
```

---

## Decisions to keep top-of-mind during execution

- **One commit per task.** Don't batch — small reversible commits make rollback and design review easy.
- **`force-dynamic` on every page** (project convention).
- **`supabase as any` cast** when querying via service client (project convention).
- **`text-brand-400`, never `text-gray-500`** (CLAUDE.md §2 banned classes).
- **`fmt.*` helpers, never `.toFixed` / `.toLocaleString`** (CLAUDE.md §2 banned classes).
- **Don't run the upload script in CI.** It's a one-time local-machine operation against prod.
- **Re-running the upload script is safe** — idempotent by `storage_path`.
- **Use `execFileSync`, never `execSync`** in scripts that shell out — pass args as arrays, no string interpolation into commands.
