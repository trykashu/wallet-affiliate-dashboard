# Master Partner (Sub-Affiliate) Structure — Design

**Date:** 2026-08-19
**Status:** Approved by Miles 2026-08-19
**Scope:** New "Master Tier - T3" partner type whose referral traffic is subdivided by
sub-affiliate IDs stamped on GHL opportunities. Masters see a per-sub roster and rollup;
all commission flows to the master.

---

## 1. Decisions (confirmed with Miles)

| Decision | Answer |
|---|---|
| Tier name (Airtable single select) | `Master Tier - T3` |
| Commission model | **Master gets it all** — subs are attribution-only, paid outside this system |
| Master commission rate | **20% of cash collected** (= 20% of Kashu's fee — same basis as gold 5% / platinum 10%) |
| What is a sub-affiliate? | **Just an ID on opportunities** — NOT an affiliate row, no login, no auth object |
| Attribution mechanism | Link param → GHL stamps opportunity custom fields (master attribution id + sub aff id) |
| Airtable columns | Keep `Referrer` as master attribution ID (pipeline unchanged); add ONE new `Sub Aff ID` column on Launch List |
| Sub display names | Editable labels table, owned by the master, edited in the dashboard |
| Master view contents | Sub-affiliate roster + per-sub stats, aggregate rollup (direct vs sub-tagged), earnings surfaces |

## 2. Why this shape (approaches considered)

- **A. Sub-ID grouping on `referred_users` (CHOSEN).** Because subs are just IDs, the
  master is a completely normal affiliate: every sub's referred user is already the
  master's own `referred_users` row, RLS already returns them, and earnings already
  accrue to the master. No parent FK, no context branches, no service-client tricks.
- **B. Full parent-FK hierarchy** (subs as affiliate rows). Rejected — subs have no
  logins/payouts; this machinery (RLS branches, override earnings) buys nothing.
- **C. Overload `custom` tier + `is_master` flag.** Rejected — muddies tier semantics
  and the clean Airtable→code `TIER_MAP`.

## 3. Airtable changes (Affiliate/MRP Hub `appKiH3vOExub0wP5`, Wallet HQ `appLArFbRFtS24TlZ`)

1. **Kashu Affiliates (`tbl9OoVL64Z1GiNzU`) → `Affiliate Tier` (`fldxhamZ3c7Ml3P3Q`):**
   add select option `Master Tier - T3`. Existing options untouched (option IDs must not change).
2. **Launch List (`tblV03MwocMeq3wYl`, Wallet HQ) → new field `Sub Aff ID`** (singleLineText).
   The GHL workflow writes the opportunity's sub-aff custom field into it. `Referrer`
   remains the master's attribution ID — existing attribution untouched.
3. **Partner Transaction Log (`tbluxSVVoAuhEWLd7`) → `Commission Owed` (`fldz8l8OXLIANKgMb`)
   formula:** add branch `"Master Tier - T3" → {Cash Collected} * 0.20`. (Currently
   unknown tiers fall through to 0 — silent under-accounting if we skip this.)
   The `Affiliate Tier` lookup from Kashu Affiliates flows in automatically.

## 4. Database — migration `026_master_tier_sub_affiliates.sql`

- `ALTER TABLE referred_users ADD COLUMN sub_affiliate_id TEXT NULL;`
  plus index on `(affiliate_id, sub_affiliate_id)`.
- Widen CHECK constraints to include `'master'`:
  `affiliates_tier_check` and `earnings_tier_at_earning_check`
  (both currently `('gold','platinum','custom')`, from mig 013).
- New table `sub_affiliate_labels`:
  `(id UUID PK, affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
    sub_affiliate_id TEXT NOT NULL, label TEXT NOT NULL, created_at, updated_at,
    UNIQUE (affiliate_id, sub_affiliate_id))`.
  RLS: select/insert/update/delete where `affiliate_id = public.get_my_affiliate_id()`.
- **No changes to `get_my_affiliate_id()`, no changes to any other RLS policy** — the
  master is a normal affiliate; all sub data is already their own rows (this follows
  the mig-025 precedent of never widening the RLS chokepoint).

## 5. Sync & tier plumbing

- **`src/app/api/sync/affiliates/route.ts`** — `TIER_MAP` gains
  `"Master Tier - T3": "master"`.
- **`src/app/api/sync/users/route.ts`** — map Launch List `Sub Aff ID` →
  `referred_users.sub_affiliate_id`, `trim()`ed; blank/missing → `null` (= "Direct").
  Missing column in Airtable must not crash the sync.
- **`src/lib/tier.ts`** — `AffiliateTier` union += `'master'`
  (`src/types/database.ts:19`); `COMMISSION_RATES.master = 0.20`.
  `calculateEarning` is table-driven — no other change.
- **Master is sticky** (like `custom`): excluded from gold→platinum auto-upgrade in
  `sync/transactions/route.ts` (~:539-568), `webhooks/wallet/route.ts` (~:239-258), and
  `refresh-leaderboard.ts` `computeTier`/`TIER_ORDER` (~:144-165).
- **Admin `override-tier` stays gold/platinum-only** — masters are designated in Airtable.
- **Earnings:** no structural change. Rows accrue to the master with
  `tier_at_earning: 'master'`; the reconciliation/annealing pass in the transactions
  sync (~:455-498) re-derives via `calculateEarning`, which is table-driven, so master
  earnings reconcile correctly with no special-casing.

## 6. Master dashboard view

- **New page `/dashboard/sub-affiliates`**, nav item ("Sub-Affiliates") visible only when
  `affiliate.tier === 'master'` (nav lives in `src/app/dashboard/layout.tsx`
  `AFFILIATE_NAV`; compose with `filterNavForDelegate`).
- Page contents:
  - **Aggregate rollup** — total users / transacted / conversion / volume, split
    **Direct vs sub-tagged**.
  - **Roster table** — one row per distinct `sub_affiliate_id`: editable label
    (renders "Jake M. (4F2A)"), user count, transacted count, conversion %, volume,
    earnings generated, last activity. Untagged users grouped as a "Direct" row.
  - Per-sub earnings via `earnings` joined to `referred_users.sub_affiliate_id`.
  - Label editing hits a new owner-only API route backed by `sub_affiliate_labels`
    (RLS enforces ownership; guard `isDelegate` → read-only).
- **Delegate interplay:** page visible to delegates, but earnings columns hidden unless
  `can_view_earnings` (matches existing delegate discipline).
- **Tier display:** add `master` branch to `TierBadge` (`src/components/ui/TierBadge.tsx`),
  `AdminTierBadge`, and `TierProgressCard` (achieved-style card, no progress bar —
  masters never auto-upgrade). Check `EarningsCard`/statement code paths that take `tier`.
- **Out of scope v1:** demo-route parity; a "Sub" column on the main Users page
  (nice-to-have follow-up); per-sub drill-down view-as.

## 7. Edge handling

- `sub_affiliate_id` normalized with `trim()` at sync time; empty string stored as NULL.
- Users with no sub ID count as "Direct" — never dropped from rollups.
- Unrecognized tier strings in Airtable still fall back to `gold` (existing behavior).
- Sub IDs are opaque strings — no format assumption beyond trimming.

## 8. Verification

- `npx tsc --noEmit` AND `npm run build` (both, per CLAUDE.md 4C).
- Manual: set a test affiliate to `Master Tier - T3` in Airtable → sync → tier badge +
  nav item appear; seed `Sub Aff ID` on a few Launch List rows → sync → roster groups
  correctly; run a transactions sync over a master-attributed txn → earning = cash
  collected × 20%, `tier_at_earning = 'master'`; confirm Airtable `Commission Owed`
  computes 20% for a Master-tier row.
