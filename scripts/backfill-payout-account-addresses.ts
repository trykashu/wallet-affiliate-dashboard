/* eslint-disable @typescript-eslint/no-explicit-any */
// One-shot heal: re-fetches PandaDoc for every payout_account whose
// address columns are null. Saves the extracted address. Skips affiliates
// without pandadoc_id and reports what fields couldn't be extracted.
//
// Run: npx tsx scripts/backfill-payout-account-addresses.ts
// Idempotent: re-run is a no-op for already-filled rows.
import { createClient } from "@supabase/supabase-js";
import { fetchDocumentFields, extractBankDetails } from "../src/lib/pandadoc";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\\n|"|\s/g, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/\\n|"|\s/g, "");
if (!URL || !KEY) { console.error("Missing env"); process.exit(1); }
const supa = createClient(URL, KEY, { auth: { persistSession: false } });

(async () => {
  const { data: accts } = await (supa as any).from("payout_accounts")
    .select("id, affiliate_id, address1, city, region, postal_code")
    .or("address1.is.null,city.is.null,region.is.null,postal_code.is.null");

  console.log(`Found ${(accts ?? []).length} payout_accounts missing address fields.`);
  if (!accts || accts.length === 0) return;

  const affiliateIds = Array.from(new Set(accts.map((a: any) => a.affiliate_id)));
  const { data: affs } = await (supa as any).from("affiliates")
    .select("id, agent_name, pandadoc_id")
    .in("id", affiliateIds);
  const affMap = new Map<string, { agent_name: string; pandadoc_id: string | null }>();
  for (const a of affs ?? []) affMap.set(a.id, a);

  let updated = 0; let skipped = 0;
  for (const acct of accts as any[]) {
    const aff = affMap.get(acct.affiliate_id);
    if (!aff?.pandadoc_id) { skipped++; console.log(`  - ${aff?.agent_name ?? acct.affiliate_id}: no pandadoc_id, skipping`); continue; }

    try {
      const fields = await fetchDocumentFields(aff.pandadoc_id);
      const ex = extractBankDetails(fields);
      const payload: Record<string, unknown> = {};
      if (ex.address1) payload.address1 = ex.address1;
      if (ex.address2) payload.address2 = ex.address2;
      if (ex.city) payload.city = ex.city;
      if (ex.region) payload.region = ex.region;
      if (ex.postal_code) payload.postal_code = ex.postal_code;
      if (ex.country) payload.country = ex.country;
      if (Object.keys(payload).length === 0) { skipped++; console.warn(`  ! ${aff.agent_name}: no address extracted`); continue; }
      payload.updated_at = new Date().toISOString();
      const { error } = await (supa as any).from("payout_accounts").update(payload).eq("id", acct.id);
      if (error) { skipped++; console.error(`  ! ${aff.agent_name}: update failed: ${error.message}`); continue; }
      updated++;
      console.log(`  ✓ ${aff.agent_name}: ${ex.address1}, ${ex.city}, ${ex.region} ${ex.postal_code}`);
    } catch (e) {
      skipped++;
      console.error(`  ! ${aff?.agent_name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\ndone: ${updated} updated, ${skipped} skipped`);
})().catch((e) => { console.error(e); process.exit(1); });
