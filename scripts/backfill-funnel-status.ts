/* eslint-disable @typescript-eslint/no-explicit-any */
// One-time heal of referred_users whose status_slug is regressed below
// transaction_run despite having first_transaction_amount set. Advances
// them to transaction_run and inserts the corresponding funnel_event.
//
// Run: npx tsx scripts/backfill-funnel-status.ts
// Idempotent: re-running after success is a no-op.
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\\n|"|\s/g, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/\\n|"|\s/g, "");
if (!URL || !KEY) { console.error("Missing env"); process.exit(1); }
const supa = createClient(URL, KEY, { auth: { persistSession: false } });

const PRE_TXN_STATUSES = ["waitlist", "booked_call", "sent_onboarding", "signed_up"];

(async () => {
  const { data: stuck, error: queryErr } = await (supa as any)
    .from("referred_users")
    .select("id, full_name, status_slug, first_transaction_amount, first_transaction_at")
    .not("first_transaction_amount", "is", null)
    .gt("first_transaction_amount", 0)
    .in("status_slug", PRE_TXN_STATUSES);

  if (queryErr) { console.error(queryErr); process.exit(1); }

  type StuckRow = {
    id: string; full_name: string; status_slug: string;
    first_transaction_amount: number; first_transaction_at: string | null;
  };
  const rows = (stuck ?? []) as StuckRow[];
  console.log(`Found ${rows.length} stuck users.`);
  if (rows.length === 0) { console.log("Nothing to do."); return; }

  let advanced = 0;
  let eventsCreated = 0;
  for (const r of rows) {
    console.log(`  advancing ${r.full_name} (${r.status_slug} → transaction_run)`);

    const { error: updErr } = await (supa as any)
      .from("referred_users")
      .update({
        status_slug: "transaction_run",
        updated_at: new Date().toISOString(),
      })
      .eq("id", r.id)
      .in("status_slug", PRE_TXN_STATUSES);

    if (updErr) {
      console.warn(`  WARN: update failed for ${r.full_name}: ${updErr.message}`);
      continue;
    }
    advanced++;

    const { error: evtErr } = await (supa as any)
      .from("funnel_events")
      .insert({
        referred_user_id: r.id,
        from_status: r.status_slug,
        to_status: "transaction_run",
      });
    if (!evtErr) eventsCreated++;
  }

  console.log(`done: advanced ${advanced}, funnel events created ${eventsCreated}`);
})().catch((e) => { console.error(e); process.exit(1); });
