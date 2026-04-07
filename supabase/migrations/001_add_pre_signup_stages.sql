-- Add pre-signup funnel stages: waitlist, booked_call, sent_onboarding
-- These map to GHL User Pipeline stages before "Signed Up"

INSERT INTO funnel_statuses (slug, label, color, sort_order) VALUES
  ('waitlist', 'Waitlist', '#E5E7EB', 0),
  ('booked_call', 'Booked Call', '#D1D5DB', 0),
  ('sent_onboarding', 'Sent Onboarding', '#9CA3AF', 0)
ON CONFLICT (slug) DO NOTHING;

-- Fix sort_order for all stages
UPDATE funnel_statuses SET sort_order = 1 WHERE slug = 'waitlist';
UPDATE funnel_statuses SET sort_order = 2 WHERE slug = 'booked_call';
UPDATE funnel_statuses SET sort_order = 3 WHERE slug = 'sent_onboarding';
UPDATE funnel_statuses SET sort_order = 4 WHERE slug = 'signed_up';
UPDATE funnel_statuses SET sort_order = 5 WHERE slug = 'transaction_run';
UPDATE funnel_statuses SET sort_order = 6 WHERE slug = 'funds_in_wallet';
UPDATE funnel_statuses SET sort_order = 7 WHERE slug = 'ach_initiated';
UPDATE funnel_statuses SET sort_order = 8 WHERE slug = 'funds_in_bank';
