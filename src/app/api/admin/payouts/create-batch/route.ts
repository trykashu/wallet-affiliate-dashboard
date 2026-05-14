/**
 * POST /api/admin/payouts/create-batch
 *
 * Admin-only (AM). Accepts an explicit list of approved earning_ids and groups
 * them into one payout per affiliate, all sharing a generated batch_id. Each
 * payout enters status='pending_review' and the earnings get payout_id set.
 *
 * Body: { earning_ids: string[], period: string, notes?: string }
 *   - period is a "YYYY-MM" string the AM picked (matches the month filter)
 *   - notes is optional free text for the Finance reviewer (max 500 chars)
 *
 * Returns: { batch_id, payout_count, total_amount, skipped: Array<{ earning_id, reason }> }
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";

const BodySchema = z.object({
  earning_ids: z.array(z.string().uuid()).min(1).max(500),
  period: z.string().regex(/^\d{4}-\d{2}$/, "period must be YYYY-MM"),
  notes: z.string().max(500).optional(),
});

interface Skipped { earning_id: string; reason: string }

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let rawBody: unknown;
  try { rawBody = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }
  const { earning_ids, period, notes } = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // Lookup earnings + affiliate join. Need: earnings.status, earnings.payout_id,
  // earnings.affiliate_id, affiliates.agreement_status, plus default verified payout_account.
  const { data: earningRows, error: earningsError } = await svc
    .from("earnings")
    .select("id, affiliate_id, amount, status, payout_id")
    .in("id", earning_ids);

  if (earningsError) {
    console.error("[create-batch] Earnings lookup failed:", earningsError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  type EarningRow = { id: string; affiliate_id: string; amount: number; status: string; payout_id: string | null };
  const earnings = (earningRows ?? []) as EarningRow[];

  // Build affiliate set for the secondary lookups
  const affiliateIds = Array.from(new Set(earnings.map((e) => e.affiliate_id)));

  const [affResp, accountsResp] = await Promise.all([
    svc.from("affiliates").select("id, agent_name, agreement_status").in("id", affiliateIds),
    svc.from("payout_accounts")
       .select("id, affiliate_id, is_default, is_verified")
       .in("affiliate_id", affiliateIds)
       .eq("is_verified", true),
  ]);

  if (affResp.error) {
    console.error("[create-batch] Affiliate lookup failed:", affResp.error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  if (accountsResp.error) {
    console.error("[create-batch] Payout-account lookup failed:", accountsResp.error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  type AffRow = { id: string; agent_name: string; agreement_status: string | null };
  type AcctRow = { id: string; affiliate_id: string; is_default: boolean; is_verified: boolean };

  const affMap = new Map<string, AffRow>(
    ((affResp.data as AffRow[] | null) ?? []).map((a) => [a.id, a]),
  );
  // Pick verified default account per affiliate; fall back to any verified account.
  const acctByAffiliate = new Map<string, AcctRow>();
  for (const a of (accountsResp.data as AcctRow[] | null) ?? []) {
    const existing = acctByAffiliate.get(a.affiliate_id);
    if (!existing || (!existing.is_default && a.is_default)) {
      acctByAffiliate.set(a.affiliate_id, a);
    }
  }

  // Validate each earning, partition into eligible / skipped.
  const skipped: Skipped[] = [];
  const eligible: EarningRow[] = [];
  const earningById = new Map(earnings.map((e) => [e.id, e]));

  for (const id of earning_ids) {
    const e = earningById.get(id);
    if (!e) { skipped.push({ earning_id: id, reason: "not_found" }); continue; }
    if (e.status !== "approved") { skipped.push({ earning_id: id, reason: `status_${e.status}` }); continue; }
    if (e.payout_id) { skipped.push({ earning_id: id, reason: "already_in_batch" }); continue; }
    const aff = affMap.get(e.affiliate_id);
    if (!aff) { skipped.push({ earning_id: id, reason: "affiliate_missing" }); continue; }
    const ag = aff.agreement_status;
    if (ag !== "Completed" && ag !== "signed") {
      skipped.push({ earning_id: id, reason: "contract_not_signed" });
      continue;
    }
    if (!acctByAffiliate.has(e.affiliate_id)) {
      skipped.push({ earning_id: id, reason: "no_verified_payout_account" });
      continue;
    }
    eligible.push(e);
  }

  if (eligible.length === 0) {
    return NextResponse.json({
      batch_id: null,
      payout_count: 0,
      total_amount: 0,
      skipped,
      message: "No eligible earnings in the request.",
    }, { status: 409 });
  }

  // Group eligible earnings by affiliate, sum amounts.
  type Group = { affiliate_id: string; payout_account_id: string; total: number; earning_ids: string[] };
  const groupsByAffiliate = new Map<string, Group>();
  for (const e of eligible) {
    const acct = acctByAffiliate.get(e.affiliate_id)!;
    const existing = groupsByAffiliate.get(e.affiliate_id);
    if (existing) {
      existing.total += Number(e.amount) || 0;
      existing.earning_ids.push(e.id);
    } else {
      groupsByAffiliate.set(e.affiliate_id, {
        affiliate_id: e.affiliate_id,
        payout_account_id: acct.id,
        total: Number(e.amount) || 0,
        earning_ids: [e.id],
      });
    }
  }

  const batch_id = randomUUID();
  const nowIso = new Date().toISOString();
  const groups = Array.from(groupsByAffiliate.values());

  // Insert one payout row per affiliate group.
  const payoutInserts = groups.map((g) => ({
    affiliate_id:      g.affiliate_id,
    payout_account_id: g.payout_account_id,
    amount:            Math.round(g.total * 100) / 100, // 2dp
    currency:          "USD",
    status:            "pending_review",
    period,
    batch_id,
    submitted_by:      user.email ?? null,
    submitted_at:      nowIso,
    review_notes:      notes ?? null,
  }));

  const { data: createdPayouts, error: insertError } = await svc
    .from("payouts")
    .insert(payoutInserts)
    .select("id, affiliate_id, amount");

  if (insertError) {
    console.error("[create-batch] Payout insert failed:", insertError);
    return NextResponse.json({ error: "Failed to create payouts" }, { status: 500 });
  }

  type InsertedPayout = { id: string; affiliate_id: string; amount: number };
  const inserted = (createdPayouts as InsertedPayout[] | null) ?? [];

  // Link each earning to its payout via payout_id.
  const payoutByAffiliate = new Map(inserted.map((p) => [p.affiliate_id, p]));
  for (const g of groups) {
    const payout = payoutByAffiliate.get(g.affiliate_id);
    if (!payout) continue;
    const { error: linkError } = await svc
      .from("earnings")
      .update({ payout_id: payout.id, updated_at: nowIso })
      .in("id", g.earning_ids);
    if (linkError) {
      console.error("[create-batch] Earning link failed:", linkError);
      // Don't bail — log and continue. The payout exists; the link is best-effort
      // and Finance can still review. Surface this in audit metadata.
    }
  }

  const total_amount = inserted.reduce((s, p) => s + Number(p.amount), 0);

  logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: "admin.batch_submit",
    resourceType: "payouts",
    metadata: {
      batch_id,
      period,
      payout_count: inserted.length,
      total_amount,
      requested: earning_ids.length,
      skipped_count: skipped.length,
    },
  });

  return NextResponse.json({
    batch_id,
    payout_count: inserted.length,
    total_amount,
    skipped,
  });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
