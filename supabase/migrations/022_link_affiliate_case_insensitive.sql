-- 022_link_affiliate_case_insensitive.sql
-- Fix the on_auth_user_created trigger so it matches affiliate rows by
-- lower(email). Supabase Auth normalizes auth.users.email to lowercase
-- on insert, but affiliate rows are inserted with whatever casing came
-- from the source system (PandaDoc / Airtable). The previous
-- case-sensitive comparison silently failed for any affiliate whose
-- stored email had a capital letter, leaving user_id null and showing
-- "Account Being Set Up" on the dashboard.
--
-- Also: backfill any existing affiliates that were affected by the bug.

CREATE OR REPLACE FUNCTION public.link_affiliate_on_signup()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.affiliates
  SET user_id = NEW.id, updated_at = now()
  WHERE lower(email) = lower(NEW.email) AND user_id IS NULL;
  RETURN NEW;
END;
$$;

-- Backfill: any affiliate whose email matches an existing auth.users row
-- (case-insensitive) but has user_id = NULL gets linked now.
UPDATE public.affiliates a
SET user_id = u.id,
    updated_at = now()
FROM auth.users u
WHERE a.user_id IS NULL
  AND lower(a.email) = lower(u.email);
