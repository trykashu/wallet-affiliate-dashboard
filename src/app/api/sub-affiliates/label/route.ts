/**
 * POST /api/sub-affiliates/label
 * Upsert a friendly label for one of the caller's sub-affiliate IDs.
 * Owner-only (delegates 403). Master-tier only.
 * Body: { sub_affiliate_id: string, label: string }  — empty label deletes.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAffiliateContext } from "@/lib/affiliate-context";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  sub_affiliate_id: z.string().trim().min(1).max(200),
  label: z.string().trim().max(120),
});

export async function POST(req: NextRequest) {
  const ctx = await getAffiliateContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.isDelegate) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  if (ctx.affiliate.tier !== "master") {
    return NextResponse.json({ error: "Master tier only" }, { status: 403 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { sub_affiliate_id, label } = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = ctx.db as any;
  if (label === "") {
    const { error } = await db
      .from("sub_affiliate_labels")
      .delete()
      .eq("affiliate_id", ctx.affiliateId)
      .eq("sub_affiliate_id", sub_affiliate_id);
    if (error) return NextResponse.json({ error: "Delete failed" }, { status: 500 });
    return NextResponse.json({ success: true, deleted: true });
  }

  const { error } = await db
    .from("sub_affiliate_labels")
    .upsert(
      { affiliate_id: ctx.affiliateId, sub_affiliate_id, label, updated_at: new Date().toISOString() },
      { onConflict: "affiliate_id,sub_affiliate_id" },
    );
  if (error) return NextResponse.json({ error: "Save failed" }, { status: 500 });
  return NextResponse.json({ success: true });
}
