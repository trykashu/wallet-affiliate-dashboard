// Final cleanup: phases A (demo data), B (James self-referral earning),
// C (Marc/Leonardo NULL-ref dupes + Marc status), E (volume dry-run).

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i < 0) continue;
  let v = line.slice(i + 1).trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  v = v.replace(/\\n/g, "").replace(/\\r/g, "").replace(/\\t/g, "").replace(/\\\\/g, "\\");
  env[line.slice(0, i).trim()] = v;
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const MILES_AFFILIATE_ID = "e688bc95-c53b-4bec-a811-2c761a0ef4e7";
const JAMES_SELF_REFERRAL_EARNING = "af66f817-c070-4512-9aca-0dbbd0aeef33";
const MARC_SURVIVING_EARNING = "df25354c-7b61-494a-a66b-a4fad8249bf9";

console.log("=================================================");
console.log("PHASE A: Delete Miles's demo data");
console.log("=================================================");

// Find demo referred_users under Miles (emails ending in @demo.test)
const { data: demoUsers } = await db
  .from("referred_users")
  .select("id, full_name, email")
  .eq("affiliate_id", MILES_AFFILIATE_ID)
  .ilike("email", "%@demo.test");

console.log(`Demo users under Miles: ${demoUsers?.length}`);
console.table(demoUsers);

const demoUserIds = (demoUsers ?? []).map((u) => u.id);

if (demoUserIds.length) {
  const e1 = await db.from("earnings").delete({ count: "exact" }).in("referred_user_id", demoUserIds);
  console.log(`A.1 earnings deleted: ${e1.count} (err: ${e1.error?.message ?? "none"})`);

  const e2 = await db.from("funnel_events").delete({ count: "exact" }).in("referred_user_id", demoUserIds);
  console.log(`A.2 funnel_events deleted: ${e2.count} (err: ${e2.error?.message ?? "none"})`);

  const e3 = await db.from("transactions").delete({ count: "exact" }).in("referred_user_id", demoUserIds);
  console.log(`A.3 transactions deleted: ${e3.count} (err: ${e3.error?.message ?? "none"})`);

  // Also catch any stray demo_demo_* transactions not linked to these users
  const e3b = await db.from("transactions").delete({ count: "exact" }).like("airtable_record_id", "demo_demo_%");
  console.log(`A.3b stray demo transactions deleted: ${e3b.count} (err: ${e3b.error?.message ?? "none"})`);

  const e4 = await db.from("referred_users").delete({ count: "exact" }).in("id", demoUserIds);
  console.log(`A.4 referred_users deleted: ${e4.count} (err: ${e4.error?.message ?? "none"})`);
}

console.log("\n=================================================");
console.log("PHASE B: Delete James Phillips self-referral earning");
console.log("=================================================");
const b = await db.from("earnings").delete({ count: "exact" }).eq("id", JAMES_SELF_REFERRAL_EARNING);
console.log(`B earnings deleted: ${b.count} (err: ${b.error?.message ?? "none"})`);

console.log("\n=================================================");
console.log("PHASE C: Delete remaining NULL-ref dupes + fix Marc status");
console.log("=================================================");

// Show what's left before deleting
const { data: stillNull } = await db
  .from("earnings")
  .select("id, referred_user_id, amount, status, created_at")
  .is("transaction_ref", null);
console.log(`Remaining NULL-ref earnings: ${stillNull?.length}`);
console.table(stillNull);

// Re-verify each has a ref'd twin
let safe = true;
for (const e of stillNull ?? []) {
  const { data: twins } = await db
    .from("earnings")
    .select("id")
    .eq("referred_user_id", e.referred_user_id)
    .eq("amount", e.amount)
    .not("transaction_ref", "is", null);
  if (!twins || twins.length === 0) {
    console.log(`⚠️ ${e.id} has no ref'd twin — would lose credit`);
    safe = false;
  }
}

if (!safe) {
  console.log("Aborting Phase C deletion — orphans still present.");
} else {
  const c1 = await db.from("earnings").delete({ count: "exact" }).is("transaction_ref", null);
  console.log(`C.1 NULL-ref earnings deleted: ${c1.count} (err: ${c1.error?.message ?? "none"})`);

  const c2 = await db.from("earnings").update({ status: "approved" }).eq("id", MARC_SURVIVING_EARNING);
  console.log(`C.2 Marc's earning → approved (err: ${c2.error?.message ?? "none"})`);
}

console.log("\n=================================================");
console.log("PHASE E (dry-run): referred_volume_total drift");
console.log("=================================================");

const { data: affs } = await db.from("affiliates").select("id, agent_name, referred_volume_total");
const { data: txns } = await db.from("transactions").select("affiliate_id, amount, transaction_type");

const computed = new Map();
for (const t of txns ?? []) {
  if (t.transaction_type !== "Transfer In") continue;
  computed.set(t.affiliate_id, (computed.get(t.affiliate_id) ?? 0) + Number(t.amount || 0));
}

const drift = (affs ?? [])
  .map((a) => ({
    affiliate: a.agent_name,
    current_total: Number(a.referred_volume_total || 0),
    computed: computed.get(a.id) ?? 0,
    delta: (computed.get(a.id) ?? 0) - Number(a.referred_volume_total || 0),
  }))
  .filter((r) => Math.abs(r.delta) > 0.01)
  .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

console.log("Drift (computed - current):");
console.table(drift);

console.log("\n=================================================");
console.log("FINAL VERIFICATION");
console.log("=================================================");

const { count: nullRem } = await db.from("earnings").select("id", { count: "exact", head: true }).is("transaction_ref", null);
console.log(`Earnings with NULL transaction_ref: ${nullRem}`);

const { data: marcCheck } = await db
  .from("earnings")
  .select("id, status, transaction_ref, amount")
  .eq("referred_user_id", "4f78829a-ceb6-477d-a5f5-79523a5feecf");
console.log("Marc Malek's earnings:");
console.table(marcCheck);

const { data: leoCheck } = await db
  .from("earnings")
  .select("id, status, transaction_ref, amount")
  .eq("referred_user_id", "b96635cc-7772-4d81-b191-ee3133d83d58");
console.log("Leonardo Velazco's earnings:");
console.table(leoCheck);

// Dup ref check (should still be 0)
const { data: allRefs } = await db.from("earnings").select("transaction_ref").not("transaction_ref", "is", null);
const counts = {};
for (const r of allRefs ?? []) counts[r.transaction_ref] = (counts[r.transaction_ref] ?? 0) + 1;
const dups = Object.entries(counts).filter(([, n]) => n > 1);
console.log(`True duplicate transaction_refs remaining: ${dups.length}`);
console.table(dups.map(([ref, n]) => ({ ref, count: n })));
