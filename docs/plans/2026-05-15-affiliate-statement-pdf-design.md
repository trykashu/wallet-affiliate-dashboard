# Affiliate Statement PDF — Design

**Date:** 2026-05-15
**Status:** Design approved, ready for implementation plan
**Template source:** `Kashu_Statement_Blank_Template final.pdf` (added to repo 2026-05-14)

## Problem

When an admin completes a monthly payout cycle for an affiliate, there's no per-affiliate statement document that records what was paid and why. The affiliate sees a single payout amount in `/dashboard/payouts` but has no breakdown of which referred-user transactions made up that commission.

Today the AM would have to manually copy data into a PDF template per affiliate — tedious, error-prone, and unscalable beyond a handful of affiliates per month.

## Goal

Generate a per-affiliate-per-period **Statement** PDF on demand from `/admin/payouts`. The PDF mirrors the Kashu-branded template:

- Header: statement number, date, period, affiliate tier, eligible transaction count
- Issued By (Kashu) and Paid To (affiliate) blocks with full address + contact + last-4 of bank
- Transactions table: one row per eligible earning (date, referred-user name, fee collected, commission)
- Totals: total fees collected, commission due
- Notes block

Each generation uploads to Supabase Storage (canonical) and mirrors the record into a new Airtable "Affiliate Statements" table.

## Architecture

```
AM clicks "Generate" on a completed/paid payout row in /admin/payouts
   │
   ▼
POST /api/admin/payouts/[id]/statement
   │
   ├─ Fetch payout + payout_account + affiliate + linked earnings + referred_users
   │  + joined transactions (for transaction_date)
   │
   ├─ Render <StatementDocument data={...}/> via @react-pdf/renderer → Buffer
   │
   ├─ Upload to Supabase Storage bucket `affiliate-statements`
   │    path: statements/{period}/{affiliate_id}.pdf  (upsert: true)
   │    → returns public URL
   │
   ├─ Upsert Airtable "Affiliate Statements" row by (Affiliate, Period) key
   │    fields: Affiliate (link), Period, Generated At, PDF (attachment from URL),
   │            Statement URL, Total Fees Collected, Commission Due
   │    → best-effort: failure logs but doesn't block download
   │
   ├─ Audit log: admin.statement_generated
   │
   └─ Return { url, airtable_record_id?, generated_at }
        → admin browser opens URL in new tab
```

### Key decisions

| Decision | Why |
|---|---|
| Per-payout button (not per-period batch) | A `payouts` row already represents one affiliate × one period. One statement per payout. |
| Period = `payouts.period` (e.g. `"2026-04"`) | Existing field. Natural ownership key. |
| Statement number = `KS-{period}-{first6(affiliate_id).upper()}` | Deterministic. Regeneration produces same number. |
| Supabase = canonical store | Returns a URL we can hand to Airtable + the AM browser |
| Airtable = mirror with searchable metadata | AM workflows live in Airtable; PDF accessible there too |
| Regeneration overwrites | YAGNI on versioning. (Audit log preserves history.) |

## Renderer

`src/lib/statement/StatementDocument.tsx` — a `@react-pdf/renderer` component. Pure function of props; no fetches inside.

```ts
interface StatementData {
  statement_number: string;          // "KS-2026-04-A7B3C1"
  statement_date: string;             // ISO date, displayed as "2026-05-15"
  period_label: string;               // "April 2026"
  affiliate: {
    name: string;
    tier: "gold" | "platinum";
    address1: string;
    address2: string | null;
    city: string;
    region: string;
    postal_code: string;
    phone: string | null;
    email: string;
    account_last4: string;
  };
  transactions: Array<{
    date: string;                     // "Apr 12, 2026"
    client: string;
    fee_collected: number;
    commission: number;
  }>;
  totals: {
    eligible_count: number;
    total_fees: number;
    commission_due: number;
    commission_rate_pct: 5 | 10;      // or custom_commission_rate * 100
  };
}
```

### Visual fidelity to the template

- Kashu logo + "Statement" wordmark header
- Four header rows (Statement Date / Period / Tier / Eligible Transactions), right-aligned values
- ISSUED BY (Kashu address, hardcoded) and PAID TO columns
- Transactions table with 4 columns matching the template
- Total Fees Collected + Commission Due footer
- Green-tinted NOTES block at bottom

### Fonts

Default Helvetica (React-PDF built-in) for v1. Visual match to template is "close enough." Custom font (Inter or whatever the brand kit prescribes) can be a small follow-up that loads `.ttf` files into the registry.

### Long transaction tables

React-PDF auto-paginates. Rows use `wrap` so they break cleanly. The template's "5 rows" is illustrative — real statements can have 0–50+ rows.

### Empty state

An affiliate with 0 transactions still gets a statement (Total Fees / Commission Due = $0). Useful as a no-activity record. The AM controls whether to generate.

## Data fetch

Single route, one Supabase round-trip per entity, joined client-side. No N+1.

```ts
// src/app/api/admin/payouts/[id]/statement/route.ts (POST)

const { data: payout } = await svc
  .from("payouts")
  .select("id, affiliate_id, payout_account_id, amount, period, status, created_at")
  .eq("id", payoutId).single();

const [affiliateResp, accountResp, earningsResp] = await Promise.all([
  svc.from("affiliates")
    .select("id, agent_name, tier, email, phone, custom_commission_rate")
    .eq("id", payout.affiliate_id).single(),
  svc.from("payout_accounts")
    .select("account_number_last4, address1, address2, city, region, postal_code, country")
    .eq("id", payout.payout_account_id).single(),
  svc.from("earnings")
    .select("id, amount, transaction_fee_amount, transaction_ref, referred_user_id")
    .eq("payout_id", payoutId),
]);

const referredUserIds = earningsResp.data.map((e) => e.referred_user_id);
const txnRefs = earningsResp.data.map((e) => e.transaction_ref).filter(Boolean);

const [usersResp, txnsResp] = await Promise.all([
  svc.from("referred_users").select("id, full_name").in("id", referredUserIds),
  svc.from("transactions").select("airtable_record_id, transaction_date").in("airtable_record_id", txnRefs),
]);

// Build StatementData, sort transactions by date asc, sum totals
```

### Commission rate logic

```ts
const ratePct = affiliate.custom_commission_rate != null
  ? Math.round(affiliate.custom_commission_rate * 100)
  : (affiliate.tier === "platinum" ? 10 : 5);
```

Matches existing logic at `src/lib/tier.ts`.

### Statement number

```ts
const statement_number = `KS-${payout.period}-${payout.affiliate_id.slice(0, 6).toUpperCase()}`;
```

### Period label

```ts
const [y, m] = payout.period.split("-").map(Number);
const period_label = new Date(y, m - 1, 1)
  .toLocaleString("en-US", { year: "numeric", month: "long" });
```

### Route failure modes

| Condition | Response |
|---|---|
| Payout not found | 404 |
| payout_account missing address fields | 422 `"Affiliate is missing address — Re-verify bank from PandaDoc"` |
| 0 earnings linked | 200 (renders empty statement) with `warning: "no_eligible_earnings"` in response so UI confirms |
| PDF render throws | 500, no partial uploads |

## Storage

### Supabase Storage

- **New bucket: `affiliate-statements`** — created manually via Supabase dashboard, public bucket (mirrors `affiliate-content`).
- **Path:** `statements/{period}/{affiliate_id}.pdf`
- **Upsert: true** — regeneration overwrites. Single file per (affiliate, period).
- **Public URL:** `${SUPABASE_URL}/storage/v1/object/public/affiliate-statements/statements/{period}/{affiliate_id}.pdf`

### Airtable "Affiliate Statements" table

Created manually in Airtable UI before merge. Schema:

| Field | Type | Purpose |
|---|---|---|
| `Affiliate` | Link to Affiliates table | Primary identity (one row per affiliate per period) |
| `Period` | Single line text | `"2026-04"` |
| `Generated At` | Date/time | Latest generation timestamp |
| `PDF` | Attachment | Fetched by Airtable from the public Supabase URL |
| `Statement URL` | URL | Plain text fallback when attachment fetch fails |
| `Total Fees Collected` | Currency | Mirrors PDF total. Searchable in Airtable. |
| `Commission Due` | Currency | Same. |

New env var: `AIRTABLE_STATEMENTS_TABLE` (table ID). Same `AIRTABLE_AFFILIATE_BASE` (lives alongside the Affiliates table).

### Upsert key (Airtable lacks native upsert)

1. Query: `filterByFormula={Period}='2026-04' AND {AffiliateId}='UUID'`
2. If found → PATCH that record
3. If not → POST new record

(Requires an `AffiliateId` text field on the Airtable row matching `affiliates.id` from Supabase — the existing Affiliates table in Airtable already has it for the sync routes.)

### Best-effort vs hard-required

- **Supabase upload = hard-required.** Failure → 500, no statement produced.
- **Airtable upsert = best-effort.** Failure → logs + audit, returns success with the Supabase URL. AM still downloads.

### Audit log

Action `admin.statement_generated` with metadata:
```ts
{
  payout_id, period, affiliate_id,
  supabase_url,
  airtable_record_id: string | null,
  eligible_count: number,
  commission_due: number,
}
```

## Admin UI

### New "Statement" column on the payout history table

Lives in the existing `PayoutBatchManager` (or the post-cleanup payout history component). For each payout row, a button cell.

**Three button states:**
- `[Generate]` — never generated. Click → POST → opens PDF in new tab.
- `[Regenerate · ⤓]` — already exists. Two affordances: regenerate (click button text) or download existing (click ⤓ icon).
- `[…]` spinner — disabled during pending POST.

**Eligibility:**
- Only `status IN ('completed', 'paid')` payouts get the button.
- Other statuses show `—`.

### Bulk action (out of scope for v1)

`[Generate for all completed in 2026-04]` button above the table → serially generates each. Useful for end-of-month workflow. **Skipped in v1** per YAGNI — clicking 47 buttons is fine until proven otherwise.

### Error display

- Inline error banner above the table for the most recent failure (dismissible)
- Per-row generation surfaces errors as a small warning indicator with hover tooltip

### Affiliate-side view (out of scope for v1)

`/dashboard/payouts` won't expose statements yet. Future PR.

## Testing & rollout

### Pre-deploy

- Unit tests for `StatementDocument` data → PDF buffer (snapshot on PDF byte length + structural checks via `pdf-lib` parsing)
- Unit tests for commission rate logic (gold/platinum/custom)
- Unit tests for statement number generation (deterministic)
- `npx tsc --noEmit` + `npm run build` clean

### Manual smoke

- AM clicks Generate on a known-good completed payout → PDF downloads matching the template visually
- AM clicks Regenerate → file in Supabase is overwritten; Airtable row's Generated At updates
- AM clicks Generate for a payout whose affiliate has no address → 422 with the expected message
- AM clicks Generate for a payout with 0 linked earnings → empty statement rendered with warning toast

### Rollout sequence

1. **Migration step (no DB)**: create the Supabase bucket + Airtable table manually, set `AIRTABLE_STATEMENTS_TABLE` env var in Vercel + `.env.local`
2. **Code PR**: ships the route, renderer, UI button
3. **Smoke test**: generate one statement against a real payout, verify in both Supabase + Airtable
4. **Run for real**: end-of-month workflow

## Risks

- **Font rendering differs from the template.** React-PDF's Helvetica isn't pixel-identical to whatever the design tool used. Acceptable for v1; can register a custom font in a follow-up if visual drift bothers anyone.
- **Airtable rate limits.** Native limit is 5 req/sec per base. Per-payout button serializes naturally. If we add bulk later, we'll need to throttle (`p-limit` or similar).
- **Long transaction lists overflow one page.** React-PDF auto-paginates but the totals row should anchor to the last page. We'll verify with a 50-transaction fixture.
- **Stale data on regeneration.** If an earning gets reversed AFTER a statement is generated, the AM can regenerate and the new version reflects the change. Old PDF in Supabase gets overwritten. Past versions are not preserved — by design.

## Decisions captured (from brainstorm)

| Question | Decision |
|---|---|
| What kind of receipt | PDF statement per affiliate per month |
| How to render | `@react-pdf/renderer` (recreate the design in JSX) |
| When to generate | Admin button per payout row in `/admin/payouts` |
| Where to store | Supabase Storage (canonical) + new Airtable "Affiliate Statements" table (mirror) |
| Regeneration | Overwrites (single file per affiliate + period; new audit log entry) |
| Bulk generation | Out of scope for v1 |
| Affiliate-side download | Out of scope for v1 |
