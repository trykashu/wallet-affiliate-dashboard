/* eslint-disable @typescript-eslint/no-explicit-any */
// Seeds initial social copy templates into affiliate_share_templates.
// Idempotent: skips a row if a template with the same title already exists.
// Run: npx tsx scripts/seed-share-templates.ts
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\\n|"|\s/g, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/\\n|"|\s/g, "");
if (!URL || !KEY) { console.error("Missing env"); process.exit(1); }
const supa = createClient(URL, KEY, { auth: { persistSession: false } });

const TEMPLATES = [
  { title: "Intro post — long form",    platform: "linkedin",  category: "intro",
    body: "I've been recommending @Kashu to friends and clients lately — it's the cleanest wallet experience I've used. If you want to give it a try, here's my link: {{referral_link}}",
    sort_order: 10 },
  { title: "Intro post — short",        platform: "twitter",   category: "intro",
    body: "If you want to try a wallet that just works, this is it 👇 {{referral_link}}",
    sort_order: 20 },
  { title: "Instagram caption — intro", platform: "instagram", category: "intro",
    body: "New favorite app drop 🔗 — {{referral_link}}\n\n— {{agent_name}}",
    sort_order: 30 },
  { title: "Case study — testimonial",  platform: "linkedin",  category: "case-study",
    body: "Helped a client move funds in under 5 minutes. {{business_name}} stands behind Kashu — try it: {{referral_link}}",
    sort_order: 40 },
  { title: "Promo — referral nudge",    platform: "general",   category: "promo",
    body: "Thinking about trying Kashu? Use my link and I'll walk you through setup: {{referral_link}}",
    sort_order: 50 },
  { title: "Follow-up — DM",            platform: "general",   category: "follow-up",
    body: "Hey {{agent_name}} here — circling back on the wallet I mentioned. My link: {{referral_link}}",
    sort_order: 60 },
];

(async () => {
  let inserted = 0;
  let skipped = 0;
  for (const t of TEMPLATES) {
    const { data: existing } = await (supa as any)
      .from("affiliate_share_templates").select("id").eq("title", t.title).limit(1);
    if (existing?.length) { skipped++; continue; }
    const { error } = await (supa as any).from("affiliate_share_templates")
      .insert({ ...t, is_published: true });
    if (error) throw error;
    inserted++;
  }
  console.log(`done: ${inserted} inserted, ${skipped} already existed`);
})().catch((e) => { console.error(e); process.exit(1); });
