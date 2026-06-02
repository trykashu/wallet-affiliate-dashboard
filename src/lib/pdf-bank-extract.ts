/**
 * Extract bank details from a text-based PDF (signed PandaDoc copies,
 * fillable W9s, typed bank-detail forms).
 *
 * Pure pipeline: PDF buffer → text → labelled lines + regex extraction.
 * No OCR (scanned PDFs need a separate path).
 */

import { extractText, getDocumentProxy } from "unpdf";
import {
  validateRoutingNumber,
  validateAccountNumber,
  cleanRoutingNumber,
  cleanAccountNumber,
} from "@/lib/bank-validation";

export interface PdfExtractedBank {
  email: string | null;
  account_holder_name: string | null;
  routing_number: string | null;
  account_number: string | null;
  account_type: "checking" | "savings" | null;
  routing_valid: boolean;
  account_valid: boolean;
  warnings: string[];
  raw_text_excerpt: string; // first 500 chars for debugging
}

const EMAIL_RX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Phone-shaped sequences we want to NEVER mistake for account numbers
const PHONE_RX =
  /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;

export async function extractTextFromPdf(pdfBuffer: Uint8Array): Promise<string> {
  // unpdf accepts ArrayBuffer | Uint8Array. Returns text per page.
  const doc = await getDocumentProxy(pdfBuffer);
  const { text } = await extractText(doc, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

/**
 * Find a labelled value: scans for `label\s*[:\-]?\s*value` patterns.
 * Returns the captured value or null.
 */
function findLabelled(text: string, ...labelWords: string[]): string | null {
  for (const label of labelWords) {
    // Allow the label across line breaks; capture up to end-of-line.
    const rx = new RegExp(
      `${label.replace(/\s+/g, "\\s+")}\\s*[:\\-]?\\s*([^\\n\\r]{1,80})`,
      "i",
    );
    const m = text.match(rx);
    if (m && m[1]) {
      const v = m[1].trim();
      if (v) return v;
    }
  }
  return null;
}

export function extractBankFromText(text: string): PdfExtractedBank {
  const warnings: string[] = [];
  const result: PdfExtractedBank = {
    email: null,
    account_holder_name: null,
    routing_number: null,
    account_number: null,
    account_type: null,
    routing_valid: false,
    account_valid: false,
    warnings,
    raw_text_excerpt: text.slice(0, 500),
  };

  // 1. EMAIL — first @-containing token
  const emails = text.match(EMAIL_RX);
  if (emails && emails.length > 0) result.email = emails[0];

  // 2. ROUTING — label-first ("Routing", "ABA"), fall back to 9-digit ABA-valid scan
  const routingLabelled = findLabelled(text, "routing number", "routing #", "routing", "aba routing", "aba");
  if (routingLabelled) {
    const cleaned = cleanRoutingNumber(routingLabelled);
    if (/^\d{9}$/.test(cleaned) && validateRoutingNumber(cleaned).valid) {
      result.routing_number = cleaned;
      result.routing_valid = true;
    } else {
      warnings.push(`Labelled routing '${routingLabelled.slice(0, 30)}' failed ABA validation`);
    }
  }
  if (!result.routing_number) {
    // Scan all 9-digit runs and pick the first ABA-valid one
    const candidates = text.match(/\d{9}/g) ?? [];
    for (const c of candidates) {
      if (validateRoutingNumber(c).valid) {
        result.routing_number = c;
        result.routing_valid = true;
        warnings.push("Routing extracted by 9-digit scan (no labelled field found)");
        break;
      }
    }
  }

  // 3. ACCOUNT — label-first, explicitly excluding fields named phone/ssn/tin/ein
  const accountLabelled = findLabelled(
    text,
    "account number",
    "acct number",
    "acct no",
    "acct #",
    "account #",
  );
  if (accountLabelled) {
    const trimmed = accountLabelled.trim();
    // Reject if the labelled value is phone-shaped
    if (PHONE_RX.test(trimmed) && trimmed.replace(/\D/g, "").length === 10) {
      warnings.push("Field labelled 'account number' contained a phone-shaped value — refusing");
    } else {
      const cleaned = cleanAccountNumber(trimmed);
      if (
        /^\d{4,17}$/.test(cleaned) &&
        cleaned !== result.routing_number &&
        validateAccountNumber(cleaned).valid
      ) {
        result.account_number = cleaned;
        result.account_valid = true;
      } else {
        warnings.push(`Labelled account '${trimmed.slice(0, 30)}' failed validation`);
      }
    }
  }
  if (!result.account_number) {
    // Value-shape scan: digit runs 4-17 chars, exclude routing, exclude phone-shape, exclude SSN
    const knownPhones = new Set<string>();
    const phoneMatches = text.match(PHONE_RX) ?? [];
    for (const p of phoneMatches) knownPhones.add(p.replace(/\D/g, ""));

    // Find every contiguous digit block ≥4 chars in the text
    const digitRuns = text.match(/\d[\d\s-]{3,30}\d/g) ?? [];
    type Candidate = { value: string; length: number };
    const cands: Candidate[] = [];
    for (const raw of digitRuns) {
      const cleaned = cleanAccountNumber(raw);
      if (!/^\d{4,17}$/.test(cleaned)) continue;
      if (cleaned === result.routing_number) continue;
      if (knownPhones.has(cleaned)) continue;
      if (cleaned.length === 9 && validateRoutingNumber(cleaned).valid) continue; // skip another routing
      if (cleaned.length === 10 && /^\d{3}\d{3}\d{4}$/.test(cleaned) && PHONE_RX.test(raw)) continue;
      if (!validateAccountNumber(cleaned).valid) continue;
      cands.push({ value: cleaned, length: cleaned.length });
    }
    // Heuristic: prefer the LONGEST candidate (account numbers are usually
    // longer than incidental numeric runs like dates / amounts).
    if (cands.length > 0) {
      cands.sort((a, b) => b.length - a.length);
      result.account_number = cands[0].value;
      result.account_valid = true;
      warnings.push("Account extracted by digit-shape scan (no labelled field found)");
    } else if (!accountLabelled) {
      warnings.push("No valid account number could be extracted from the PDF");
    }
  }

  // 4. ACCOUNT HOLDER NAME — label-first
  const nameLabelled = findLabelled(
    text,
    "account holder",
    "account name",
    "name on account",
    "payee",
    "beneficiary",
  );
  if (nameLabelled) {
    // Strip trailing fields that the label regex sometimes captures (e.g. "Name: John Doe Email: ...")
    const cleaned = nameLabelled.split(/(?:\b(email|address|routing|account|phone)\b)/i)[0].trim();
    if (cleaned.length >= 2 && cleaned.length <= 80 && /^[A-Za-z .'\-]+$/.test(cleaned)) {
      result.account_holder_name = cleaned;
    } else {
      warnings.push(`Labelled name '${cleaned.slice(0, 30)}' failed shape validation`);
    }
  }

  // 5. ACCOUNT TYPE — look for checking/savings hints
  if (/\bchecking\b/i.test(text)) result.account_type = "checking";
  else if (/\bsavings\b/i.test(text)) result.account_type = "savings";

  return result;
}
