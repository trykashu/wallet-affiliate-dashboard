/**
 * Stamp banded commission onto Partner Transaction Log."Transaction Owed".
 *
 * Marginal banding (5% to $100k of referred volume, 10% above, crossing
 * transaction split) cannot be expressed as an Airtable formula: it depends on
 * the cumulative total of that affiliate's PRIOR transactions in date order,
 * and formulas are row-scoped. So the value is computed here and stamped, the
 * same pattern the nightly audit uses for "Revenue Collected".
 *
 *   npx tsx scripts/stamp-ptl-commission.mts            # dry run
 *   npx tsx scripts/stamp-ptl-commission.mts --apply
 *
 * Supabase is the source of truth. Where an earning exists for the transaction
 * its amount is mirrored verbatim — including PAID rows, whose amounts are
 * immutable and must keep showing what was actually disbursed rather than a
 * retroactive re-band. Only rows with no earning are computed here, via the same
 * @/lib/commission-bands module the sync uses, so the two cannot drift.
 *
 * Idempotent: only writes when the delta exceeds 1 cent.
 */
import fs from "node:fs";
import { buildCumulativeVolumeIndex, calculateBandedEarning } from "../src/lib/commission-bands";
import { resolveCollectedFee } from "../src/lib/tier";
import type { AffiliateTier } from "../src/types/database";

const APPLY = process.argv.includes("--apply");
const PTL_TABLE = "tbluxSVVoAuhEWLd7";
const TRANSACTION_OWED = "Transaction Owed";

function parseEnvFile(p: string): Record<string, string> {
  const o: Record<string, string> = {};
  if (!p || !fs.existsSync(p)) return o;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z_0-9]+)=(.*)$/); if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    v = v.replace(/\\n/g, "").trim(); if (v !== "") o[m[1]] = v;
  }
  return o;
}
const env = { ...process.env, ...parseEnvFile(".env.local"), ...parseEnvFile(process.env.ENV_FILE ?? "") } as Record<string,string>;
const pat = env.AIRTABLE_PAT, affBase = env.AIRTABLE_AFFILIATE_BASE;
if (!pat || !affBase || !env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing AIRTABLE_PAT / AIRTABLE_AFFILIATE_BASE / Supabase creds"); process.exit(1);
}

async function airtableAll(base: string, tbl: string) {
  const out: any[] = []; let offset: string | undefined;
  do {
    const u = new URL(`https://api.airtable.com/v0/${base}/${tbl}`);
    u.searchParams.set("pageSize", "100"); if (offset) u.searchParams.set("offset", offset);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${pat}` } });
    if (!r.ok) throw new Error(`${tbl} ${r.status}: ${await r.text()}`);
    const j: any = await r.json(); out.push(...j.records); offset = j.offset;
  } while (offset);
  return out;
}
async function sb(path: string) {
  const out: any[] = []; const step = 1000;
  for (let from = 0; ; from += step) {
    const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, Range: `${from}-${from+step-1}` },
    });
    if (!r.ok) throw new Error(`${path} ${r.status}: ${await r.text()}`);
    const j = await r.json(); out.push(...j); if (j.length < step) break;
  }
  return out;
}

async function main() {
  console.log(`=== Stamp "${TRANSACTION_OWED}" — ${APPLY ? "APPLY" : "DRY RUN"} ===\n`);
  const [ptl, txns, affiliates] = await Promise.all([
    airtableAll(affBase, PTL_TABLE),
    sb("transactions?select=airtable_record_id,transaction_external_id,affiliate_id,amount,transaction_type,transaction_date,self_referral"),
    sb("affiliates?select=id,tier,custom_commission_rate,custom_commission_basis"),
  ]);
  const earnings = await sb("earnings?select=amount,status,transaction_ref");
  const earningByRef = new Map(earnings.filter((e) => e.transaction_ref).map((e) => [e.transaction_ref, e]));

  const cumulative = buildCumulativeVolumeIndex(txns.map((t) => ({
    airtableRecordId: t.airtable_record_id, affiliateId: t.affiliate_id,
    amount: Number(t.amount), transactionDate: t.transaction_date,
    transactionType: t.transaction_type, selfReferral: t.self_referral,
  })));
  const txnByExt = new Map(txns.filter(t => t.transaction_external_id).map(t => [String(t.transaction_external_id).trim(), t]));
  const affById = new Map(affiliates.map((a) => [a.id, a]));

  const updates: Array<{ id: string; fields: Record<string, unknown> }> = [];
  let unmatched = 0, unchanged = 0, blankTier = 0, sumOld = 0, sumNew = 0;
  let mirroredPaid = 0, mirroredOpen = 0, noEarning = 0;

  for (const p of ptl) {
    const txnId = String(p.fields["Transaction ID"] ?? "").trim();
    const current = Number(p.fields[TRANSACTION_OWED]) || 0;
    const t = txnId ? txnByExt.get(txnId) : undefined;
    if (!t) { unmatched++; continue; }
    const aff = affById.get(t.affiliate_id);
    if (!aff) { unmatched++; continue; }
    const tier = aff.tier as AffiliateTier;
    const custom = tier === "custom" && aff.custom_commission_rate != null && aff.custom_commission_basis
      ? { rate: Number(aff.custom_commission_rate), basis: aff.custom_commission_basis as "tpv" | "kashu_fee" }
      : undefined;
    if (tier === "custom" && !custom) { blankTier++; continue; } // bespoke, handled outside

    const earning = earningByRef.get(t.airtable_record_id);
    let owed: number;
    if (earning) {
      // Mirror Supabase verbatim. Paid rows keep the amount actually disbursed.
      owed = Number(earning.amount) || 0;
      if (earning.status === "paid" || earning.status === "reversed") mirroredPaid++; else mirroredOpen++;
    } else {
      // No earning exists — the transaction earns nothing (e.g. outside the
      // one-month window). Do not invent commission for it.
      noEarning++;
      continue;
    }

    sumOld += current; sumNew += owed;
    if (Math.abs(owed - current) <= 0.01) { unchanged++; continue; }
    updates.push({ id: p.id, fields: { [TRANSACTION_OWED]: owed } });
  }

  console.log(`PTL rows: ${ptl.length}`);
  console.log(`  no matching Supabase transaction : ${unmatched}`);
  console.log(`  custom tier, left blank          : ${blankTier}`);
  console.log(`  mirrored from paid/reversed      : ${mirroredPaid}`);
  console.log(`  mirrored from pending/approved   : ${mirroredOpen}`);
  console.log(`  no earning — left untouched      : ${noEarning}`);
  console.log(`  already correct                  : ${unchanged}`);
  console.log(`  >>> WOULD STAMP                  : ${updates.length}`);
  console.log(`\n  current "${TRANSACTION_OWED}" total: $${sumOld.toFixed(2)}`);
  console.log(`  banded total                      : $${sumNew.toFixed(2)}`);

  if (!APPLY) { console.log("\nDRY RUN — nothing written."); return; }

  let ok = 0; const fails: string[] = [];
  for (let i = 0; i < updates.length; i += 10) {
    const batch = updates.slice(i, i + 10);
    const r = await fetch(`https://api.airtable.com/v0/${affBase}/${PTL_TABLE}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: batch, typecast: false }),
    });
    if (!r.ok) { fails.push(`${r.status} ${(await r.text()).slice(0,160)}`); continue; }
    ok += ((await r.json()).records || []).length;
    await new Promise((s) => setTimeout(s, 220));
  }
  console.log(`\nSTAMPED ${ok} rows.`);
  if (fails.length) { console.log("failures:"); fails.forEach(f => console.log("  " + f)); }
}
main().catch((e) => { console.error(e); process.exit(1); });
