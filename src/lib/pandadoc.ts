/**
 * PandaDoc API helpers — fetch document fields and extract bank details
 * by pattern-matching unnamed fields from Schedule B.
 */

import {
  validateRoutingNumber,
  validateAccountNumber,
  cleanRoutingNumber,
  cleanAccountNumber,
} from "@/lib/bank-validation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PandaDocField {
  uuid: string;
  name: string;
  title?: string;
  value: string;
  type?: string;
  assigned_to?: {
    role?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ExtractedBankDetails {
  email: string | null;
  account_holder_name: string | null;
  routing_number: string | null;
  account_number: string | null;
  account_type: "checking" | "savings" | null;
  routing_valid: boolean;
  account_valid: boolean;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Fetch the fields array from a completed PandaDoc document.
 */
export async function fetchDocumentFields(
  documentId: string
): Promise<PandaDocField[]> {
  const apiKey = process.env.PANDADOC_API_KEY;
  if (!apiKey) {
    throw new Error("PANDADOC_API_KEY is not set");
  }

  const url = `https://api.pandadoc.com/public/v1/documents/${documentId}/details`;
  const res = await fetch(url, {
    headers: { Authorization: `API-Key ${apiKey}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `PandaDoc API error ${res.status}: ${text.slice(0, 200)}`
    );
  }

  const data = await res.json();
  return (data.fields ?? []) as PandaDocField[];
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Pattern-match bank detail fields from a PandaDoc document's fields array.
 *
 * PandaDoc fields are all named "Text" with different UUIDs. Positions shift
 * between documents, so we identify fields by their *value* patterns rather
 * than by name or position.
 */
export function extractBankDetails(
  fields: PandaDocField[]
): ExtractedBankDetails {
  // 1. Filter to Partner-role fields with non-empty values
  const partnerFields = fields.filter((f) => {
    const hasValue = typeof f.value === "string" && f.value.trim() !== "";
    const isPartnerRole =
      !f.assigned_to?.role ||
      f.assigned_to.role.toLowerCase().includes("partner") ||
      f.assigned_to.role.toLowerCase().includes("affiliate");
    return hasValue && isPartnerRole;
  });

  let routingNumber: string | null = null;
  let routingFieldIndex = -1;
  let accountNumber: string | null = null;
  let email: string | null = null;
  let accountType: "checking" | "savings" | null = null;

  // 2. Find routing_number: 9-digit string that passes ABA checksum
  for (let i = 0; i < partnerFields.length; i++) {
    const f = partnerFields[i];
    const cleaned = cleanRoutingNumber(f.value);
    if (/^\d{9}$/.test(cleaned) && validateRoutingNumber(cleaned).valid) {
      routingNumber = cleaned;
      routingFieldIndex = i;
      break;
    }
  }

  // 3. Find account_number: digit-only string (4-17 chars), not routing number.
  //    If multiple matches, pick the longest one.
  const accountCandidates: { value: string; length: number }[] = [];
  for (const f of partnerFields) {
    const cleaned = cleanAccountNumber(f.value);
    if (
      /^\d{4,17}$/.test(cleaned) &&
      cleaned !== routingNumber &&
      validateAccountNumber(cleaned).valid
    ) {
      accountCandidates.push({ value: cleaned, length: cleaned.length });
    }
  }
  if (accountCandidates.length > 0) {
    accountCandidates.sort((a, b) => b.length - a.length);
    accountNumber = accountCandidates[0].value;
  }

  // 4. Find email: first text value containing "@"
  for (const f of partnerFields) {
    if (f.value.includes("@")) {
      email = f.value.trim();
      break;
    }
  }

  // 5. Find account_holder_name: text field immediately before routing number
  let accountHolderName: string | null = null;
  if (routingFieldIndex > 0) {
    accountHolderName = partnerFields[routingFieldIndex - 1].value.trim();
  }

  // 6. Find account_type: radio_buttons field
  for (const f of fields) {
    const fieldType = (f.type ?? "").toLowerCase();
    if (fieldType === "radio_buttons" || fieldType === "radio") {
      const val = (f.value ?? "").trim().toLowerCase();
      if (val.includes("option 1") || val === "checking") {
        accountType = "checking";
      } else if (val.includes("option 2") || val === "savings") {
        accountType = "savings";
      }
      break;
    }
  }

  return {
    email,
    account_holder_name: accountHolderName,
    routing_number: routingNumber,
    account_number: accountNumber,
    account_type: accountType,
    routing_valid: routingNumber !== null,
    account_valid: accountNumber !== null,
  };
}
