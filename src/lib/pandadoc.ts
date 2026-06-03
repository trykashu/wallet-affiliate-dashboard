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
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
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

/**
 * Download the rendered PDF for a completed PandaDoc document.
 * Used as a fallback when structured fields are missing or insufficient —
 * the same extractor that powers the admin PDF-upload flow can then run on
 * this buffer to extract bank details + address from the form-values block.
 */
export async function downloadDocumentPdf(documentId: string): Promise<Uint8Array> {
  const apiKey = process.env.PANDADOC_API_KEY;
  if (!apiKey) {
    throw new Error("PANDADOC_API_KEY is not set");
  }
  const url = `https://api.pandadoc.com/public/v1/documents/${documentId}/download`;
  const res = await fetch(url, {
    headers: { Authorization: `API-Key ${apiKey}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `PandaDoc download error ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  const arr = await res.arrayBuffer();
  return new Uint8Array(arr);
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

// 50 US states + DC, full name → 2-letter abbreviation.
// Used to normalize PandaDoc state fields where users may type either form.
const US_STATE_BY_NAME: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY",
};
const US_STATE_CODES = new Set(Object.values(US_STATE_BY_NAME));

function normalizeRegion(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  const upper = v.toUpperCase();
  if (upper.length === 2 && US_STATE_CODES.has(upper)) return upper;
  const code = US_STATE_BY_NAME[v.toLowerCase()];
  if (code) return code;
  return v; // leave as-is if we don't recognize (international, typo, etc.)
}

/**
 * Parses "City, ST 12345" / "City, State, 12345" / "City State 12345" variants
 * into separate city / region / postal_code. Returns nulls when the pattern
 * doesn't match.
 */
function parseCityStateZip(value: string): {
  city: string | null;
  region: string | null;
  postal_code: string | null;
} {
  if (!value) return { city: null, region: null, postal_code: null };
  const v = value.trim();

  // Try: "City, ST[, ] zip" or "City, State Name zip" — capture each piece
  // greedily but stop the state at the trailing zip (5 or 9 digits).
  const m = v.match(/^(.+?),\s*([A-Za-z][A-Za-z .]+?)[,\s]+(\d{5}(?:-\d{4})?)\s*$/);
  if (m) {
    return {
      city: m[1].trim(),
      region: normalizeRegion(m[2].trim()),
      postal_code: m[3].trim(),
    };
  }
  return { city: null, region: null, postal_code: null };
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

  // 7. ADDRESS — three-tier extraction:
  //    a) title-first (works for titled templates)
  //    b) field_id Text2 + Text2_1 (works for our untitled template — stable IDs)
  //    c) value-shape fallback (find latest "City, ST 12345" pattern, use prev as line 1)
  let address1: string | null = null;
  let address2: string | null = null;
  let city: string | null = null;
  let region: string | null = null;
  let postal_code: string | null = null;
  const country: string = findByTitle(partnerFields, "country")?.value.trim() ?? "US";

  // (a) Title-first
  address1 = findByTitle(partnerFields, "address1", "address 1", "street address", "street", "address")?.value.trim() ?? null;
  address2 = findByTitle(partnerFields, "address2", "address 2", "apartment", "apt", "suite", "unit")?.value.trim() ?? null;
  city = findByTitle(partnerFields, "city")?.value.trim() ?? null;
  region = normalizeRegion(findByTitle(partnerFields, "state", "region", "province")?.value ?? null);
  postal_code = findByTitle(partnerFields, "zip", "postal code", "postal")?.value.trim() ?? null;

  // (b) Field-ID fallback: Text2 + Text2_1 (our template's bank-section pair)
  if (!address1 && !city) {
    const text2 = partnerFields.find((f) => f.field_id === "Text2");
    const text2_1 = partnerFields.find((f) => f.field_id === "Text2_1");
    if (text2 && text2_1) {
      const parsed = parseCityStateZip(text2_1.value);
      if (parsed.city) {
        address1 = text2.value.trim();
        city = parsed.city;
        region = parsed.region;
        postal_code = parsed.postal_code;
      }
    }
  }

  // (c) Value-shape fallback: find the LAST partner field matching City+State+Zip.
  //     The latest occurrence is closer to the bank/ACH section, which holds
  //     the account-holder address (not a business address from page 1).
  if (!address1 && !city) {
    let latestIdx = -1;
    let latestParsed: { city: string | null; region: string | null; postal_code: string | null } | null = null;
    for (let i = 0; i < partnerFields.length; i++) {
      const parsed = parseCityStateZip(partnerFields[i].value);
      if (parsed.city && parsed.postal_code) {
        latestIdx = i;
        latestParsed = parsed;
      }
    }
    if (latestParsed && latestIdx > 0) {
      // Previous text field is treated as address1 (most templates put line 1 immediately before city/state/zip)
      const prev = partnerFields[latestIdx - 1];
      if (prev && /^[\d]/.test(prev.value.trim())) {
        // Likely a street address (starts with a digit). Only adopt if reasonable.
        address1 = prev.value.trim();
      }
      city = latestParsed.city;
      region = latestParsed.region;
      postal_code = latestParsed.postal_code;
    }
  }

  // Partial-address warnings
  if (!address1) warnings.push("Address line 1 not found in PandaDoc");
  if (!city) warnings.push("City not found in PandaDoc");
  if (!region) warnings.push("State/region not found in PandaDoc");
  if (!postal_code) warnings.push("Postal code not found in PandaDoc");

  return {
    email,
    account_holder_name: accountHolderName,
    routing_number: routingNumber,
    account_number: accountNumber,
    account_type: accountType,
    routing_valid: routingNumber !== null,
    account_valid: accountNumber !== null,
    warnings,
    address1,
    address2,
    city,
    region,
    postal_code,
    country,
  };
}
