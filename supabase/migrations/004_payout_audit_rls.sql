-- Enable RLS on payout_audit_log (flagged by Supabase Security Advisor)
ALTER TABLE public.payout_audit_log ENABLE ROW LEVEL SECURITY;

-- No client-facing policies — this table is admin/server-only.
-- Access is via service role key (bypasses RLS) in admin API routes.

-- Revoke all access from public-facing roles (defense in depth)
REVOKE ALL ON TABLE public.payout_audit_log FROM anon;
REVOKE ALL ON TABLE public.payout_audit_log FROM authenticated;
