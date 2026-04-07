/**
 * Airtable API client helper.
 * Handles pagination and provides a generic fetch-all-records function.
 */

const AIRTABLE_API_BASE = "https://api.airtable.com/v0";

export interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

/**
 * Fetch ALL records from an Airtable table, handling pagination via `offset`.
 * Returns all pages concatenated.
 */
export async function fetchAllRecords(
  baseId: string,
  tableId: string,
): Promise<{ records: AirtableRecord[]; apiCalls: number }> {
  const pat = process.env.AIRTABLE_PAT;
  if (!pat) {
    throw new Error("AIRTABLE_PAT not configured");
  }

  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  let apiCalls = 0;

  do {
    const url = new URL(`${AIRTABLE_API_BASE}/${baseId}/${tableId}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${pat}` },
      cache: "no-store",
    });
    apiCalls++;

    if (!res.ok) {
      throw new Error(`Airtable API error: ${res.status}`);
    }

    const json = await res.json();
    records.push(...(json.records || []));
    offset = json.offset;
  } while (offset);

  return { records, apiCalls };
}
