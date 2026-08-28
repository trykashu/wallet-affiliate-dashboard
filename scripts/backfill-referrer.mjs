/**
 * One-time repair: restore lost affiliate attribution on the Airtable Launch List.
 *
 * Context: n8n wrote the Launch List "Referrer" using `.fieldValue` instead of
 * `.fieldValueString`, so it landed blank on ~92% of rows. Because
 * `User Transactions.Referrer` is an Airtable LOOKUP of that field, the blank
 * cascaded into /api/sync/transactions (no earnings) and the Partner
 * Transaction Log (no commission rows).
 *
 * This script re-reads the authoritative value from the HighLevel opportunity
 * custom field "Referrer" (MM9Q4dVku39BJD3rY3MB) and writes it back.
 *
 *   node scripts/backfill-referrer.mjs            # dry run (default)
 *   node scripts/backfill-referrer.mjs --apply    # write to Airtable
 *
 * GHL_CACHE=<file.json> runs the dry run against a saved opportunities
 * snapshot instead of the live API (useful when the PIT is unavailable —
 * Vercel stores it as a sensitive var and will not return it on `env pull`).
 * --apply always requires a live token; a stale snapshot must never drive writes.
 *
 * Safety:
 *   - never overwrites a Launch List row that already has a Referrer
 *   - only writes codes that resolve to a real affiliate attribution_id
 *   - Airtable PATCH batched at 10/request (hard API limit)
 *
 * Env: AIRTABLE_PAT, AIRTABLE_LAUNCH_BASE, AIRTABLE_LAUNCH_TABLE,
 *      HIGHLEVEL_API_KEY, HIGHLEVEL_LOCATION_ID,
 *      NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import fs from "node:fs";

const APPLY = process.argv.includes("--apply");
const REFERRER_FIELD_ID = "MM9Q4dVku39BJD3rY3MB";
const PIPELINE_ID = "zNiCun5Y5koEsWmN9bDo";
const KASHU_FEE = 0.085;
const RATES = { gold: 0.05, platinum: 0.10, custom: 0, master: 0.20 };

function loadEnv() {
  const out = { ...process.env };
  for (const p of [".env.local", process.env.ENV_FILE].filter(Boolean)) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Za-z_0-9]+)=(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      v = v.replace(/\\n/g, "").trim();
      if (v !== "") out[m[1]] = v;
    }
  }
  return out;
}
const env = loadEnv();
const GHL_CACHE = env.GHL_CACHE && fs.existsSync(env.GHL_CACHE) ? env.GHL_CACHE : null;
if (GHL_CACHE && APPLY) {
  console.error("Refusing to --apply from a cached GHL snapshot. Provide HIGHLEVEL_API_KEY and drop GHL_CACHE.");
  process.exit(1);
}
const required = ["AIRTABLE_PAT","AIRTABLE_LAUNCH_BASE","AIRTABLE_LAUNCH_TABLE","NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"];
if (!GHL_CACHE) required.push("HIGHLEVEL_API_KEY", "HIGHLEVEL_LOCATION_ID");
for (const k of required) {
  if (!env[k]) { console.error(`Missing env: ${k}`); process.exit(1); }
}

const atAuth = { Authorization: `Bearer ${env.AIRTABLE_PAT}` };
async function airtableAll(base, tbl) {
  const out = []; let offset;
  do {
    const u = new URL(`https://api.airtable.com/v0/${base}/${tbl}`);
    u.searchParams.set("pageSize", "100");
    if (offset) u.searchParams.set("offset", offset);
    const r = await fetch(u, { headers: atAuth });
    if (!r.ok) throw new Error(`Airtable ${tbl} ${r.status}: ${await r.text()}`);
    const j = await r.json();
    out.push(...j.records); offset = j.offset;
  } while (offset);
  return out;
}
async function sb(path) {
  const out = []; const step = 1000;
  for (let from = 0; ; from += step) {
    const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, Range: `${from}-${from + step - 1}` },
    });
    if (!r.ok) throw new Error(`Supabase ${path} ${r.status}: ${await r.text()}`);
    const j = await r.json(); out.push(...j);
    if (j.length < step) break;
  }
  return out;
}
async function ghlOpportunities() {
  if (GHL_CACHE) {
    const snap = JSON.parse(fs.readFileSync(GHL_CACHE, "utf8"));
    console.log(`!! Using CACHED GHL snapshot (${snap.length} opportunities) from ${GHL_CACHE}`);
    console.log("!! Figures below reflect that snapshot, not live HighLevel.\n");
    return snap;
  }
  const H = { Authorization: `Bearer ${env.HIGHLEVEL_API_KEY}`, Version: "2021-07-28", Accept: "application/json" };
  const out = []; let startAfter, startAfterId, guard = 0;
  while (guard++ < 200) {
    let url = `https://services.leadconnectorhq.com/opportunities/search?location_id=${env.HIGHLEVEL_LOCATION_ID}&pipeline_id=${PIPELINE_ID}&limit=100`;
    if (startAfter !== undefined && startAfterId) url += `&startAfter=${startAfter}&startAfterId=${startAfterId}`;
    const r = await fetch(url, { headers: H });
    if (!r.ok) throw new Error(`GHL ${r.status}: ${await r.text()}`);
    const j = await r.json();
    const opps = j.opportunities || [];
    out.push(...opps);
    if (j.meta?.startAfter && j.meta?.startAfterId && opps.length === 100) {
      startAfter = j.meta.startAfter; startAfterId = j.meta.startAfterId;
    } else break;
  }
  return out;
}
const referrerOf = (opp) => {
  const f = (opp.customFields || []).find((f) => f.id === REFERRER_FIELD_ID);
  const v = f ? (f.fieldValueString ?? f.fieldValue) : null;
  return typeof v === "string" ? v.trim() : null;
};

async function main() {
  console.log(`=== Referrer backfill — ${APPLY ? "APPLY (writes to Airtable)" : "DRY RUN (no writes)"} ===\n`);

  const [launch, utxns, opps, affiliates, referredUsers, earnings] = await Promise.all([
    airtableAll(env.AIRTABLE_LAUNCH_BASE, env.AIRTABLE_LAUNCH_TABLE),
    airtableAll(env.AIRTABLE_LAUNCH_BASE, "tblyWtDBeiZAqDm8P"),
    ghlOpportunities(),
    sb("affiliates?select=id,attribution_id,agent_name,tier,email"),
    sb("referred_users?select=id,affiliate_id,wallet_user_id,created_at"),
    sb("earnings?select=transaction_ref"),
  ]);

  const byAttribution = new Map(affiliates.filter(a => a.attribution_id).map(a => [a.attribution_id.toLowerCase(), a]));
  const oppById = new Map(opps.map(o => [o.id, o]));
  const oppByContact = new Map(opps.map(o => [o.contact?.id || o.contactId, o]));
  const haveEarning = new Set(earnings.map(e => e.transaction_ref).filter(Boolean));
  const ruByContact = new Map(referredUsers.map(u => [u.wallet_user_id, u]));

  // ---- Phase 1: decide Launch List writes -------------------------------
  const updates = [];
  const stats = { blank: 0, noOpp: 0, oppNoReferrer: 0, unknownCode: 0, willWrite: 0, alreadySet: 0 };
  const perAffiliateRows = {};

  for (const rec of launch) {
    const cur = String(rec.fields["Referrer"] ?? "").trim();
    if (cur) { stats.alreadySet++; continue; }   // never overwrite
    stats.blank++;
    const opp = (rec.fields["Opportunity ID"] && oppById.get(rec.fields["Opportunity ID"]))
             || (rec.fields["Contact ID"] && oppByContact.get(rec.fields["Contact ID"]));
    if (!opp) { stats.noOpp++; continue; }
    const code = referrerOf(opp);
    if (!code) { stats.oppNoReferrer++; continue; }
    const aff = byAttribution.get(code.toLowerCase());
    if (!aff) { stats.unknownCode++; continue; }
    stats.willWrite++;
    updates.push({ id: rec.id, fields: { Referrer: code } });
    const k = `${aff.agent_name} [${aff.tier}]`;
    perAffiliateRows[k] = (perAffiliateRows[k] || 0) + 1;
  }

  console.log("LAUNCH LIST");
  console.log(`  rows total                      : ${launch.length}`);
  console.log(`  already have a Referrer (skip)  : ${stats.alreadySet}`);
  console.log(`  blank Referrer                  : ${stats.blank}`);
  console.log(`     no matching GHL opportunity  : ${stats.noOpp}`);
  console.log(`     opportunity has no Referrer  : ${stats.oppNoReferrer}`);
  console.log(`     code matches no affiliate    : ${stats.unknownCode}`);
  console.log(`     >>> WOULD WRITE              : ${stats.willWrite}`);

  // ---- Phase 2: downstream commission impact ----------------------------
  const willHaveRef = new Set(updates.map(u => u.id));
  const launchById = new Map(launch.map(r => [r.id, r]));
  let owedN = 0, owedTPV = 0, owedComm = 0, outOfWindow = 0, alreadyPaid = 0;
  const perAffiliateComm = {};

  for (const t of utxns) {
    const f = t.fields;
    if (f["Transaction Type"] !== "Transfer In") continue;
    const amt = Number(f["Amount"]) || 0;
    if (amt <= 0) continue;
    if ((f["Referrer"] || [])[0]) continue;                 // already attributed
    const link = (f["Launch List Link"] || [])[0];
    if (!link || !willHaveRef.has(link)) continue;           // unaffected by this backfill
    if (haveEarning.has(t.id)) { alreadyPaid++; continue; }
    const ll = launchById.get(link);
    const u = ll?.fields?.["Contact ID"] ? ruByContact.get(ll.fields["Contact ID"]) : null;
    if (!u) continue;
    const aff = affiliates.find(a => a.id === u.affiliate_id);
    if (!aff) continue;
    if (aff.email && ll.fields["Email"] && aff.email.toLowerCase() === String(ll.fields["Email"]).toLowerCase()) continue;
    const d = f["Date Txn Started"] ? new Date(f["Date Txn Started"]) : null;
    const cutoff = new Date(u.created_at); cutoff.setMonth(cutoff.getMonth() + 1);
    if (!d || d > cutoff) { outOfWindow++; continue; }
    owedN++; owedTPV += amt;
    const c = amt * KASHU_FEE * (RATES[aff.tier] ?? 0.05);
    owedComm += c;
    const k = `${aff.agent_name} [${aff.tier}]`;
    perAffiliateComm[k] = perAffiliateComm[k] || { n: 0, tpv: 0, c: 0 };
    perAffiliateComm[k].n++; perAffiliateComm[k].tpv += amt; perAffiliateComm[k].c += c;
  }

  console.log("\nDOWNSTREAM (after re-running /api/sync/transactions)");
  console.log(`  transactions already earning     : ${alreadyPaid}`);
  console.log(`  outside 1-month earning window   : ${outOfWindow}`);
  console.log(`  >>> earnings that would be created: ${owedN}`);
  console.log(`  >>> TPV unlocked                  : $${owedTPV.toLocaleString(undefined,{maximumFractionDigits:2})}`);
  console.log(`  >>> commission owed               : $${owedComm.toFixed(2)}`);
  console.log("\n  by affiliate:");
  Object.entries(perAffiliateComm).sort((a,b)=>b[1].c-a[1].c)
    .forEach(([k,v]) => console.log(`    $${v.c.toFixed(2).padStart(9)}  ${String(v.n).padStart(3)} txns  TPV $${v.tpv.toLocaleString().padStart(11)}  ${k}`));

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to write ${updates.length} Launch List rows.`);
    return;
  }

  // ---- Phase 3: write ---------------------------------------------------
  let ok = 0; const failures = [];
  for (let i = 0; i < updates.length; i += 10) {
    const batch = updates.slice(i, i + 10);
    const r = await fetch(`https://api.airtable.com/v0/${env.AIRTABLE_LAUNCH_BASE}/${env.AIRTABLE_LAUNCH_TABLE}`, {
      method: "PATCH",
      headers: { ...atAuth, "Content-Type": "application/json" },
      body: JSON.stringify({ records: batch, typecast: false }),
    });
    if (!r.ok) { failures.push(`batch ${i}: ${r.status} ${(await r.text()).slice(0,200)}`); continue; }
    ok += ((await r.json()).records || []).length;
    process.stdout.write(`\r  written ${ok}/${updates.length}`);
  }
  console.log(`\n\nWROTE ${ok} Launch List rows.`);
  if (failures.length) { console.log("FAILURES:"); failures.forEach(f => console.log("  " + f)); }
  console.log("\nNext: re-run /api/sync/transactions (creates earnings, dedups on transaction_ref),");
  console.log("then the PTL anneal to create the matching Partner Transaction Log rows.");
}
main().catch(e => { console.error(e); process.exit(1); });
