import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { fetchAllRecords, patchRecords } from "@/lib/airtable";
import { auditPtlVsUt, buildAnnealPlan } from "@/lib/audit/ptl-audit";
import { createPtlRowFromUt, AnnealError } from "@/lib/audit/ptl-anneal";

export const dynamic = "force-dynamic";

const PTL_TABLE = "tbluxSVVoAuhEWLd7";
const UT_TABLE = "tblyWtDBeiZAqDm8P";

const Body = z.object({ dryRun: z.boolean() });

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
  // Note: fetchAllRecords/patchRecords read AIRTABLE_PAT from process.env directly;
  // `pat` here is the sanitized value passed into createPtlRowFromUt via deps.

  try {
    // Always re-derive the plan from fresh data.
    const [ptl, ut] = await Promise.all([
      fetchAllRecords(affiliateBase, PTL_TABLE),
      fetchAllRecords(launchBase, UT_TABLE),
    ]);
    const months = auditPtlVsUt(ptl.records, ut.records);
    const plan = buildAnnealPlan(months);

    const summary = {
      create: plan.toCreate.length,
      correct: plan.toCorrect.length,
      skip_paid_drifts: plan.skipped.paidDrifts.length,
      skip_orphans: plan.skipped.orphans.length,
    };

    if (parsed.data.dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, summary, plan });
    }

    // Apply: create missing rows (sequential — dupe-guarded inside helper).
    const created: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    for (const row of plan.toCreate) {
      try {
        const r = await createPtlRowFromUt(row.ut_id, { affiliateBase, launchBase, pat });
        created.push(r.ptl_id);
      } catch (e) {
        failed.push({ id: row.ut_id, reason: e instanceof Error ? e.message : "create failed" });
      }
    }

    // Apply: correct unpaid drifts (PATCH Amount = UT amount; batched by helper).
    const corrections = plan.toCorrect.map((d) => ({ id: d.ptl_id, fields: { Amount: d.ut_amount } }));
    const patch = corrections.length > 0
      ? await patchRecords(affiliateBase, PTL_TABLE, corrections)
      : { updated: 0, failed: [] as Array<{ record_id: string; error: string }>, apiCalls: 0 };
    for (const f of patch.failed) failed.push({ id: f.record_id, reason: f.error });

    return NextResponse.json({
      ok: true,
      dryRun: false,
      result: {
        created: created.length,
        corrected: patch.updated,
        failed,
        skipped: { paidDrifts: plan.skipped.paidDrifts.length, orphans: plan.skipped.orphans.length },
      },
    });
  } catch (e) {
    if (e instanceof AnnealError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[audit-ptl/anneal] failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Anneal failed" }, { status: 500 });
  }
}
