-- One switch for chasing an unpaid invoice.
--
-- ---------------------------------------------------------------------------
-- THE PROBLEM
--
-- Invoice chasing was built twice, with two unrelated switches, and neither
-- knew about the other.
--
--   PaymentReminderService     days 1, 3 and 7 past due
--                              gated on `payment_reminder_enabled`
--                              true on all five accounts, never asked about
--
--   the advisor's own sweep    once at 72 hours past due
--                              gated on `chase_invoices_enabled`
--                              false until an owner pressed "Yes, do this"
--
-- Seventy-two hours past due IS day three. On the account this was found from,
-- turning the advisor's card on meant the next overdue invoice would send on
-- day one, TWICE on day three, and again on day seven — one business, one
-- invoice, one client. The two paths dedupe in different tables
-- (`payment_reminders` by reminder type, `lead_responses` by kind), so neither
-- could see the other's send.
--
-- WHAT CHANGED IN THE CODE
--
-- The advisor's send was withdrawn; `chase_invoices_enabled` now gates
-- `PaymentReminderService`'s overdue scan instead. One question asked, one
-- system sending, on the schedule the owner can already configure through
-- `payment_overdue_reminder_days`.
--
-- WHY THIS MIGRATION EXISTS
--
-- Without it, that change would silently STOP the chasing that four of five
-- accounts are receiving today: their overdue reminders have been going out on
-- `payment_reminder_enabled`, and `chase_invoices_enabled` is false for them.
-- Moving the gate without carrying the answer across would read, to those
-- businesses, as the platform quietly deciding to stop collecting their money.
--
-- So the existing answer is carried over. A business already having its
-- invoices chased goes on having them chased; nothing starts that was not
-- already running.
--
-- NOT A BACKFILL OF CONSENT
--
-- Worth being plain about: `payment_reminder_enabled` defaulted to true and no
-- owner was ever asked. This copies that default forward rather than inventing
-- agreement, and it is the smaller of the two harms — the alternative silently
-- stops a live collections process for every account. The card now shows the
-- state and can be switched off, which is the part that was missing.
-- ---------------------------------------------------------------------------

BEGIN;

UPDATE business_profiles
SET
  chase_invoices_enabled = TRUE,
  updated_at = NOW()
WHERE
  payment_reminder_enabled IS TRUE
  AND chase_invoices_enabled IS DISTINCT FROM TRUE;

COMMENT ON COLUMN business_profiles.chase_invoices_enabled IS
  'Whether the platform may email this business''s clients about invoices that are past due. Answered through the advisor''s "Chase unpaid invoices" card; read by PaymentReminderService''s overdue scan, which is the only thing that sends. The schedule is payment_overdue_reminder_days.';

COMMENT ON COLUMN business_profiles.payment_reminder_enabled IS
  'Whether reminders are sent BEFORE an invoice is due (upcoming_due, due_today). Past-due chasing is chase_invoices_enabled, deliberately separate: a reminder before the date is a courtesy, one after it says you are late.';

COMMIT;
