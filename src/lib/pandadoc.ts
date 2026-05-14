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
  warnings: string[];
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

// ---------------------------------------------------------------------------
// Field-matching helpers — prefer fields whose title/name explicitly identifies
// what they are. Title matching is much more reliable than value-shape because
// PandaDoc templates can have multiple digit fields (phone, SSN, account, etc).
// ---------------------------------------------------------------------------

function titleMatches(field: PandaDocField, ...needles: string[]): boolean {
  const hay = `${field.title ?? ""} ${field.name ?? ""}`.toLowerCase();
  return needles.some((n) => hay.includes(n.toLowerCase()));
}

function findByTitle(
  fields: PandaDocField[],
  ...needles: string[]
): PandaDocField | undefined {
  return fields.find((f) => titleMatches(f, ...needles));
}

function looksLikeUsPhone(originalValue: string, cleanedDigits: string): boolean {
  const trimmed = originalValue.trim();

  // Strong signals from formatting
  if (/^\+?1?\s*\(\d{3}\)\s*\d{3}[\s-]?\d{4}$/.test(trimmed)) return true; // (212) 555-0143
  if (/^\+?1[\s-]\d{3}[\s-]\d{3}[\s-]\d{4}$/.test(trimmed)) return true;   // +1 212-555-0143
  if (/^\d{3}[\s-]\d{3}[\s-]\d{4}$/.test(trimmed)) return true;            // 212-555-0143
  if (/^\d{3}\.\d{3}\.\d{4}$/.test(trimmed)) return true;                  // 212.555.0143

  // Weaker: bare 10 digits, or 11 digits with leading 1
  if (cleanedDigits.length === 10) return true;
  if (cleanedDigits.length === 11 && cleanedDigits.startsWith("1")) return true;

  return false;
}

function looksLikeWidgetLabel(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (/^option\s*\d+$/i.test(v)) return true;
  if (/^choice\s*\d+$/i.test(v)) return true;
  if (/^(yes|no|n\/a|na)$/i.test(v)) return true;
  if (/^\d+$/.test(v)) return true;
  return false;
}

function looksLikePersonName(value: string): boolean {
  const v = value.trim();
  if (v.length < 4) return false;
  if (looksLikeWidgetLabel(v)) return false;
  const alphaTokens = v.split(/[\s.]+/).filter((t) => /^[a-zA-Z'\-]+$/.test(t));
  return alphaTokens.length >= 2;
}

/**
 * Pattern-match bank detail fields from a PandaDoc document's fields array.
 *
 * PandaDoc fields are all named "Text" with different UUIDs. Positions shift
 * between documents, so we identify fields by their *title* first, falling
 * back to value-shape with strict phone/SSN exclusion.
 */
export function extractBankDetails(
  fields: PandaDocField[]
): ExtractedBankDetails {
  const warnings: string[] = [];

  // 1. Filter to Partner-role fields with non-empty values
  const partnerFields = fields.filter((f) => {
    const hasValue = typeof f.value === "string" && f.value.trim() !== "";
    const isPartnerRole =
      !f.assigned_to?.role ||
      f.assigned_to.role.toLowerCase().includes("partner") ||
      f.assigned_to.role.toLowerCase().includes("affiliate");
    return hasValue && isPartnerRole;
  });

  // 2. ROUTING NUMBER — try title first ("routing"), then value-shape fallback.
  let routingNumber: string | null = null;
  const routingFromTitle = findByTitle(partnerFields, "routing");
  if (routingFromTitle) {
    const cleaned = cleanRoutingNumber(routingFromTitle.value);
    if (/^\d{9}$/.test(cleaned) && validateRoutingNumber(cleaned).valid) {
      routingNumber = cleaned;
    } else {
      warnings.push("Field titled 'routing' did not pass ABA validation");
    }
  }
  if (!routingNumber) {
    for (const f of partnerFields) {
      const cleaned = cleanRoutingNumber(f.value);
      if (/^\d{9}$/.test(cleaned) && validateRoutingNumber(cleaned).valid) {
        routingNumber = cleaned;
        if (!routingFromTitle) {
          warnings.push("Routing number extracted by value-shape (no titled field found)");
        }
        break;
      }
    }
  }

  // 3. ACCOUNT NUMBER — title first ("account number" but NOT containing "routing"),
  //    explicitly reject phone-shaped values. Value-shape fallback excludes phones.
  let accountNumber: string | null = null;
  const accountFromTitle = partnerFields.find(
    (f) =>
      titleMatches(f, "account number", "acct number", "acct no") &&
      !titleMatches(f, "routing"),
  );
  if (accountFromTitle) {
    const cleaned = cleanAccountNumber(accountFromTitle.value);
    // When title says "account number", trust formatting signals (parens/dashes
    // in phone shape) but DON'T reject a bare 10-digit string — that's a
    // legitimate account-number length.
    const trimmed = accountFromTitle.value.trim();
    const hasPhoneFormatting =
      /^\+?1?\s*\(\d{3}\)\s*\d{3}[\s-]?\d{4}$/.test(trimmed) ||
      /^\+?1[\s-]\d{3}[\s-]\d{3}[\s-]\d{4}$/.test(trimmed) ||
      /^\d{3}[\s-]\d{3}[\s-]\d{4}$/.test(trimmed) ||
      /^\d{3}\.\d{3}\.\d{4}$/.test(trimmed);
    if (hasPhoneFormatting) {
      warnings.push("Field titled 'account number' contains a phone-shaped value — refusing");
    } else if (
      /^\d{4,17}$/.test(cleaned) &&
      cleaned !== routingNumber &&
      validateAccountNumber(cleaned).valid
    ) {
      accountNumber = cleaned;
    } else {
      warnings.push("Field titled 'account number' failed format validation");
    }
  }
  if (!accountNumber) {
    // Value-shape fallback: digit fields that are NOT routing, NOT in a field
    // titled 'phone'/'cell'/'tel'/'ssn', NOT phone-shaped.
    const candidates: { value: string; length: number; field: PandaDocField }[] = [];
    for (const f of partnerFields) {
      if (titleMatches(f, "phone", "telephone", "cell", "mobile", "ssn", "social security")) continue;
      const cleaned = cleanAccountNumber(f.value);
      if (!/^\d{4,17}$/.test(cleaned)) continue;
      if (cleaned === routingNumber) continue;
      if (!validateAccountNumber(cleaned).valid) continue;
      if (looksLikeUsPhone(f.value, cleaned)) continue;
      candidates.push({ value: cleaned, length: cleaned.length, field: f });
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.length - a.length);
      accountNumber = candidates[0].value;
      if (!accountFromTitle) {
        warnings.push("Account number extracted by value-shape (no titled field found)");
      }
    } else if (!accountFromTitle) {
      warnings.push("No valid account number could be extracted");
    }
  }

  // 4. EMAIL — first text value containing "@", prefer titled fields
  let email: string | null = null;
  const emailFromTitle = findByTitle(partnerFields, "email", "e-mail");
  if (emailFromTitle && emailFromTitle.value.includes("@")) {
    email = emailFromTitle.value.trim();
  } else {
    for (const f of partnerFields) {
      if (f.value.includes("@")) {
        email = f.value.trim();
        break;
      }
    }
  }

  // 5. ACCOUNT HOLDER NAME — title first ("name" / "account holder" / "payee"),
  //    validate person-name shape, warn on widget labels.
  let accountHolderName: string | null = null;
  const nameFromTitle = partnerFields.find(
    (f) =>
      (titleMatches(f, "account holder", "account name", "payee", "beneficiary") ||
        (titleMatches(f, "name") && !titleMatches(f, "company", "business", "doing business"))),
  );
  if (nameFromTitle) {
    const candidate = nameFromTitle.value.trim();
    if (looksLikeWidgetLabel(candidate)) {
      warnings.push(`Field titled '${nameFromTitle.title ?? "name"}' contains a widget label ('${candidate}'); skipping`);
    } else {
      accountHolderName = candidate;
      if (!looksLikePersonName(candidate)) {
        warnings.push(`Account holder name '${candidate}' may not be a person's name`);
      }
    }
  }
  if (!accountHolderName) {
    // Fallback: scan all partner fields for the first person-name-shaped value.
    for (const f of partnerFields) {
      if (looksLikePersonName(f.value)) {
        accountHolderName = f.value.trim();
        if (!nameFromTitle) {
          warnings.push("Account holder name extracted by value-shape (no titled field found)");
        }
        break;
      }
    }
  }

  // 6. ACCOUNT TYPE — prefer radio with title matching "type" / "account type".
  //    Fall back to any radio that maps cleanly to checking/savings.
  let accountType: "checking" | "savings" | null = null;
  const typeRadios = fields.filter((f) => {
    const t = (f.type ?? "").toLowerCase();
    return t === "radio_buttons" || t === "radio";
  });
  const typedRadio = typeRadios.find((f) =>
    titleMatches(f, "account type", "checking or savings", "deposit type"),
  );
  const radioToCheck = typedRadio ?? typeRadios[0];
  if (radioToCheck) {
    const val = (radioToCheck.value ?? "").trim().toLowerCase();
    if (val === "checking" || val.includes("checking")) {
      accountType = "checking";
    } else if (val === "savings" || val.includes("savings")) {
      accountType = "savings";
    } else if (val.includes("option 1")) {
      accountType = "checking";
      if (!typedRadio) {
        warnings.push("Account type mapped from generic 'option 1' (no titled type radio found)");
      }
    } else if (val.includes("option 2")) {
      accountType = "savings";
      if (!typedRadio) {
        warnings.push("Account type mapped from generic 'option 2' (no titled type radio found)");
      }
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
    warnings,
  };
}
