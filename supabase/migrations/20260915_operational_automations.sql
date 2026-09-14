-- Permission to do the work, one kind at a time.
--
-- ---------------------------------------------------------------------------
-- WHY THREE COLUMNS AND NOT ONE
--
-- "Reply to a new enquiry for me" and "chase my clients for money" are
-- different appetites. A business perfectly happy for the platform to send a
-- booking link may have strong feelings about who asks their clients to pay,
-- and folding both behind one switch means the cautious answer to either is the
-- cautious answer to both — so the useful one never gets switched on.
--
-- `lead_autosend_enabled` already exists (20260914) and is the third of these;
-- it keeps its name because it is already live.
--
-- ALL OFF BY DEFAULT
--
-- Deliberately unlike `lead_alert_email_enabled`, which ships on. Being told
-- something happened is a courtesy the business is owed. Writing to their
-- client in their name is an act performed on their behalf, and consent to that
-- has to be given rather than assumed.
-- ---------------------------------------------------------------------------

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS chase_invoices_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS chase_intake_enabled   BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN business_profiles.chase_invoices_enabled IS
  'Send one reminder for an invoice still unpaid three days past due. Off by default: chasing a client for money in the business''s name is consent that must be given.';

COMMENT ON COLUMN business_profiles.chase_intake_enabled IS
  'Send one reminder for an intake form still not returned. Off by default, and separate from the invoice chase — they are different appetites.';

-- Partial indexes: the drain asks "who has opted in", never "what did this
-- business choose", so only the true rows are ever scanned.
CREATE INDEX IF NOT EXISTS idx_business_profiles_chase_invoices
  ON business_profiles (user_id)
  WHERE chase_invoices_enabled;

CREATE INDEX IF NOT EXISTS idx_business_profiles_chase_intake
  ON business_profiles (user_id)
  WHERE chase_intake_enabled;
