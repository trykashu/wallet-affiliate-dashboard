/**
 * Field payload for the Airtable "Affiliate Statements" mirror.
 *
 * Two constraints the schema imposes, both of which silently broke delivery:
 *
 *  - "Generated At" is a DATE field, not dateTime. A full ISO timestamp is
 *    rejected with 422 INVALID_VALUE_FOR_COLUMN, so no row is written at all —
 *    and because the mirror is best-effort, the payout still succeeds and the
 *    failure only shows up in payout_audit_log.
 *
 *  - The delivery workflow selects on {Statement Delivery Status} = 'Pending'.
 *    A row without it can never be picked up, so it must be set on create.
 *    It is deliberately NOT set when updating an existing statement: that would
 *    reset an already-Sent row to Pending and send a duplicate email.
 */
export interface StatementFieldInput {
  statementNumber: string;
  attributionId: string;
  period: string;
  statementUrl: string;
  totalFees: number;
  commissionDue: number;
  affiliateRecordId: string | null;
  generatedAt: Date;
  /** True when creating the row, false when patching an existing one. */
  isNew: boolean;
}

export function buildStatementAirtableFields(input: StatementFieldInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    Name: input.statementNumber,
    "Attribution ID": input.attributionId,
    Period: input.period,
    // Date-only: Airtable refuses a timestamp on a `date` field.
    "Generated At": input.generatedAt.toISOString().slice(0, 10),
    PDF: [{ url: input.statementUrl, filename: `${input.statementNumber}.pdf` }],
    "Statement URL": input.statementUrl,
    "Total Fees Collected": input.totalFees,
    "Commission Due": input.commissionDue,
    "Statement Number": input.statementNumber,
    // Statements are generated post-wire, so the commission is already paid.
    "Commission Status": "Paid",
  };
  if (input.affiliateRecordId) fields.Affiliate = [input.affiliateRecordId];
  if (input.isNew) fields["Statement Delivery Status"] = "Pending";
  return fields;
}
