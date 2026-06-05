-- 023_link_affiliate_trim_email.sql
-- Harden the on_auth_user_created linkage trigger against leading/trailing
-- whitespace in affiliate emails. Migration 022 made the match
-- case-insensitive via lower(), but affiliate rows imported from
-- PandaDoc / Airtable can carry stray whitespace (e.g. "name@x.com ").
-- lower() alone leaves those unmatched, so user_id stays NULL and the
-- dashboard shows "Account Being Set Up" even though the auth user exists.
--
-- Fix: compare lower(trim(...)) on both sides, and backfill anyone the
-- previous comparison missed.

CREATE OR REPLACE FUNCTION public.link_affiliate_on_signup()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.affiliates
  SET user_id = NEW.id, updated_at = now()
  WHERE lower(trim(email)) = lower(trim(NEW.email)) AND user_id IS NULL;
  RETURN NEW;
END;
$$;

-- Backfill: any affiliate whose (trimmed, lowercased) email matches an
-- existing auth.users row but still has user_id = NULL gets linked now.
-- This re-links anyone left stranded by the whitespace bug — including
-- Tocarrius Norris if that's the cause.
UPDATE public.affiliates a
SET user_id = u.id,
    updated_at = now()
FROM auth.users u
WHERE a.user_id IS NULL
  AND lower(trim(a.email)) = lower(trim(u.email));

-- Login-time self-heal RPC. Called from /api/auth/post-login as a fallback
-- when no affiliate is linked to the authenticated user_id. Performs the
-- exact same trimmed, case-insensitive match as the trigger (no ilike
-- wildcard surprises from "_" in local parts), and only ever links an
-- affiliate whose user_id is still NULL. Returns the linked affiliate row
-- (or no rows). SECURITY DEFINER so it runs regardless of caller RLS, but
-- the post-login route already uses the service client.
CREATE OR REPLACE FUNCTION public.link_affiliate_by_email(
  p_user_id UUID,
  p_email   TEXT
)
RETURNS TABLE (id UUID, has_password BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.affiliates a
  SET user_id = p_user_id, updated_at = now()
  WHERE a.user_id IS NULL
    AND lower(trim(a.email)) = lower(trim(p_email))
  RETURNING a.id, a.has_password;
END;
$$;
