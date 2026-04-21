/**
 * Process queued bank details from PandaDoc webhooks that arrived
 * before the affiliate existed in Supabase.
 *
 * Called after affiliate sync to match pending records to newly-synced affiliates.
 */

import { validateRoutingNumber, validateAccountNumber } from "@/lib/bank-validation";

interface PendingRecord {
  id: string;
  email: string;
  document_id: string;
  document_name: string;
  account_holder_name: string | null;
  routing_number: string | null;
  account_number: string | null;
  account_type: string | null;
}

interface Affiliate {
  id: string;
  email: string;
  agent_name: string;
}

export async function processPendingBankDetails(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
): Promise<{ processed: number; matched: number; errors: number }> {
  const result = { processed: 0, matched: 0, errors: 0 };

  // 1. Query unprocessed pending bank details
  const { data: pending, error: fetchErr } = await db
    .from("pending_bank_details")
    .select("*")
    .eq("processed", false);

  if (fetchErr) {
    console.error("[process-pending-bank-details] Failed to fetch pending records:", fetchErr.message);
    return result;
  }

  if (!pending || pending.length === 0) {
    return result;
  }

  // 2. Pre-load all affiliates into a lookup map by lowercase email
  const { data: affiliates, error: affErr } = await db
    .from("affiliates")
    .select("id, email, agent_name");

  if (affErr) {
    console.error("[process-pending-bank-details] Failed to fetch affiliates:", affErr.message);
    return result;
  }

  const emailMap = new Map<string, Affiliate>();
  const nameMap = new Map<string, Affiliate>();

  for (const aff of (affiliates ?? []) as Affiliate[]) {
    if (aff.email) emailMap.set(aff.email.toLowerCase(), aff);
    if (aff.agent_name) nameMap.set(aff.agent_name.toLowerCase(), aff);
  }

  // 3. Process each pending record
  for (const rec of pending as PendingRecord[]) {
    try {
      // a. Match by email (case-insensitive)
      let affiliate: Affiliate | undefined;
      if (rec.email) {
        affiliate = emailMap.get(rec.email.toLowerCase());
      }

      // b. Fallback: extract name from document_name "Affiliate Agreement - {Name}"
      if (!affiliate && rec.document_name) {
        const nameMatch = rec.document_name.match(/Affiliate\s+Agreement\s*[-–—]\s*(.+)/i);
        if (nameMatch) {
          const agentName = nameMatch[1].trim().toLowerCase();
          affiliate = nameMap.get(agentName);
        }
      }

      // c. No match — skip, leave unprocessed for next run
      if (!affiliate) {
        continue;
      }

      // d. Matched — validate and upsert
      const routingValid = rec.routing_number
        ? validateRoutingNumber(rec.routing_number).valid
        : false;
      const accountValid = rec.account_number
        ? validateAccountNumber(rec.account_number).valid
        : false;

      if (routingValid && accountValid) {
        const accountNumberLast4 = rec.account_number!.slice(-4);

        await db.from("payout_accounts").upsert(
          {
            affiliate_id: affiliate.id,
            provider: "mercury",
            account_name: rec.account_holder_name ?? affiliate.agent_name,
            routing_number: rec.routing_number,
            account_number_last4: accountNumberLast4,
            is_default: true,
            is_verified: true,
            metadata: {
              full_account_number: rec.account_number,
              routing_number: rec.routing_number,
              account_type: rec.account_type,
              source: "pandadoc_queued",
            },
          },
          { onConflict: "affiliate_id,provider" },
        );

        await db
          .from("affiliates")
          .update({ bank_details_needed: false, agreement_status: "signed" })
          .eq("id", affiliate.id);

        console.log(
          `[process-pending-bank-details] ✓ Bank details saved for ${affiliate.agent_name} (${affiliate.email})`,
        );
      } else {
        await db
          .from("affiliates")
          .update({ bank_details_needed: true, agreement_status: "signed" })
          .eq("id", affiliate.id);

        console.warn(
          `[process-pending-bank-details] ✗ Invalid bank details for ${affiliate.agent_name}:`,
          { routingValid, accountValid },
        );
      }

      // Mark as processed
      await db
        .from("pending_bank_details")
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq("id", rec.id);

      result.processed++;
      result.matched++;
    } catch (err) {
      console.error(
        `[process-pending-bank-details] Error processing record ${rec.id}:`,
        err instanceof Error ? err.message : "unknown",
      );
      result.errors++;
    }
  }

  return result;
}
