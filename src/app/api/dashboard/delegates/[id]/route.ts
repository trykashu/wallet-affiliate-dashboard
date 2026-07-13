import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAffiliateContext } from "@/lib/affiliate-context";
import { createServiceClient } from "@/lib/supabase/service";
import { logSecurityEvent } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PatchSchema = z.object({
  delegate_name:     z.string().min(1).max(200).optional(),
  can_view_earnings: z.boolean().optional(),
  can_view_payouts:  z.boolean().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RX.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  const ctx = await getAffiliateContext();
  if (!ctx || ctx.isDelegate) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let raw: unknown;
  try { raw = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { error } = await svc
    .from("affiliate_delegates")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("affiliate_id", ctx.affiliateId);

  if (error) return NextResponse.json({ error: "Update failed" }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RX.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  const ctx = await getAffiliateContext();
  if (!ctx || ctx.isDelegate) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { error } = await svc
    .from("affiliate_delegates")
    .delete()
    .eq("id", id)
    .eq("affiliate_id", ctx.affiliateId);

  if (error) return NextResponse.json({ error: "Revoke failed" }, { status: 500 });

  logSecurityEvent({
    userId: ctx.affiliate.user_id,
    userEmail: ctx.affiliate.email,
    action: "delegate.revoked",
    resourceType: "affiliate_delegate",
    resourceId: id,
    metadata: { affiliate_id: ctx.affiliateId },
  });
  return NextResponse.json({ success: true });
}
