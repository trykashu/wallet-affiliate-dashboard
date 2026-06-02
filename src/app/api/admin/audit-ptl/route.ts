import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { fetchAllRecords } from "@/lib/airtable";
import { auditPtlVsUt } from "@/lib/audit/ptl-audit";

export const dynamic = "force-dynamic";

const PTL_TABLE = "tbluxSVVoAuhEWLd7";
const UT_TABLE = "tblyWtDBeiZAqDm8P";

export async function GET() {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const affiliateBase = process.env.AIRTABLE_AFFILIATE_BASE?.replace(/\\n|"|\s/g, "");
  const launchBase = process.env.AIRTABLE_LAUNCH_BASE?.replace(/\\n|"|\s/g, "");
  if (!affiliateBase || !launchBase) {
    return NextResponse.json({ error: "Airtable bases not configured" }, { status: 500 });
  }

  try {
    const [ptl, ut] = await Promise.all([
      fetchAllRecords(affiliateBase, PTL_TABLE),
      fetchAllRecords(launchBase, UT_TABLE),
    ]);
    const months = auditPtlVsUt(ptl.records, ut.records);
    const totals = months.reduce(
      (acc, m) => {
        acc.orphans += m.orphans.length;
        acc.drifts += m.drifts.length;
        acc.missing += m.missing.length;
        return acc;
      },
      { orphans: 0, drifts: 0, missing: 0 },
    );
    return NextResponse.json({
      ok: true,
      generated_at: new Date().toISOString(),
      totals,
      months,
    });
  } catch (e) {
    console.error("[audit-ptl] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Audit failed" },
      { status: 500 },
    );
  }
}
