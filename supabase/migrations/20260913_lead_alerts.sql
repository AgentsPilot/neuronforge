-- Tell the owner when somebody reaches them.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- Nothing did. A visitor filled in a contact form, or a client booked and paid
-- for an hour, and the business was told nothing at all: every email the
-- platform sends on those paths goes to the CLIENT. The only owner-facing mail
-- was the daily briefing, which reports a new lead as a bare count, arrives the
-- next morning, and is off by default.
--
-- WHY THE DEFAULT IS TRUE, UNLIKE THE BRIEFING
--
-- `daily_briefing_email_enabled` ships false because a mail that arrives every
-- morning whether or not anything happened is a mail people unsubscribe from.
-- This one only ever fires because a real person asked to be contacted, and
-- silence there is the failure being fixed. A business that does not want it
-- can switch it off; a business that never hears about an enquiry has no way to
-- know it missed one.
--
-- WHY IT LIVES HERE AND NOT ON user_preferences
--
-- `user_preferences` has no DDL anywhere in this repo — it is read at runtime
-- but never created by a migration, so a migration against it would fail on a
-- fresh environment. Same reasoning as the briefing flag beside it.
-- ---------------------------------------------------------------------------

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS lead_alert_email_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN business_profiles.lead_alert_email_enabled IS
  'Send the owner an email the moment a contact form is submitted or a client books. On by default: the alert only fires because a real person asked to be contacted.';

-- The alert is sent per event rather than swept for, so nothing scans this
-- column across users. The index is here for the settings read and for any
-- future digest that does sweep.
CREATE INDEX IF NOT EXISTS idx_business_profiles_lead_alert
  ON business_profiles (user_id)
  WHERE lead_alert_email_enabled;
