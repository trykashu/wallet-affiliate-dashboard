/**
 * POST /api/admin/upload-bank-details
 *
 * Admin-only endpoint: bulk-import bank details from a CSV file.
 * CSV format: email,routing_number,account_number,account_name
 *
 * For each row:
 * 1. Validate routing/account numbers
 * 2. Look up affiliate by email
 * 3. Upsert into payout_accounts (provider='mercury')
 * 4. Encrypt sensitive fields if ENCRYPTION_KEY is configured
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { logSecurityEvent } from "@/lib/audit-log";
import { safeError } from "@/lib/safe-log";
import {
  validateRoutingNumber,
  validateAccountNumber,
  cleanRoutingNumber,
  cleanAccountNumber,
} from "@/lib/bank-validation";

export const dynamic = "force-dynamic";

interface CsvRow {
  email: string;
  routing_number: string;
  account_number: string;
  account_name: string;
}

interface RowError {
  row: number;
  email: string;
  error: string;
}

/** Try to encrypt; fall back to plaintext if ENCRYPTION_KEY is not set. */
function tryEncrypt(value: string): { encrypted: boolean; value: string } {
  try {
    // Dynamic import isn't needed — encrypt() throws if key missing
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { encrypt } = require("@/lib/encryption");
    return { encrypted: true, value: encrypt(value) };
  } catch {
    return { encrypted: false, value };
  }
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  // Validate header
  const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const emailIdx = header.indexOf("email");
  const routingIdx = header.indexOf("routing_number");
  const accountIdx = header.indexOf("account_number");
  const nameIdx = header.indexOf("account_name");

  if (emailIdx === -1 || routingIdx === -1 || accountIdx === -1) {
    throw new Error(
      "CSV must have columns: email, routing_number, account_number (account_name optional)"
    );
  }

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(",").map((c) => c.trim());
    rows.push({
      email: cols[emailIdx] || "",
      routing_number: cols[routingIdx] || "",
      account_number: cols[accountIdx] || "",
      account_name: nameIdx !== -1 ? cols[nameIdx] || "" : "",
    });
  }
  return rows;
}

export async function POST(request: NextRequest) {
  // 1. Auth — admin only
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 2. Parse CSV from FormData
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid form data" },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json(
      { error: "No CSV file provided" },
      { status: 400 }
    );
  }

  let csvText: string;
  try {
    csvText = await file.text();
  } catch {
    return NextResponse.json(
      { error: "Failed to read file" },
      { status: 400 }
    );
  }

  let rows: CsvRow[];
  try {
    rows = parseCsv(csvText);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to parse CSV" },
      { status: 400 }
    );
  }

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "CSV file is empty or has no data rows" },
      { status: 400 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  // 3. Pre-fetch all affiliates by email for efficient lookups
  const emails = [...new Set(rows.map((r) => r.email.toLowerCase()))];
  const { data: affiliates } = await db
    .from("affiliates")
    .select("id, agent_name, email")
    .in("email", emails);

  const affiliateByEmail = new Map<
    string,
    { id: string; agent_name: string }
  >();
  for (const a of affiliates ?? []) {
    affiliateByEmail.set(a.email.toLowerCase(), {
      id: a.id,
      agent_name: a.agent_name,
    });
  }

  // 4. Process each row
  const errors: RowError[] = [];
  let created = 0;
  let updated = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // 1-indexed, +1 for header

    // Validate email presence
    if (!row.email) {
      errors.push({ row: rowNum, email: "", error: "Missing email" });
      continue;
    }

    // Validate routing number
    const routingResult = validateRoutingNumber(row.routing_number);
    if (!routingResult.valid) {
      errors.push({
        row: rowNum,
        email: row.email,
        error: routingResult.error || "Invalid routing number",
      });
      continue;
    }

    // Validate account number
    const accountResult = validateAccountNumber(row.account_number);
    if (!accountResult.valid) {
      errors.push({
        row: rowNum,
        email: row.email,
        error: accountResult.error || "Invalid account number",
      });
      continue;
    }

    // Clean numbers
    const cleanedRouting = cleanRoutingNumber(row.routing_number);
    const cleanedAccount = cleanAccountNumber(row.account_number);

    // Look up affiliate
    const affiliate = affiliateByEmail.get(row.email.toLowerCase());
    if (!affiliate) {
      errors.push({
        row: rowNum,
        email: row.email,
        error: "Affiliate not found",
      });
      continue;
    }

    // Build metadata — encrypt if possible, matching mercury-account route format
    const routingEnc = tryEncrypt(cleanedRouting);
    const accountEnc = tryEncrypt(cleanedAccount);
    const last4 = cleanedAccount.slice(-4);

    const metadata = routingEnc.encrypted
      ? {
          account_holder_name: row.account_name || affiliate.agent_name,
          routing_number_encrypted: routingEnc.value,
          account_number_encrypted: accountEnc.value,
          account_type: "checking",
          last4,
          encryption_version: 1,
        }
      : {
          account_holder_name: row.account_name || affiliate.agent_name,
          full_account_number: accountEnc.value,
          routing_number: routingEnc.value,
          account_type: "checking",
          last4,
        };

    const accountData = {
      affiliate_id: affiliate.id,
      provider: "mercury",
      provider_id: null,
      account_name: row.account_name || affiliate.agent_name,
      routing_number: cleanedRouting,
      account_number_last4: last4,
      is_default: true,
      is_verified: true,
      metadata,
      updated_at: new Date().toISOString(),
    };

    // Check for existing Mercury account for this affiliate
    const { data: existing } = await db
      .from("payout_accounts")
      .select("id")
      .eq("affiliate_id", affiliate.id)
      .eq("provider", "mercury")
      .limit(1)
      .maybeSingle();

    if (existing) {
      const { error: updateErr } = await db
        .from("payout_accounts")
        .update(accountData)
        .eq("id", existing.id);

      if (updateErr) {
        safeError("[upload-bank-details]", "Update failed:", updateErr);
        errors.push({
          row: rowNum,
          email: row.email,
          error: "Database update failed",
        });
        continue;
      }
      updated++;
    } else {
      const { error: insertErr } = await db
        .from("payout_accounts")
        .insert(accountData);

      if (insertErr) {
        safeError("[upload-bank-details]", "Insert failed:", insertErr);
        errors.push({
          row: rowNum,
          email: row.email,
          error: "Database insert failed",
        });
        continue;
      }
      created++;
    }
  }

  // 5. Audit log
  await logSecurityEvent({
    userId: user.id,
    userEmail: user.email,
    action: "bank_details_bulk_upload",
    resourceType: "payout_account",
    metadata: {
      total_rows: rows.length,
      created,
      updated,
      errors: errors.length,
    },
  });

  return NextResponse.json({
    processed: rows.length,
    created,
    updated,
    errors,
  });
}
