/**
 * Extract bank details from a text-based PDF (signed PandaDoc copies,
 * fillable W9s, typed bank-detail forms).
 *
 * STRUCTURAL APPROACH (lessons learned from real Kashu agreements):
 *
 * PandaDoc-signed PDFs lay out the template with underscore placeholders
 * on the visible pages, then dump every filled value as a flat token
 * sequence right before the audit-trail block. So labelled-field extraction
 * by regex fails ('account number: _____' never has a value adjacent), and
 * the values block doesn't carry its labels either.
 *
 * The reliable signal is *ordering*: routing → account appear adjacent in
 * the values block, in that order. ABA-valid routing is unambiguous (9
 * digits + checksum), so we anchor on it, then look for the next clean
 * digit-run as the account number — explicitly excluding dates, phones,
 * ZIPs, and the routing itself.
 *
 * Email: skip kashupay.com (always present as PandaDoc sender) and the
 * PandaDoc audit-trail block at the document tail.
 */

import { extractText, getDocumentProxy } from "unpdf";
import {
  validateRoutingNumber,
  validateAccountNumber,
  cleanAccountNumber,
} from "@/lib/bank-validation";

export interface PdfExtractedAddress {
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;       // 2-letter state code
  postal_code: string | null;
  country: string;             // always "US"
}

export interface PdfExtractedBank {
  email: string | null;
  account_holder_name: string | null;
  routing_number: string | null;
  account_number: string | null;
  account_type: "checking" | "savings" | null;
  routing_valid: boolean;
  account_valid: boolean;
  address: PdfExtractedAddress;
  warnings: string[];
  raw_text_excerpt: string; // first 500 chars for debugging
}

const EMAIL_RX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const DATE_RX = /\b(20\d{2})-?(0[1-9]|1[0-2])-?(0[1-9]|[12]\d|3[01])\b/g;
// Conservative phone detection: either explicitly-formatted phone (parens,
// dashes, dots, spaces between groups) OR a standalone 10/11-digit run
// between WORD BOUNDARIES — never mid-run, so `121000358 325206299714`
// doesn't get matched as "phone 1210003583".
const PHONE_FORMATTED_RX = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4}|\d{3}[\s.-]\d{3}[\s.-]\d{4})/g;
const PHONE_BARE_RX = /(?<!\d)\d{10}(?!\d)|(?<!\d)1\d{10}(?!\d)/g;
// Audit-trail anchors. "Document Ref" appears in EVERY page footer, so we
// can't use it. These three only appear inside the audit block proper.
const AUDIT_TRAIL_RX = /(REF\.\s*NUMBER\b|DOCUMENT\s+COMPLETED\s+BY\s+ALL\s+PARTIES|Signed\s+with\s+PandaDoc\b)/i;

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
]);
const STATE_NAME_TO_CODE: Record<string, string> = {
  ALABAMA:"AL", ALASKA:"AK", ARIZONA:"AZ", ARKANSAS:"AR", CALIFORNIA:"CA",
  COLORADO:"CO", CONNECTICUT:"CT", DELAWARE:"DE", FLORIDA:"FL", GEORGIA:"GA",
  HAWAII:"HI", IDAHO:"ID", ILLINOIS:"IL", INDIANA:"IN", IOWA:"IA",
  KANSAS:"KS", KENTUCKY:"KY", LOUISIANA:"LA", MAINE:"ME", MARYLAND:"MD",
  MASSACHUSETTS:"MA", MICHIGAN:"MI", MINNESOTA:"MN", MISSISSIPPI:"MS", MISSOURI:"MO",
  MONTANA:"MT", NEBRASKA:"NE", NEVADA:"NV", "NEW HAMPSHIRE":"NH", "NEW JERSEY":"NJ",
  "NEW MEXICO":"NM", "NEW YORK":"NY", "NORTH CAROLINA":"NC", "NORTH DAKOTA":"ND",
  OHIO:"OH", OKLAHOMA:"OK", OREGON:"OR", PENNSYLVANIA:"PA", "RHODE ISLAND":"RI",
  "SOUTH CAROLINA":"SC", "SOUTH DAKOTA":"SD", TENNESSEE:"TN", TEXAS:"TX",
  UTAH:"UT", VERMONT:"VT", VIRGINIA:"VA", WASHINGTON:"WA", "WEST VIRGINIA":"WV",
  WISCONSIN:"WI", WYOMING:"WY", "DISTRICT OF COLUMBIA":"DC",
};
// Pattern A: city + 2-letter state + ZIP (most common; allows comma OR space between city/state)
const STATE_ZIP_RX =
  /,?\s+([A-Za-z][A-Za-z .'-]{1,40}?),?\s+([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?\b/g;
// Pattern B: city + full state name + ZIP (e.g. "Detroit, Michigan 48211")
const FULL_STATE_ZIP_RX =
  /,?\s+([A-Za-z][A-Za-z .'-]{1,40}?),?\s+(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia)\s+(\d{5})(?:-\d{4})?\b/gi;

export async function extractTextFromPdf(pdfBuffer: Uint8Array): Promise<string> {
  const doc = await getDocumentProxy(pdfBuffer);
  const { text } = await extractText(doc, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

interface SpanSet {
  isInside(idx: number): boolean;
}

function buildSpanSet(text: string, rx: RegExp): SpanSet {
  const ranges: Array<[number, number]> = [];
  for (const m of text.matchAll(rx)) {
    ranges.push([m.index!, m.index! + m[0].length]);
  }
  return {
    isInside(idx: number) {
      return ranges.some(([s, e]) => idx >= s && idx < e);
    },
  };
}

function buildPhoneDigitSet(text: string): Set<string> {
  const out = new Set<string>();
  for (const rx of [PHONE_FORMATTED_RX, PHONE_BARE_RX]) {
    for (const m of text.matchAll(rx)) {
      const digits = m[0].replace(/\D/g, "");
      if (digits.length === 10) out.add(digits);
      else if (digits.length === 11 && digits.startsWith("1")) out.add(digits.slice(1));
    }
  }
  return out;
}

interface DigitMatch {
  digits: string;
  index: number;
}

/** Plain digit runs of length 4-17, with their starting index. */
function allDigitRuns(text: string): DigitMatch[] {
  const out: DigitMatch[] = [];
  for (const m of text.matchAll(/\d{4,17}/g)) {
    out.push({ digits: m[0], index: m.index! });
  }
  return out;
}

/** Find tokens in the values block right before a given index. */
function tokensBefore(text: string, idx: number, maxBackChars = 200): string[] {
  const start = Math.max(0, idx - maxBackChars);
  const slice = text.slice(start, idx).trim();
  return slice.split(/\s+/).filter(Boolean);
}

interface AddressMatch {
  index: number;          // start of the matched suffix in text
  endIndex: number;       // end of the matched suffix
  city: string;
  region: string;
  postal_code: string;
}

/** Find every "city STATE ZIP" suffix in the partner text. Returns valid US-state matches. */
function findAddressTails(text: string): AddressMatch[] {
  const out: AddressMatch[] = [];
  // Pattern A — 2-letter state code
  for (const m of text.matchAll(STATE_ZIP_RX)) {
    const cityRaw = m[1].trim();
    const stateRaw = m[2].toUpperCase();
    if (!US_STATES.has(stateRaw)) continue;
    if (cityRaw.length > 35) continue;
    out.push({
      index: m.index!,
      endIndex: m.index! + m[0].length,
      city: cityRaw.replace(/\b\w/g, (c) => c.toUpperCase()),
      region: stateRaw,
      postal_code: m[3],
    });
  }
  // Pattern B — full state name (e.g. "Detroit, Michigan 48211")
  for (const m of text.matchAll(FULL_STATE_ZIP_RX)) {
    const cityRaw = m[1].trim();
    const stateName = m[2].toUpperCase();
    const code = STATE_NAME_TO_CODE[stateName];
    if (!code) continue;
    if (cityRaw.length > 35) continue;
    out.push({
      index: m.index!,
      endIndex: m.index! + m[0].length,
      city: cityRaw.replace(/\b\w/g, (c) => c.toUpperCase()),
      region: code,
      postal_code: m[3],
    });
  }
  // Sort by position so the closest-to-tail match is the last entry
  out.sort((a, b) => a.index - b.index);
  return out;
}

/** Extract a street address (address1) from the chars immediately before a
 *  matched "city STATE ZIP" suffix. Anchor on the FIRST "street-number
 *  word" pattern (e.g. "304 S", "37200 paseo") — anything before that in
 *  the prefix is template noise or holder name. */
function deriveStreet(text: string, tail: AddressMatch): string | null {
  const start = Math.max(0, tail.index - 100);
  let prefix = text.slice(start, tail.index);
  // Strip prior-field noise (email/phone) if any
  const lastEmail = [...prefix.matchAll(/\S+@\S+/g)].pop();
  if (lastEmail) prefix = prefix.slice(lastEmail.index! + lastEmail[0].length);
  const lastPhone = [...prefix.matchAll(/(?<!\d)\d{10}(?!\d)/g)].pop();
  if (lastPhone) prefix = prefix.slice(lastPhone.index! + lastPhone[0].length);

  // Anchor: first occurrence of <street-num> followed by a word character.
  // Require min 3 digits for plain numbers so dates like "04-10" don't match.
  // For dashed forms (Hawaiian "41-515", hyphenated address "1234-5678") the
  // second half must be 3+ digits so two-digit-month dates like "04-24" are
  // excluded.
  const streetNumRx = /\b(?:\d{3,6}|\d{1,2}-\d{3,5}|\d{3,6}-\d{3,5})\s+[A-Za-z]/g;
  const streetMatch = streetNumRx.exec(prefix);
  if (!streetMatch) return null;
  let street = prefix.slice(streetMatch.index).trim().replace(/,\s*$/, "").trim();
  if (!street) return null;
  // Cap to a sane length
  if (street.length > 80) street = street.slice(0, 80).trim();
  return street;
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
    address: { address1: null, address2: null, city: null, region: null, postal_code: null, country: "US" },
    warnings,
    raw_text_excerpt: text.slice(0, 500),
  };

  // 1. Strip PandaDoc audit-trail tail — everything after "Document Ref" /
  //    "REF. NUMBER" / "Signed with PandaDoc" is metadata, not partner content.
  const auditMatch = text.match(AUDIT_TRAIL_RX);
  const partnerText = auditMatch ? text.slice(0, auditMatch.index ?? text.length) : text;

  // 2. Pre-compute span sets for dates & phones; will be used to exclude
  //    digit-runs that look like account numbers but are actually noise.
  const dateSpans = buildSpanSet(partnerText, DATE_RX);
  // Phone spans = union of formatted + bare 10/11-digit runs.
  const formattedPhoneSpans = buildSpanSet(partnerText, PHONE_FORMATTED_RX);
  const barePhoneSpans = buildSpanSet(partnerText, PHONE_BARE_RX);
  const phoneSpans: SpanSet = {
    isInside(idx) {
      return formattedPhoneSpans.isInside(idx) || barePhoneSpans.isInside(idx);
    },
  };
  const phoneDigitSet = buildPhoneDigitSet(partnerText);

  const digitRuns = allDigitRuns(partnerText);

  // 3. ROUTING — first ABA-valid 9-digit unbroken run that isn't part of a
  //    date or phone. Routing is unambiguous (9 digits + checksum), so this
  //    is the anchor.
  let routingMatch: DigitMatch | null = null;
  for (const run of digitRuns) {
    if (run.digits.length !== 9) continue;
    if (dateSpans.isInside(run.index)) continue;
    if (phoneSpans.isInside(run.index)) continue;
    if (!validateRoutingNumber(run.digits).valid) continue;
    routingMatch = run;
    break;
  }
  if (routingMatch) {
    result.routing_number = routingMatch.digits;
    result.routing_valid = true;
  } else {
    warnings.push("No ABA-valid 9-digit routing number found");
  }

  // 4. ACCOUNT — PandaDoc form-tab order guarantees routing → account
  //    adjacency in the values block, so the IMMEDIATELY-NEXT digit run
  //    after routing IS the account. We trust positional ordering above all
  //    heuristics because account numbers can coincidentally be ABA-valid
  //    9 digits, 10-digit standalone, or short 5-digit — all of which my
  //    earlier "exclusion" rules wrongly threw away.
  if (routingMatch) {
    const ADJACENCY_MAX_CHARS = 30; // routing + space + account, well under 30
    let nextRun: DigitMatch | null = null;
    for (const run of digitRuns) {
      if (run.index <= routingMatch.index) continue;
      if (run.digits === routingMatch.digits && run.index === routingMatch.index) continue;
      nextRun = run;
      break;
    }
    const isAdjacent =
      nextRun !== null &&
      nextRun.index - (routingMatch.index + routingMatch.digits.length) <= ADJACENCY_MAX_CHARS;

    if (nextRun && isAdjacent) {
      // Trust adjacency for length/checksum, but still REFUSE if the next
      // run is part of a date (form had empty account → next token is date
      // fragment) — picking a 4-digit year as the account would be a
      // dangerous misread for an ACH transfer.
      if (dateSpans.isInside(nextRun.index)) {
        warnings.push(
          "Adjacent post-routing run is a date fragment — account field appears empty in the form",
        );
      } else if (
        nextRun.digits.length >= 4 &&
        nextRun.digits.length <= 17 &&
        validateAccountNumber(nextRun.digits).valid
      ) {
        result.account_number = nextRun.digits;
        result.account_valid = true;
      } else {
        warnings.push(`Adjacent post-routing run '${nextRun.digits}' failed length/validation`);
      }
    }
    // If no adjacent run found (rare — partner skipped account field), fall
    // back to the next non-noise candidate further down.
    if (!result.account_number) {
      for (const run of digitRuns) {
        if (run.index <= routingMatch.index) continue;
        if (run.digits === routingMatch.digits) continue;
        if (dateSpans.isInside(run.index)) continue;
        if (phoneSpans.isInside(run.index)) continue;
        if (phoneDigitSet.has(run.digits)) continue;
        if (run.digits.length === 5) continue;
        if (!validateAccountNumber(run.digits).valid) continue;
        result.account_number = run.digits;
        result.account_valid = true;
        warnings.push("Account picked by non-adjacent fallback (form may have empty account field)");
        break;
      }
    }
    if (!result.account_number) {
      warnings.push("No account-number candidate found after routing position");
    }
  } else {
    // Fallback when no routing: use longest non-phone, non-date digit run.
    // Less reliable, but better than nothing for documents without routing.
    const candidates = digitRuns
      .filter(
        (r) =>
          !dateSpans.isInside(r.index) &&
          !phoneSpans.isInside(r.index) &&
          !phoneDigitSet.has(r.digits) &&
          r.digits.length >= 6 &&
          r.digits.length <= 17 &&
          validateAccountNumber(r.digits).valid,
      )
      .sort((a, b) => b.digits.length - a.digits.length);
    if (candidates.length > 0) {
      result.account_number = candidates[0].digits;
      result.account_valid = true;
      warnings.push("Account extracted by longest-digit-run fallback (no routing anchor)");
    }
  }

  // 5. EMAIL — extract all emails, drop Kashu / PandaDoc system addresses,
  //    drop anything inside the audit-trail tail. Prefer the email closest
  //    to the bank section (use the LAST partner email before the audit
  //    trail — that's typically the partner's email in the values block).
  const partnerEmails: string[] = [];
  for (const m of partnerText.matchAll(EMAIL_RX)) {
    const addr = m[0].trim();
    const lower = addr.toLowerCase();
    if (lower.endsWith("@kashupay.com") || lower.endsWith("@kashu.com")) continue;
    if (lower.endsWith("@pandadoc.com")) continue;
    partnerEmails.push(addr);
  }
  if (partnerEmails.length > 0) {
    // The values block at the doc tail has the partner's chosen email;
    // earlier emails are template defaults or boilerplate.
    result.email = partnerEmails[partnerEmails.length - 1];
  }

  // 6. ACCOUNT TYPE — checking/savings hints (☐ glyphs not reliable, so look
  //    for nearby words).
  if (/\bchecking\b/i.test(partnerText)) result.account_type = "checking";
  else if (/\bsavings\b/i.test(partnerText)) result.account_type = "savings";
  else result.account_type = "checking"; // default — Kashu uses ACH only

  // 6b. ADDRESS — scope search to the VALUES BLOCK only. The PandaDoc
  //     template contains Kashu's own address ("1603 Capitol Ave Ste 415,
  //     Cheyenne, WY 82001") and signing/business addresses; if we don't
  //     scope, those leak through as the partner's address.
  //     The values block starts right after the LAST "Date: ___" placeholder
  //     in the template — that's the Schedule B signature/date line.
  const dateAnchorRx = /Date:\s*_+/gi;
  const dateMatches = [...partnerText.matchAll(dateAnchorRx)];
  const valuesBlockStart =
    dateMatches.length > 0 ? dateMatches[dateMatches.length - 1].index! + dateMatches[dateMatches.length - 1][0].length : 0;
  const valuesText = partnerText.slice(valuesBlockStart);

  const tails = findAddressTails(valuesText);
  // Shift indices back to partnerText-space for consistency (deriveStreet
  // expects to look back through the full partnerText)
  for (const t of tails) {
    t.index += valuesBlockStart;
    t.endIndex += valuesBlockStart;
  }
  if (tails.length > 0) {
    const tail = tails[tails.length - 1]; // closest to values block
    const street = deriveStreet(partnerText, tail);
    if (street) {
      result.address.address1 = street;
      result.address.city = tail.city;
      result.address.region = tail.region;
      result.address.postal_code = tail.postal_code;
    } else {
      warnings.push(`Found '${tail.city} ${tail.region} ${tail.postal_code}' but could not derive street`);
    }
  } else {
    warnings.push("No US address tail (city STATE ZIP) found — address field appears empty or non-US");
  }

  // 7. ACCOUNT HOLDER NAME — for the PandaDoc values-block layout, the
  //    holder name appears immediately before the routing number. Take the
  //    last 2-5 tokens before routing that look like a name OR business
  //    (allow letters, spaces, periods, hyphens, commas, ampersands).
  if (routingMatch) {
    const preTokens = tokensBefore(partnerText, routingMatch.index, 120);
    // Walk backwards collecting consecutive name-shaped tokens
    const accumulated: string[] = [];
    for (let i = preTokens.length - 1; i >= 0; i--) {
      const t = preTokens[i];
      // Stop on emails, numbers, or audit boilerplate
      if (/@/.test(t)) break;
      if (/^\d+$/.test(t)) break;
      if (!/^[A-Za-z][\w.&,'-]*$/.test(t)) {
        // Allow if mostly letters
        if (!/^[A-Za-z.&,'-]+$/.test(t)) break;
      }
      accumulated.unshift(t);
      if (accumulated.length >= 5) break;
    }
    if (accumulated.length > 0) {
      const name = accumulated.join(" ").trim();
      if (name.length >= 2 && name.length <= 80) {
        result.account_holder_name = name;
      }
    }
  }

  return result;
}
