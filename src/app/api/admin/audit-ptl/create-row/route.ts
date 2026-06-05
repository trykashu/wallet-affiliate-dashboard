/** POST { ut_record_id } — create a Partner Transaction Log row from a User Transactions row (admin only). Delegates to createPtlRowFromUt. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { createPtlRowFromUt, AnnealError } from "@/lib/audit/ptl-anneal";

export const dynamic = "force-dynamic";

const Body = z.object({ ut_record_id: z.string().min(1) });

export async function POST(req: Request) {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const affiliateBase = process.env.AIRTABLE_AFFILIATE_BASE?.replace(/\\n|"|\s/g, "");
  const launchBase = process.env.AIRTABLE_LAUNCH_BASE?.replace(/\\n|"|\s/g, "");
  const pat = process.env.AIRTABLE_PAT?.replace(/\\n|"|\s/g, "");
  if (!affiliateBase || !launchBase || !pat) {
    return NextResponse.json({ error: "Airtable not configured" }, { status: 500 });
  }

  try {
    const r = await createPtlRowFromUt(parsed.data.ut_record_id, { affiliateBase, launchBase, pat });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof AnnealError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[audit-ptl/create-row] failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Create failed" }, { status: 500 });
  }
}
