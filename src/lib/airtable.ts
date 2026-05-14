/**
 * Airtable API client helper.
 * Handles pagination and provides a generic fetch-all-records function.
 */

const AIRTABLE_API_BASE = "https://api.airtable.com/v0";

export interface AirtableRecord {
  id: string;
  createdTime: string;
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

export interface PatchResult {
  updated: number;
  failed: Array<{ record_id: string; error: string }>;
  apiCalls: number;
}

/**
 * Update fields on Airtable records via PATCH. Batches up to 10 records per
 * API call (Airtable's hard limit). Continues on per-batch errors and reports
 * which records failed.
 */
export async function patchRecords(
  baseId: string,
  tableId: string,
  updates: Array<{ id: string; fields: Record<string, unknown> }>,
): Promise<PatchResult> {
  const pat = process.env.AIRTABLE_PAT;
  if (!pat) {
    throw new Error("AIRTABLE_PAT not configured");
  }

  const BATCH_SIZE = 10;
  const result: PatchResult = { updated: 0, failed: [], apiCalls: 0 };
  if (updates.length === 0) return result;

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    const url = `${AIRTABLE_API_BASE}/${baseId}/${tableId}`;

    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${pat}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ records: batch, typecast: false }),
        cache: "no-store",
      });
      result.apiCalls++;

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        for (const u of batch) {
          result.failed.push({
            record_id: u.id,
            error: `${res.status} ${errText.slice(0, 200)}`,
          });
        }
        continue;
      }

      const json = (await res.json()) as { records?: AirtableRecord[] };
      result.updated += (json.records ?? []).length;
    } catch (e) {
      for (const u of batch) {
        result.failed.push({
          record_id: u.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  return result;
}
