-- Transactions table — stores individual user transactions from Airtable
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referred_user_id UUID REFERENCES referred_users(id) ON DELETE SET NULL,
  affiliate_id UUID REFERENCES affiliates(id) ON DELETE SET NULL,
  airtable_record_id TEXT UNIQUE NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  transaction_type TEXT NOT NULL,
  transaction_external_id TEXT,
  transaction_date TIMESTAMPTZ,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "transactions_select_own" ON transactions
  FOR SELECT USING (affiliate_id = public.get_my_affiliate_id());

-- Indexes
CREATE INDEX idx_transactions_affiliate_id ON transactions(affiliate_id);
CREATE INDEX idx_transactions_referred_user_id ON transactions(referred_user_id);
CREATE INDEX idx_transactions_airtable_record_id ON transactions(airtable_record_id);
