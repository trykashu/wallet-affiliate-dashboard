-- Add safety limits to payout_settings
ALTER TABLE payout_settings
  ADD COLUMN IF NOT EXISTS max_single_payout NUMERIC(14,2) NOT NULL DEFAULT 5000.00,
  ADD COLUMN IF NOT EXISTS max_daily_aggregate NUMERIC(14,2) NOT NULL DEFAULT 25000.00,
  ADD COLUMN IF NOT EXISTS max_batch_size INTEGER NOT NULL DEFAULT 10;

-- Payout audit log — tracks every Mercury API call
CREATE TABLE IF NOT EXISTS payout_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id UUID REFERENCES payouts(id),
  affiliate_id UUID REFERENCES affiliates(id),
  action TEXT NOT NULL,
  amount NUMERIC(14,2),
  mercury_transaction_id TEXT,
  mercury_status TEXT,
  request_payload JSONB,
  response_payload JSONB,
  error_message TEXT,
  initiated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payout_audit_log_payout_id ON payout_audit_log(payout_id);
CREATE INDEX IF NOT EXISTS idx_payout_audit_log_created_at ON payout_audit_log(created_at);
