import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";
import { generateStatement } from "@/lib/statement/generate";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: payoutId } = await params;

  const supa = await createClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  const result = await generateStatement(svc, payoutId);

  if (!result.ok) {
    return NextResponse.json(
      result.reason ? { error: result.error, reason: result.reason } : { error: result.error },
      { status: result.status },
    );
  }

  await logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: "admin.statement_generated",
    resourceType: "payouts",
    resourceId: payoutId,
    metadata: {
      period: result.period,
      supabase_url: result.url,
      airtable_record_id: result.airtable_record_id,
      airtable_error: result.airtable_error,
      eligible_count: result.eligible_count,
      commission_due: result.commission_due,
    },
  });

  return NextResponse.json(result);
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
