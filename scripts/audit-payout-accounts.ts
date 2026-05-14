/* eslint-disable @typescript-eslint/no-explicit-any */
// Flags existing payout_accounts whose stored full_account_number (in metadata)
// looks like a phone number or whose account_name looks like a widget label.
// Read-only — does NOT modify rows. Prints rows the AM should re-verify via
// the BankPreviewDrawer ("Re-verify" button on /admin/affiliates).
//
// Run: npx tsx scripts/audit-payout-accounts.ts
import { createClient } from "@supabase/supabase-js";
import { looksLikeUsPhone, looksLikeWidgetLabel } from "../src/lib/bank-quality";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\\n|"|\s/g, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/\\n|"|\s/g, "");
if (!URL || !KEY) { console.error("Missing env"); process.exit(1); }
const supa = createClient(URL, KEY, { auth: { persistSession: false } });

(async () => {
  const { data, error } = await (supa as any)
    .from("payout_accounts")
    .select("id, affiliate_id, account_name, account_number_last4, routing_number, metadata, created_at")
    .order("created_at", { ascending: false });
  if (error) { console.error(error); process.exit(1); }

  type Row = {
    id: string; affiliate_id: string; account_name: string | null;
    account_number_last4: string | null; routing_number: string | null;
    metadata: { full_account_number?: string } | null; created_at: string;
  };

  const flagged: { row: Row; reasons: string[] }[] = [];
  for (const row of (data ?? []) as Row[]) {
    const reasons: string[] = [];
    const full = row.metadata?.full_account_number ?? "";
    const cleaned = full.replace(/[\s\-]/g, "");
    if (full && looksLikeUsPhone(full, cleaned)) {
      reasons.push("full_account_number looks phone-shaped");
    }
    if (row.account_name && looksLikeWidgetLabel(row.account_name)) {
      reasons.push(`account_name is a widget label ('${row.account_name}')`);
    }
    if (reasons.length > 0) flagged.push({ row, reasons });
  }

  console.log(`Audited ${(data ?? []).length} payout_accounts. ${flagged.length} flagged.`);
  for (const f of flagged) {
    console.log("---");
    console.log(`  id:          ${f.row.id}`);
    console.log(`  affiliate:   ${f.row.affiliate_id}`);
    console.log(`  name:        ${f.row.account_name}`);
    console.log(`  last4:       ${f.row.account_number_last4}`);
    console.log(`  routing:     ${f.row.routing_number}`);
    console.log(`  created:     ${f.row.created_at}`);
    console.log(`  reasons:     ${f.reasons.join("; ")}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
