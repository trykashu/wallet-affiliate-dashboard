# Payouts Page Simplification — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the payout request flow from the affiliate portal (payouts are admin-automated), and change bank account entry from a primary action to an "update" flow since bank info is collected at agreement signing.

**Architecture:** Delete PayoutRequestModal and the request API route. Simplify PayoutSummary to remove the request button. Restructure PayoutsClient to show payout history + bank account info (read-only with an "Update" option). Add next payout date info matching the EarningsCard pattern.

**Tech Stack:** React 18, Next.js, Tailwind CSS, Supabase

---

## Current State

- `PayoutSummary` — shows available balance + "Request Payout" button → **remove button**
- `PayoutRequestModal` — modal form for requesting payouts → **delete entirely**
- `PayoutsClient` — orchestrator with modal state, balance calc, renders BankAccountForm prominently → **simplify**
- `PayoutAccountCard` — shows Stripe Connect status → **keep but simplify**
- `BankAccountForm` — full bank entry form shown prominently → **hide behind "Update" button**
- `src/app/api/payouts/request/route.ts` — POST endpoint for payout requests → **delete**

## Target State

- Payouts page shows: payout schedule info, payout history, and bank account on file (with "Update" option)
- No "Request Payout" button anywhere
- Bank account section shows current info read-only, with an "Update Bank Details" toggle to edit
- Next payout date displayed (same logic: 15th of following month)

---

### Task 1: Simplify PayoutsClient — Remove Request Flow

**Files:**
- Modify: `src/components/dashboard/PayoutsClient.tsx`

**Step 1: Read the current file**

Read `src/components/dashboard/PayoutsClient.tsx`

**Step 2: Remove:**
- `PayoutRequestModal` import and render
- `showModal` / `setShowModal` state
- `onRequestPayout` prop passed to PayoutSummary
- Modal-related logic

**Step 3: Restructure layout:**
Instead of the current 3-column grid (Summary + BankAccountForm), use:
1. Payout schedule card (full width) — shows next payout date, period covered, and payout method
2. Bank account on file (shows current bank info read-only, "Update" button reveals BankAccountForm)
3. Payout history table (full width)

**Step 4: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 5: Commit**

```bash
git commit -m "feat: simplify payouts — remove request flow, add payout schedule"
```

---

### Task 2: Update PayoutSummary — Remove Request Button

**Files:**
- Modify: `src/components/dashboard/PayoutSummary.tsx`

**Step 1: Read the current file**

**Step 2: Remove:**
- "Request Payout" button
- `onRequestPayout` prop
- Any disabled/enabled logic for the button

**Step 3: Keep:**
- Available balance display
- Pending payout amount
- Total paid out
- Add: "Payouts are processed automatically on the 15th of each month" note

**Step 4: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 5: Commit**

```bash
git commit -m "fix: remove request payout button, add auto-payout note"
```

---

### Task 3: Update Bank Account Section — Read-Only with Update Toggle

**Files:**
- Modify: `src/components/dashboard/PayoutsClient.tsx` (if not already done in Task 1)

**Step 1: Change the bank account display**

Current: BankAccountForm is always shown prominently for entry.
New: Show bank info on file as read-only (account name, last 4, routing). Show an "Update Bank Details" button that toggles the BankAccountForm visible.

If no bank account exists: Show "No bank account on file — your bank details will be collected when you sign your agreement." with a small "Add manually" link that reveals the form.

**Step 2: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 3: Commit**

```bash
git commit -m "feat: bank account read-only by default with update toggle"
```

---

### Task 4: Delete Unused Files

**Files:**
- Delete: `src/components/dashboard/PayoutRequestModal.tsx`
- Delete: `src/app/api/payouts/request/route.ts`

**Step 1: Verify no remaining imports**

```bash
grep -rn "PayoutRequestModal\|payouts/request" src/
```

If any remaining imports, remove them.

**Step 2: Delete the files**

**Step 3: Build and verify**

```bash
npx tsc --noEmit && npm run build
```

**Step 4: Commit**

```bash
git commit -m "chore: delete PayoutRequestModal and payout request API route"
```

---

### Task 5: Deploy and Verify

**Step 1: Push and deploy**

```bash
git push origin main
vercel --prod --yes
```

---

## Summary

| Task | What | Impact |
|------|------|--------|
| 1 | Simplify PayoutsClient | Remove modal, restructure layout |
| 2 | Update PayoutSummary | Remove request button, add auto-payout note |
| 3 | Bank account read-only | Show info on file, toggle to update |
| 4 | Delete unused files | Clean up modal + API route |
| 5 | Deploy | Ship it |

**Total: 5 tasks.**
