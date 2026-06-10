/**
 * GET /api/cron/payova-weekly-payout
 *
 * Weekly (Fridays): reflect the external Payova weekly payment in the dashboard.
 * For the previous full Sat→Fri week, mark that week's Payova earnings `paid`
 * and write one `completed` payout row per affiliate. Reflection only — no money
 * is moved and Mercury is never called (Payova's payout system is external).
 *
 * Protected by CRON_SECRET (Bearer) or an admin session. Supports ?dryRun=1.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { markPayovaWeekPaid, previousSatFriWeek } from "@/lib/payouts/payova-weekly";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const hasCronSecret = cronSecret && authHeader === `Bearer ${cronSecret}`;

  let isAdmin = false;
  if (!hasCronSecret) {
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      isAdmin = !!user && isAdminEmail(user.email);
    } catch { /* no session */ }
  }
  if (!hasCronSecret && !isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  const { weekStart, weekEnd, paidAt } = previousSatFriWeek(new Date());
  const result = await markPayovaWeekPaid(svc, { weekStart, weekEnd, paidAt, dryRun });

  return NextResponse.json({ ok: true, ...result });
}
