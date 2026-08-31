/**
 * Interpret a POST /api/admin/payouts/execute-batch response.
 *
 * The endpoint answers HTTP 200 with `executed_count: 0` when its scope matches
 * no requested payouts. Read naively that looks like success, so a retry can
 * report "done" having sent nothing — which is precisely the failure mode this
 * whole payout path kept producing. Nothing sent is treated as a failure.
 */
export interface ExecuteOutcome {
  ok: boolean;
  message: string;
}

export function interpretExecuteResponse(
  httpOk: boolean,
  status: number,
  body: Record<string, unknown> | null | undefined,
): ExecuteOutcome {
  const b = body ?? {};

  if (!httpOk) {
    const detail = typeof b.detail === "string" ? ` — ${b.detail}` : "";
    const error = typeof b.error === "string" ? b.error : `Execute failed (${status})`;
    return { ok: false, message: `${error}${detail}` };
  }

  const errors = Array.isArray(b.errors) ? (b.errors as unknown[]).map(String) : [];
  if (errors.length > 0) {
    return { ok: false, message: errors.join("\n") };
  }

  const executed = typeof b.executed_count === "number" ? b.executed_count : 0;
  if (executed < 1) {
    const detail = typeof b.message === "string" ? ` (${b.message})` : "";
    return { ok: false, message: `Nothing was sent${detail}` };
  }

  return { ok: true, message: `Sent ${executed} payout${executed === 1 ? "" : "s"}.` };
}
