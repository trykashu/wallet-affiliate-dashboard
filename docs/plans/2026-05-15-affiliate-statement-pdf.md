# Affiliate Statement PDF Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** AM clicks a per-payout "Generate" button on `/admin/payouts`, server renders a Kashu-branded statement PDF using `@react-pdf/renderer`, uploads to Supabase Storage (canonical) + mirrors to a new Airtable "Affiliate Statements" table, returns the URL for download.

**Architecture:** New POST route `/api/admin/payouts/[id]/statement` does fetch → render → upload(Supabase) → upsert(Airtable) → audit. New shared module `src/lib/statement/` holds the React-PDF component and a builder that maps Supabase rows → `StatementData`. UI adds a "Statement" column in the existing payout history table.

**Tech Stack:** Next.js 15 App Router, `@react-pdf/renderer` for PDF generation (pure Node, Vercel-friendly), Supabase Storage, Airtable REST API, `node:test` via `npx tsx --test` for unit tests.

**Reference design:** [docs/plans/2026-05-15-affiliate-statement-pdf-design.md](./2026-05-15-affiliate-statement-pdf-design.md)

---

## Phase 0 — External setup (no code)

### Task 1: Create Supabase Storage bucket

**Step 1:** In the Supabase dashboard for project `xcnbchugndkrwgyqpuhk`:
- Storage → New bucket
- Name: `affiliate-statements`
- Public: **yes**
- File size limit: `10 MB`
- Allowed MIME types: leave empty (any)

**Step 2:** Verify in SQL editor:
```sql
select id, name, public from storage.buckets where name='affiliate-statements';
```
Expected: 1 row, `public = true`.

(No commit — dashboard config.)

---

### Task 2: Create Airtable "Affiliate Statements" table

**Step 1:** In the Airtable base referenced by `AIRTABLE_AFFILIATE_BASE` (same base that holds the Affiliates table), create a new table named `Affiliate Statements` with these fields:

| Field name | Type | Notes |
|---|---|---|
| `Affiliate` | Link to Affiliates | Single link, no multiple |
| `AffiliateId` | Single line text | Mirrors Supabase `affiliates.id` for upsert lookup |
| `Period` | Single line text | YYYY-MM, e.g. `2026-04` |
| `Generated At` | Date | Include time |
| `PDF` | Attachment | One file; URL-fetched from Supabase |
| `Statement URL` | URL | Plain text fallback |
| `Total Fees Collected` | Currency | USD |
| `Commission Due` | Currency | USD |
| `Statement Number` | Single line text | e.g. `KS-2026-04-A7B3C1` |

**Step 2:** Copy the new table ID (e.g. `tblXYZ...`) from the Airtable URL or API docs.

**Step 3:** Add the env var via Vercel CLI (or dashboard):
```bash
printf '%s' 'tblXYZ...' | vercel env add AIRTABLE_STATEMENTS_TABLE production
printf '%s' 'tblXYZ...' | vercel env add AIRTABLE_STATEMENTS_TABLE development
# Preview env: dashboard (CLI quirk)
```

**Step 4:** Pull to `.env.local`:
```bash
vercel env pull .env.local --environment=production --yes
```

(No commit — Airtable + Vercel config.)

---

## Phase 1 — Dependencies

### Task 3: Install `@react-pdf/renderer`

**Files:**
- Modify: `package.json`

**Step 1:** Install:
```bash
npm install @react-pdf/renderer
```

**Step 2:** Verify it imports cleanly in a Node context:
```bash
npx tsx -e "import * as R from '@react-pdf/renderer'; console.log(Object.keys(R).slice(0, 5));"
```
Expected: lists `Document, Page, View, Text, ...`.

**Step 3:** Commit:
```bash
git add package.json package-lock.json
git commit -m "chore(deps): add @react-pdf/renderer for statement PDFs"
```

---

## Phase 2 — Renderer

### Task 4: `StatementData` type + tiny builders

**Files:**
- Create: `src/lib/statement/types.ts`
- Create: `src/lib/statement/builders.ts`
- Create: `src/lib/statement/builders.test.ts`

**Step 1: Write `src/lib/statement/types.ts`**

```ts
export interface StatementData {
  statement_number: string;
  statement_date: string;        // "Mar 15, 2026"
  period_label: string;          // "April 2026"
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
    date: string;                // "Apr 12, 2026"
    client: string;
    fee_collected: number;
    commission: number;
  }>;
  totals: {
    eligible_count: number;
    total_fees: number;
    commission_due: number;
    commission_rate_pct: 5 | 10 | number; // allow custom
  };
}
```

**Step 2: Write failing tests in `src/lib/statement/builders.test.ts`**

```ts
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildStatementNumber, formatPeriodLabel, commissionRatePct } from "./builders";

describe("buildStatementNumber", () => {
  it("is deterministic per (period, affiliate)", () => {
    const a = buildStatementNumber("2026-04", "a7b3c1d2-1234-5678-9abc-def012345678");
    const b = buildStatementNumber("2026-04", "a7b3c1d2-1234-5678-9abc-def012345678");
    assert.equal(a, b);
    assert.equal(a, "KS-2026-04-A7B3C1");
  });

  it("uppercases the affiliate id chunk", () => {
    assert.equal(
      buildStatementNumber("2026-12", "deadbeef-1111-2222-3333-444455556666"),
      "KS-2026-12-DEADBE",
    );
  });
});

describe("formatPeriodLabel", () => {
  it("converts YYYY-MM to long month + year", () => {
    assert.equal(formatPeriodLabel("2026-04"), "April 2026");
    assert.equal(formatPeriodLabel("2025-12"), "December 2025");
  });
});

describe("commissionRatePct", () => {
  it("returns 5 for gold tier with no override", () => {
    assert.equal(commissionRatePct("gold", null), 5);
  });
  it("returns 10 for platinum tier with no override", () => {
    assert.equal(commissionRatePct("platinum", null), 10);
  });
  it("uses custom rate when set", () => {
    assert.equal(commissionRatePct("gold", 0.075), 7.5);
    assert.equal(commissionRatePct("platinum", 0.15), 15);
  });
});
```

**Step 3: Run, verify failures**

```bash
npm test 2>&1 | tail -20
```
Expected: 3 failures in the new describes (functions not defined). Other tests still pass.

**Step 4: Write `src/lib/statement/builders.ts`**

```ts
import type { AffiliateTier } from "@/types/database";

export function buildStatementNumber(period: string, affiliateId: string): string {
  return `KS-${period}-${affiliateId.slice(0, 6).toUpperCase()}`;
}

export function formatPeriodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return new Date(y, m - 1, 1).toLocaleString("en-US", {
    year: "numeric",
    month: "long",
  });
}

export function commissionRatePct(
  tier: AffiliateTier,
  customRate: number | null,
): number {
  if (customRate != null) return Math.round(customRate * 1000) / 10; // 0.075 → 7.5
  return tier === "platinum" ? 10 : 5;
}
```

**Step 5: Re-run tests**

```bash
npm test 2>&1 | tail -10
```
Expected: all pass.

**Step 6: Commit**

```bash
git add src/lib/statement/types.ts src/lib/statement/builders.ts src/lib/statement/builders.test.ts
git commit -m "feat(statement): StatementData type + pure builders with tests"
```

---

### Task 5: `StatementDocument` React-PDF component

**Files:**
- Create: `src/lib/statement/StatementDocument.tsx`
- Modify: `tsconfig.json` if jsx mode requires (only if compile errors)

**Step 1:** Write the component. This is a long file — the structure mirrors the template. Use `@react-pdf/renderer` primitives only:

```tsx
import React from "react";
import { Document, Page, View, Text, StyleSheet, Image } from "@react-pdf/renderer";
import type { StatementData } from "./types";

const COLORS = {
  brand600: "#0C5147",
  accent: "#00DE8F",
  amberBg: "#FEF3C7",
  amberText: "#92400E",
  textPrimary: "#111827",
  textMuted: "#6B7280",
  border: "#E5E7EB",
  noteBg: "#ECFDF5",
};

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: COLORS.textPrimary },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  logoText: { fontSize: 18, fontWeight: 700, color: COLORS.brand600 },
  statementTitle: { fontSize: 22, fontWeight: 700, color: COLORS.textPrimary, textAlign: "right" },
  statementNumber: { fontSize: 9, color: COLORS.textMuted, textAlign: "right", marginTop: 2 },
  headerFieldRow: { flexDirection: "row", justifyContent: "space-between", marginVertical: 2 },
  headerFieldLabel: { fontWeight: 700 },
  headerFieldValue: { textAlign: "right" },
  tierPill: { backgroundColor: COLORS.amberBg, color: COLORS.amberText, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, fontSize: 9, fontWeight: 700 },
  hr: { borderBottomColor: COLORS.border, borderBottomWidth: 1, marginVertical: 12 },
  twoCol: { flexDirection: "row", marginBottom: 18 },
  col: { flex: 1 },
  sectionLabel: { fontSize: 9, fontWeight: 700, color: COLORS.brand600, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.6 },
  addressLine: { lineHeight: 1.4 },
  table: { marginTop: 8 },
  tableHeader: { flexDirection: "row", borderBottomColor: COLORS.border, borderBottomWidth: 1, paddingVertical: 6 },
  tableRow: { flexDirection: "row", borderBottomColor: COLORS.border, borderBottomWidth: 1, paddingVertical: 8 },
  th: { fontSize: 8, fontWeight: 700, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.6 },
  td: { fontSize: 10 },
  colDate: { width: "20%" },
  colClient: { width: "35%" },
  colFee: { width: "22.5%", textAlign: "right" },
  colCommission: { width: "22.5%", textAlign: "right", fontWeight: 700 },
  totalsBlock: { marginTop: 14, alignItems: "flex-end" },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", width: "50%", paddingVertical: 4 },
  totalsLabel: { color: COLORS.textMuted },
  totalsValue: { fontWeight: 700 },
  commissionDueRow: { flexDirection: "row", justifyContent: "space-between", width: "50%", paddingVertical: 8, borderTopColor: COLORS.border, borderTopWidth: 1, marginTop: 4 },
  commissionDueLabel: { fontSize: 13, fontWeight: 700 },
  commissionDueValue: { fontSize: 13, fontWeight: 700 },
  notesBlock: { marginTop: 24, padding: 14, backgroundColor: COLORS.noteBg, borderLeftWidth: 3, borderLeftColor: COLORS.accent },
  notesLabel: { fontSize: 9, fontWeight: 700, color: COLORS.brand600, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.6 },
  notesText: { fontSize: 9, lineHeight: 1.5, color: COLORS.textMuted },
});

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export function StatementDocument({ data }: { data: StatementData }) {
  const tierLabel = data.affiliate.tier === "platinum" ? "Platinum" : "Gold";
  return (
    <Document title={data.statement_number} author="Kashu, Inc.">
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.logoText}>Kashu</Text>
          </View>
          <View>
            <Text style={styles.statementTitle}>Statement</Text>
            <Text style={styles.statementNumber}>#{data.statement_number}</Text>
          </View>
        </View>

        <View>
          <View style={styles.headerFieldRow}><Text style={styles.headerFieldLabel}>Statement Date</Text><Text style={styles.headerFieldValue}>{data.statement_date}</Text></View>
          <View style={styles.headerFieldRow}><Text style={styles.headerFieldLabel}>Period</Text><Text style={styles.headerFieldValue}>{data.period_label}</Text></View>
          <View style={styles.headerFieldRow}>
            <Text style={styles.headerFieldLabel}>Affiliate Tier</Text>
            <Text style={styles.tierPill}>{tierLabel}</Text>
          </View>
          <View style={styles.headerFieldRow}><Text style={styles.headerFieldLabel}>Eligible Transactions</Text><Text style={styles.headerFieldValue}>{data.totals.eligible_count}</Text></View>
        </View>

        <View style={styles.hr} />

        <View style={styles.twoCol}>
          <View style={styles.col}>
            <Text style={styles.sectionLabel}>Issued By</Text>
            <Text style={{ fontWeight: 700 }}>Kashu, Inc.</Text>
            <Text style={styles.addressLine}>1603 Capitol Ave Ste 415 #674380</Text>
            <Text style={styles.addressLine}>Cheyenne, Wyoming 82001</Text>
            <Text style={styles.addressLine}>(888) 900-5056</Text>
            <Text style={styles.addressLine}>help@kashupay.com</Text>
          </View>
          <View style={styles.col}>
            <Text style={styles.sectionLabel}>Paid To</Text>
            <Text style={{ fontWeight: 700 }}>{data.affiliate.name}</Text>
            <Text style={styles.addressLine}>{data.affiliate.address1}</Text>
            {data.affiliate.address2 ? <Text style={styles.addressLine}>{data.affiliate.address2}</Text> : null}
            <Text style={styles.addressLine}>{data.affiliate.city}, {data.affiliate.region} {data.affiliate.postal_code}</Text>
            {data.affiliate.phone ? <Text style={styles.addressLine}>{data.affiliate.phone}</Text> : null}
            <Text style={styles.addressLine}>{data.affiliate.email}</Text>
            <Text style={{ ...styles.addressLine, color: COLORS.textMuted, marginTop: 4 }}>Acct •••• {data.affiliate.account_last4}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, styles.colDate]}>Date</Text>
            <Text style={[styles.th, styles.colClient]}>Client</Text>
            <Text style={[styles.th, styles.colFee]}>Fee Collected</Text>
            <Text style={[styles.th, styles.colCommission]}>Commission ({data.totals.commission_rate_pct}%)</Text>
          </View>
          {data.transactions.map((t, i) => (
            <View key={i} style={styles.tableRow} wrap={false}>
              <Text style={[styles.td, styles.colDate]}>{t.date}</Text>
              <Text style={[styles.td, styles.colClient]}>{t.client}</Text>
              <Text style={[styles.td, styles.colFee]}>{fmtMoney(t.fee_collected)}</Text>
              <Text style={[styles.td, styles.colCommission]}>{fmtMoney(t.commission)}</Text>
            </View>
          ))}
          {data.transactions.length === 0 ? (
            <View style={styles.tableRow}>
              <Text style={[styles.td, { textAlign: "center", width: "100%", color: COLORS.textMuted }]}>No eligible transactions for this period.</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Total Fees Collected</Text>
            <Text style={styles.totalsValue}>{fmtMoney(data.totals.total_fees)}</Text>
          </View>
          <View style={styles.commissionDueRow}>
            <Text style={styles.commissionDueLabel}>Commission Due</Text>
            <Text style={styles.commissionDueValue}>{fmtMoney(data.totals.commission_due)}</Text>
          </View>
        </View>

        <View style={styles.notesBlock}>
          <Text style={styles.notesLabel}>Notes</Text>
          <Text style={styles.notesText}>
            This statement reflects all eligible affiliate transactions for the period shown. Commission is calculated at {data.totals.commission_rate_pct}% of the platform service fee collected on each referred user&apos;s transaction per the {tierLabel} tier affiliate agreement. Payment will be processed according to the standard payout schedule.{"\n\n"}
            View your full payout history at aff.kashupay.com/dashboard/payouts.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
```

**Step 2:** Verify compile:

```bash
npx tsc --noEmit
```

**Step 3:** Verify render-to-buffer works in Node (no UI):

```bash
npx tsx -e "
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { StatementDocument } from './src/lib/statement/StatementDocument';

const buf = await renderToBuffer(React.createElement(StatementDocument, { data: {
  statement_number: 'KS-2026-04-TEST01',
  statement_date: 'May 15, 2026',
  period_label: 'April 2026',
  affiliate: { name: 'Test Affiliate', tier: 'gold', address1: '123 Main St', address2: null, city: 'Boulder', region: 'CO', postal_code: '80301', phone: '(303) 555-0100', email: 'test@example.com', account_last4: '4321' },
  transactions: [
    { date: 'Apr 12, 2026', client: 'Acme Co', fee_collected: 1000, commission: 50 },
    { date: 'Apr 19, 2026', client: 'Beta LLC', fee_collected: 2000, commission: 100 },
  ],
  totals: { eligible_count: 2, total_fees: 3000, commission_due: 150, commission_rate_pct: 5 },
}}));
console.log('PDF buffer length:', buf.length);
"
```

Expected: prints `PDF buffer length: <some number > 1000>`.

**Step 4: Commit**

```bash
git add src/lib/statement/StatementDocument.tsx
git commit -m "feat(statement): React-PDF Document component matching template"
```

---

## Phase 3 — Server route

### Task 6: Route scaffold + data fetch

**Files:**
- Create: `src/app/api/admin/payouts/[id]/statement/route.ts`

**Step 1:** Write the route file with everything EXCEPT the upload + Airtable steps (those go in Tasks 7 + 8). Stops after building `StatementData` and rendering the buffer; returns the buffer length as a smoke test.

```ts
import { NextRequest, NextResponse } from "next/server";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";
import { StatementDocument } from "@/lib/statement/StatementDocument";
import {
  buildStatementNumber,
  commissionRatePct,
  formatPeriodLabel,
} from "@/lib/statement/builders";
import type { StatementData } from "@/lib/statement/types";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: payoutId } = await params;

  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // 1. Fetch payout
  const { data: payout, error: payoutErr } = await svc
    .from("payouts")
    .select("id, affiliate_id, payout_account_id, amount, period, status, created_at")
    .eq("id", payoutId)
    .maybeSingle();
  if (payoutErr) {
    console.error("[statement] payout fetch failed:", payoutErr);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  if (!payout) {
    return NextResponse.json({ error: "Payout not found" }, { status: 404 });
  }
  if (!payout.period) {
    return NextResponse.json({ error: "Payout has no period set" }, { status: 422 });
  }

  // 2. Fetch affiliate, account, earnings in parallel
  const [affResp, acctResp, earningsResp] = await Promise.all([
    svc.from("affiliates")
      .select("id, agent_name, tier, email, phone, custom_commission_rate")
      .eq("id", payout.affiliate_id)
      .maybeSingle(),
    svc.from("payout_accounts")
      .select("account_number_last4, address1, address2, city, region, postal_code, country")
      .eq("id", payout.payout_account_id)
      .maybeSingle(),
    svc.from("earnings")
      .select("id, amount, transaction_fee_amount, transaction_ref, referred_user_id")
      .eq("payout_id", payoutId),
  ]);

  if (affResp.error || acctResp.error || earningsResp.error) {
    console.error("[statement] secondary fetch failed", { aff: affResp.error, acct: acctResp.error, earnings: earningsResp.error });
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const affiliate = affResp.data;
  const account = acctResp.data;
  const earnings = (earningsResp.data ?? []) as Array<{
    id: string; amount: number; transaction_fee_amount: number;
    transaction_ref: string | null; referred_user_id: string;
  }>;

  if (!affiliate) return NextResponse.json({ error: "Affiliate not found" }, { status: 404 });
  if (!account) return NextResponse.json({ error: "Payout account not found" }, { status: 404 });

  if (!account.address1 || !account.city || !account.region || !account.postal_code) {
    return NextResponse.json({
      error: "Affiliate is missing address — Re-verify bank from PandaDoc",
      reason: "missing_address",
    }, { status: 422 });
  }

  // 3. Resolve referred-user names + transaction dates
  const referredUserIds = Array.from(new Set(earnings.map((e) => e.referred_user_id)));
  const txnRefs = earnings.map((e) => e.transaction_ref).filter((r): r is string => !!r);

  const [usersResp, txnsResp] = await Promise.all([
    referredUserIds.length > 0
      ? svc.from("referred_users").select("id, full_name").in("id", referredUserIds)
      : Promise.resolve({ data: [] }),
    txnRefs.length > 0
      ? svc.from("transactions").select("airtable_record_id, transaction_date").in("airtable_record_id", txnRefs)
      : Promise.resolve({ data: [] }),
  ]);

  type UserRow = { id: string; full_name: string };
  type TxnRow = { airtable_record_id: string; transaction_date: string | null };
  const userMap = new Map<string, string>();
  for (const u of (usersResp.data ?? []) as UserRow[]) userMap.set(u.id, u.full_name);
  const txnDateMap = new Map<string, string | null>();
  for (const t of (txnsResp.data ?? []) as TxnRow[]) txnDateMap.set(t.airtable_record_id, t.transaction_date);

  // 4. Build StatementData
  const ratePct = commissionRatePct(affiliate.tier, affiliate.custom_commission_rate);

  const rows = earnings.map((e) => {
    const dateRaw = e.transaction_ref ? txnDateMap.get(e.transaction_ref) ?? null : null;
    const dateLabel = dateRaw
      ? new Date(dateRaw).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "—";
    return {
      _sortKey: dateRaw ?? "",
      date: dateLabel,
      client: userMap.get(e.referred_user_id) ?? "Unknown",
      fee_collected: Number(e.transaction_fee_amount) || 0,
      commission: Number(e.amount) || 0,
    };
  }).sort((a, b) => a._sortKey.localeCompare(b._sortKey)).map(({ _sortKey, ...rest }) => rest);

  const totals = {
    eligible_count: rows.length,
    total_fees: rows.reduce((s, r) => s + r.fee_collected, 0),
    commission_due: rows.reduce((s, r) => s + r.commission, 0),
    commission_rate_pct: ratePct,
  };

  const data: StatementData = {
    statement_number: buildStatementNumber(payout.period, payout.affiliate_id),
    statement_date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    period_label: formatPeriodLabel(payout.period),
    affiliate: {
      name: affiliate.agent_name,
      tier: affiliate.tier,
      address1: account.address1,
      address2: account.address2,
      city: account.city,
      region: account.region,
      postal_code: account.postal_code,
      phone: affiliate.phone,
      email: affiliate.email,
      account_last4: account.account_number_last4 ?? "????",
    },
    transactions: rows,
    totals,
  };

  // 5. Render PDF buffer
  const pdfBuffer = await renderToBuffer(React.createElement(StatementDocument, { data }));

  // Upload + Airtable upsert come in Tasks 7 + 8. For this scaffold task,
  // return the byte count so we can smoke-test the route.
  // TODO(Task 7): upload to Supabase
  // TODO(Task 8): upsert Airtable
  // TODO(Task 9): audit log

  return NextResponse.json({
    ok: true,
    statement_number: data.statement_number,
    pdf_byte_length: pdfBuffer.length,
    period: payout.period,
    eligible_count: totals.eligible_count,
    commission_due: totals.commission_due,
  });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
```

**Step 2:** Verify compile + build:

```bash
npx tsc --noEmit
npm run build 2>&1 | tail -5
```

**Step 3:** Smoke-test the route locally:

```bash
# Start dev server in a separate terminal:
npm run dev
# In this terminal, hit the route with a real payout id (use a completed payout):
curl -X POST http://localhost:3000/api/admin/payouts/<REAL_PAYOUT_UUID>/statement \
  -H "Cookie: $(grep sb-access .env.local || echo '')" \
  | python3 -m json.tool
```
Expected: 403 (no admin cookie) when hitting from CLI. Real test is via browser when logged in as admin.

**Step 4: Commit**

```bash
git add src/app/api/admin/payouts/[id]/statement/route.ts
git commit -m "feat(api/statement): route scaffold renders PDF buffer

Fetches payout + affiliate + account + linked earnings + joined
transaction_date. Builds StatementData. Renders via React-PDF and
returns byte count (no upload yet — wired in next commits)."
```

---

### Task 7: Upload to Supabase Storage

**Files:**
- Modify: `src/app/api/admin/payouts/[id]/statement/route.ts`

**Step 1:** Find the `// TODO(Task 7)` line. Replace the surrounding block (the existing `return NextResponse.json({ ok: true, ... })`) with the upload + new return.

Insert before the final `return NextResponse.json(...)`:

```ts
  // 6. Upload to Supabase Storage (canonical)
  const storagePath = `statements/${payout.period}/${payout.affiliate_id}.pdf`;
  const { error: uploadErr } = await svc.storage
    .from("affiliate-statements")
    .upload(storagePath, pdfBuffer, {
      upsert: true,
      contentType: "application/pdf",
    });
  if (uploadErr) {
    console.error("[statement] Supabase upload failed:", uploadErr);
    return NextResponse.json({ error: `Supabase upload failed: ${uploadErr.message}` }, { status: 500 });
  }

  const { data: publicUrlData } = svc.storage
    .from("affiliate-statements")
    .getPublicUrl(storagePath);
  const supabaseUrl = publicUrlData.publicUrl;
```

And change the final return to include `url`:

```ts
  return NextResponse.json({
    ok: true,
    statement_number: data.statement_number,
    pdf_byte_length: pdfBuffer.length,
    period: payout.period,
    eligible_count: totals.eligible_count,
    commission_due: totals.commission_due,
    url: supabaseUrl,
    storage_path: storagePath,
  });
```

**Step 2:** Verify compile + build:

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -5
```

**Step 3:** Smoke-test by hitting the route in the browser (logged in as admin). The response should include a Supabase URL. Open the URL — PDF should download.

**Step 4: Commit**

```bash
git add src/app/api/admin/payouts/[id]/statement/route.ts
git commit -m "feat(api/statement): upload to Supabase Storage

Path: statements/{period}/{affiliate_id}.pdf. Upsert true so
regeneration overwrites. Returns the public URL for the admin browser
to download."
```

---

### Task 8: Mirror to Airtable

**Files:**
- Modify: `src/app/api/admin/payouts/[id]/statement/route.ts`

**Step 1:** Add the imports at the top of the file:

```ts
import { patchRecords } from "@/lib/airtable";
```

(We'll use raw `fetch` for the lookup + insert since `patchRecords` does updates only. Or build a small helper inline.)

**Step 2:** Insert the Airtable mirror BEFORE the final `return`. It's best-effort:

```ts
  // 7. Mirror to Airtable "Affiliate Statements" — best-effort
  let airtableRecordId: string | null = null;
  let airtableError: string | null = null;
  const airtableBaseId = process.env.AIRTABLE_AFFILIATE_BASE?.replace(/\\n|"|\s/g, "");
  const statementsTableId = process.env.AIRTABLE_STATEMENTS_TABLE?.replace(/\\n|"|\s/g, "");
  const airtablePat = process.env.AIRTABLE_PAT?.replace(/\\n|"|\s/g, "");

  if (airtableBaseId && statementsTableId && airtablePat) {
    try {
      // Lookup existing row by (Period, AffiliateId)
      const filter = encodeURIComponent(
        `AND({Period}='${payout.period}', {AffiliateId}='${payout.affiliate_id}')`
      );
      const listUrl = `https://api.airtable.com/v0/${airtableBaseId}/${statementsTableId}?filterByFormula=${filter}&maxRecords=1`;
      const listRes = await fetch(listUrl, {
        headers: { Authorization: `Bearer ${airtablePat}` },
        cache: "no-store",
      });
      if (!listRes.ok) throw new Error(`Airtable list ${listRes.status}`);
      const listJson = await listRes.json() as { records?: Array<{ id: string }> };
      const existingId = listJson.records?.[0]?.id ?? null;

      const fields: Record<string, unknown> = {
        AffiliateId: payout.affiliate_id,
        Period: payout.period,
        "Generated At": new Date().toISOString(),
        PDF: [{ url: supabaseUrl, filename: `${data.statement_number}.pdf` }],
        "Statement URL": supabaseUrl,
        "Total Fees Collected": totals.total_fees,
        "Commission Due": totals.commission_due,
        "Statement Number": data.statement_number,
      };

      let writeRes: Response;
      if (existingId) {
        writeRes = await fetch(`https://api.airtable.com/v0/${airtableBaseId}/${statementsTableId}/${existingId}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${airtablePat}`, "Content-Type": "application/json" },
          body: JSON.stringify({ fields }),
        });
      } else {
        writeRes = await fetch(`https://api.airtable.com/v0/${airtableBaseId}/${statementsTableId}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${airtablePat}`, "Content-Type": "application/json" },
          body: JSON.stringify({ fields }),
        });
      }

      if (!writeRes.ok) {
        const txt = await writeRes.text().catch(() => "");
        throw new Error(`Airtable write ${writeRes.status}: ${txt.slice(0, 200)}`);
      }
      const writeJson = await writeRes.json() as { id: string };
      airtableRecordId = writeJson.id;
    } catch (e) {
      airtableError = e instanceof Error ? e.message : String(e);
      console.error("[statement] Airtable mirror failed:", airtableError);
    }
  } else {
    airtableError = "Airtable env vars not configured";
  }
```

**Step 3:** Add the new fields to the final return:

```ts
  return NextResponse.json({
    ok: true,
    statement_number: data.statement_number,
    pdf_byte_length: pdfBuffer.length,
    period: payout.period,
    eligible_count: totals.eligible_count,
    commission_due: totals.commission_due,
    url: supabaseUrl,
    storage_path: storagePath,
    airtable_record_id: airtableRecordId,
    airtable_error: airtableError,
  });
```

**Step 4:** Verify:

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -5
```

**Step 5: Commit**

```bash
git add src/app/api/admin/payouts/[id]/statement/route.ts
git commit -m "feat(api/statement): mirror to Airtable Statements table

Best-effort: failures log + return in response but don't block.
Upsert by (Period, AffiliateId) — regeneration updates existing
row in place. PDF attachment field references the Supabase URL;
Airtable fetches it asynchronously."
```

---

### Task 9: Audit log

**Files:**
- Modify: `src/app/api/admin/payouts/[id]/statement/route.ts`

**Step 1:** Insert just before the final return:

```ts
  // 8. Audit log
  await logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: "admin.statement_generated",
    resourceType: "payouts",
    resourceId: payoutId,
    metadata: {
      period: payout.period,
      affiliate_id: payout.affiliate_id,
      supabase_url: supabaseUrl,
      airtable_record_id: airtableRecordId,
      airtable_error: airtableError,
      eligible_count: totals.eligible_count,
      commission_due: totals.commission_due,
    },
  });
```

**Step 2:** Verify:

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -5
```

**Step 3: Commit**

```bash
git add src/app/api/admin/payouts/[id]/statement/route.ts
git commit -m "feat(api/statement): audit log on generation"
```

---

## Phase 4 — Admin UI

### Task 10: "Statement" column in payout history

**Files:**
- Modify: the existing payout history table component (run `grep -l 'payouts.*table\|allPayouts' src/components/admin/` to find it; likely `PayoutBatchManager.tsx` or its replacement)

**Step 1:** Find the column where status is displayed in the payout history table. Add a new column header:

```tsx
<th className="th text-center">Statement</th>
```

**Step 2:** Add per-row state in the component:

```ts
const [generatingId, setGeneratingId] = useState<string | null>(null);
const [statementError, setStatementError] = useState<string | null>(null);
```

**Step 3:** Add the handler:

```ts
async function handleGenerateStatement(payoutId: string) {
  setGeneratingId(payoutId);
  setStatementError(null);
  try {
    const res = await fetch(`/api/admin/payouts/${payoutId}/statement`, { method: "POST" });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error ?? `Generation failed (${res.status})`);
    window.open(body.url, "_blank");
    router.refresh();
  } catch (e) {
    setStatementError(e instanceof Error ? e.message : "Generation failed");
  } finally {
    setGeneratingId(null);
  }
}
```

**Step 4:** Add the per-row cell. Show the button only for eligible statuses:

```tsx
<td className="td text-center">
  {(p.status === "completed" || p.status === "paid") ? (
    <button
      onClick={() => handleGenerateStatement(p.id)}
      disabled={generatingId === p.id}
      className="text-xs font-semibold text-brand-600 hover:text-brand-700 underline decoration-dotted disabled:opacity-50 disabled:cursor-not-allowed"
      title="Render PDF statement and upload to Supabase + Airtable"
    >
      {generatingId === p.id ? "…" : "Generate"}
    </button>
  ) : (
    <span className="text-xs text-brand-400">—</span>
  )}
</td>
```

**Step 5:** Add a dismissible error banner above the table:

```tsx
{statementError && (
  <div className="card p-3 mb-3 bg-red-50 border-red-200">
    <p className="text-xs text-red-700">{statementError}</p>
    <button onClick={() => setStatementError(null)} className="text-[10px] text-red-700 underline mt-1">Dismiss</button>
  </div>
)}
```

**Step 6:** Verify:

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -5
```

**Step 7: Commit**

```bash
git add src/components/admin/PayoutBatchManager.tsx
git commit -m "feat(admin/payouts): 'Statement' column with per-row Generate button"
```

(Adjust the file path in `git add` to match wherever the payout history table lives in your codebase.)

---

## Phase 5 — Verification

### Task 11: Verification matrix

**Step 1:** Build + types + tests clean:

```bash
npm test 2>&1 | tail -5
npx tsc --noEmit && npm run build 2>&1 | tail -5
```

All pass.

**Step 2:** Manual smoke on a real prod payout:

| Action | Expected |
|---|---|
| `/admin/payouts`: click Generate on a `completed` payout | New tab opens, PDF downloads |
| PDF visually matches template | header / addresses / table / totals / notes all populated |
| Re-click Generate on same payout | Same URL, file overwritten in Supabase, Airtable Generated At updates |
| Click Generate on a `pending_review` payout | Cell shows `—`, no button |
| Generate for affiliate missing address | 422 error in banner: "Affiliate is missing address — Re-verify bank from PandaDoc" |
| Generate for payout with 0 linked earnings | PDF renders with empty-state row, totals are $0 |
| Verify Supabase: `statements/{period}/{affiliate_id}.pdf` exists | ✓ |
| Verify Airtable "Affiliate Statements" table: row for (Period, Affiliate) exists with attachment + URL | ✓ |

**Step 3:** Spot-check audit log:

```sql
select created_at, user_email, metadata
from security_audit_logs
where action = 'admin.statement_generated'
order by created_at desc
limit 5;
```

Each row has `period`, `affiliate_id`, `supabase_url`, `eligible_count`, `commission_due`.

(no commit unless fixes are needed)

---

### Task 12: Open PR

```bash
git push -u origin feat/affiliate-statement-pdf
gh pr create --title "feat(admin): per-payout statement PDF generation" --body "$(cat <<'EOF'
## Summary
Adds a per-payout 'Generate' button on /admin/payouts that renders a Kashu-branded affiliate statement PDF, uploads to Supabase Storage (canonical), and mirrors the record into a new Airtable 'Affiliate Statements' table.

## What's new
- `@react-pdf/renderer` for PDF generation (pure Node, no browser dependency)
- `src/lib/statement/` — `StatementDocument` React-PDF component + pure builders + tests
- `POST /api/admin/payouts/[id]/statement` — fetch → render → upload → mirror → audit
- New 'Statement' column on the payout history table with per-row Generate button
- New Supabase Storage bucket: `affiliate-statements`
- New Airtable table: `Affiliate Statements` in the `AIRTABLE_AFFILIATE_BASE`

## Pre-merge required
1. Supabase bucket `affiliate-statements` created (public, 10 MB limit)
2. Airtable table `Affiliate Statements` created with the schema in the design doc
3. `AIRTABLE_STATEMENTS_TABLE` env var set in Vercel prod + preview + development

## Test plan
- [x] `npm test` — all extractor + builder tests pass
- [x] `npx tsc --noEmit` clean
- [x] `npm run build` clean
- [ ] Smoke: generate statement for a real completed payout, verify PDF, Supabase, Airtable
- [ ] Smoke: regenerate same statement, verify overwrite + Airtable update
- [ ] Smoke: generate for affiliate missing address, verify 422 with clear message

## References
- Design: docs/plans/2026-05-15-affiliate-statement-pdf-design.md
- Implementation plan: docs/plans/2026-05-15-affiliate-statement-pdf.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Decisions to keep top-of-mind during execution

- **One commit per task.** Frequent commits = easy rollback.
- **`force-dynamic`** on the route (project convention).
- **`supabase as any` cast** when using service client (project convention).
- **`fmt.*` for formatting** — but `Intl.NumberFormat` is fine inside the PDF since that file is a leaf and `fmt` isn't safe to import in pure-render context.
- **Don't break Airtable's 5 req/sec** — per-payout serialization handles this naturally.
- **Audit log fires regardless of Airtable outcome** — Airtable failure shouldn't lose audit trail.
- **Address gate** — refuse to render if `payout_account` is missing address. The PandaDoc address pipeline must have succeeded before a statement can be generated.
