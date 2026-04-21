-- Holding table for bank details from PandaDoc when affiliate doesn't exist in Supabase yet.
-- Processed by the affiliate sync after creating/updating affiliates.

CREATE TABLE IF NOT EXISTS pending_bank_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  document_id TEXT,
  document_name TEXT,
  account_holder_name TEXT,
  routing_number TEXT,
  account_number TEXT,
  account_type TEXT,
  processed BOOLEAN NOT NULL DEFAULT false,
  processed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pending_bank_email ON pending_bank_details(email);
CREATE INDEX idx_pending_bank_processed ON pending_bank_details(processed);

-- Server-only: no client access
ALTER TABLE pending_bank_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pending_bank_details FROM anon;
REVOKE ALL ON TABLE pending_bank_details FROM authenticated;
