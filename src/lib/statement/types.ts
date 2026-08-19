export interface StatementData {
  statement_number: string;
  statement_date: string;        // "Mar 15, 2026"
  period_label: string;          // "April 2026"
  affiliate: {
    name: string;
    tier: "gold" | "platinum" | "master";
    address1: string;
    address2: string | null;
    city: string;
    region: string;
    postal_code: string;
    phone: string | null;
    email: string;
    account_last4: string;
  };
  transactions: Array<{
    date: string;                // "Apr 12, 2026"
    client: string;
    transaction_amount: number;
    fee_collected: number;
    commission: number;
  }>;
  totals: {
    eligible_count: number;
    total_fees: number;
    commission_due: number;
    commission_rate_pct: number;
  };
}
