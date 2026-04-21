-- Add flag for affiliates who need to manually enter bank details
-- (set to true when PandaDoc field extraction fails validation)
ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS bank_details_needed BOOLEAN NOT NULL DEFAULT false;
