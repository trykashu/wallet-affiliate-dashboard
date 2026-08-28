/**
 * Populate the Partner Transaction Log from User Transactions.
 *
 * Mirrors POST /api/admin/audit-ptl/anneal, which is session-gated on
 * isAdminEmail and therefore cannot be driven from a script. Uses the same
 * pure planner (auditPtlVsUt -> buildAnnealPlan) and the same row builder
 * (createPtlRowFromUt), so behaviour matches the admin UI exactly.
 *
 *   npx tsx scripts/anneal-ptl.mts            # dry run (default)
 *   npx tsx scripts/anneal-ptl.mts --apply    # create PTL rows
 *
 * Safety:
 *   - createPtlRowFromUt refuses (409) if a PTL row already exists for the
 *     Transaction ID, so re-running is safe and cannot double-book.
 *   - Payova/whitelabel and test attributions are excluded by the planner's
 *     DEFAULT_CONFIG.excludedReferrers, so the PTL stays Kashu-only.
 *   - Throttled to stay inside Airtable's 5 req/sec (4 requests per row).
 */
import fs from "node:fs";
import { auditPtlVsUt, buildAnnealPlan } from "../src/lib/audit/ptl-audit";
import { createPtlRowFromUt, AnnealError } from "../src/lib/audit/ptl-anneal";

const APPLY = process.argv.includes("--apply");
const PTL_TABLE = "tbluxSVVoAuhEWLd7";
const UT_TABLE = "tblyWtDBeiZAqDm8P";
const ROW_DELAY_MS = Number(process.env.ROW_DELAY_MS ?? 1000);

function parseEnvFile(p: string): Record<string, string> {
  const o: Record<string, string> = {};
  if (!fs.existsSync(p)) return o;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z_0-9]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    v = v.replace(/\\n/g, "").trim();
    if (v !== "") o[m[1]] = v;
  }
  return o;
}
const env = { ...process.env, ...parseEnvFile(".env.local"), ...parseEnvFile(process.env.ENV_FILE ?? "") } as Record<string, string>;
const pat = env.AIRTABLE_PAT;
const affiliateBase = env.AIRTABLE_AFFILIATE_BASE;
const launchBase = env.AIRTABLE_LAUNCH_BASE;
if (!pat || !affiliateBase || !launchBase) {
  console.error("Missing AIRTABLE_PAT / AIRTABLE_AFFILIATE_BASE / AIRTABLE_LAUNCH_BASE");
  process.exit(1);
}

async function fetchAll(base: string, tbl: string) {
  const out: any[] = []; let offset: string | undefined;
  do {
    const u = new URL(`https://api.airtable.com/v0/${base}/${tbl}`);
    u.searchParams.set("pageSize", "100");
    if (offset) u.searchParams.set("offset", offset);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${pat}` } });
    if (!r.ok) throw new Error(`${tbl} ${r.status}: ${await r.text()}`);
    const j: any = await r.json();
    out.push(...j.records); offset = j.offset;
  } while (offset);
  return out;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`=== PTL anneal — ${APPLY ? "APPLY (creates rows)" : "DRY RUN (no writes)"} ===\n`);
  const [ptl, ut] = await Promise.all([fetchAll(affiliateBase, PTL_TABLE), fetchAll(launchBase, UT_TABLE)]);
  const months = auditPtlVsUt(ptl, ut);
  const plan = buildAnnealPlan(months);

  const byMonth: Record<string, { n: number; sum: number }> = {};
  for (const m of months) {
    for (const r of m.missing) {
      byMonth[m.month] = byMonth[m.month] || { n: 0, sum: 0 };
      byMonth[m.month].n++; byMonth[m.month].sum += r.amount;
    }
  }
  console.log(`PTL rows now: ${ptl.length}   |   User Transactions: ${ut.length}`);
  console.log(`toCreate: ${plan.toCreate.length}   toCorrect(drift): ${plan.toCorrect.length}   skipped orphans: ${plan.skipped.orphans.length}`);
  console.log(`still unattributed (cannot create): ${months.reduce((t, m) => t + m.unattributed.length, 0)}\n`);
  console.log("rows to create, by month:");
  Object.entries(byMonth).sort().forEach(([m, v]) => console.log(`  ${m}  ${String(v.n).padStart(4)} rows   $${v.sum.toLocaleString()}`));
  const total = Object.values(byMonth).reduce((t, v) => t + v.sum, 0);
  console.log(`  TOTAL ${plan.toCreate.length} rows   $${total.toLocaleString()}`);

  if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with --apply."); return; }

  console.log(`\ncreating (throttled ${ROW_DELAY_MS}ms/row)...`);
  let created = 0, existed = 0;
  const failures: string[] = [];
  for (const row of plan.toCreate) {
    try {
      await createPtlRowFromUt(row.ut_id, { affiliateBase, launchBase, pat });
      created++;
    } catch (e) {
      if (e instanceof AnnealError && e.status === 409) existed++;
      else failures.push(`${row.transaction_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if ((created + existed + failures.length) % 10 === 0) {
      process.stdout.write(`\r  ${created} created, ${existed} already existed, ${failures.length} failed`);
    }
    await sleep(ROW_DELAY_MS);
  }
  console.log(`\n\nDONE — created ${created}, already existed ${existed}, failed ${failures.length}`);
  if (failures.length) { console.log("\nFAILURES:"); failures.slice(0, 25).forEach((f) => console.log("  " + f)); }
}
main().catch((e) => { console.error(e); process.exit(1); });
