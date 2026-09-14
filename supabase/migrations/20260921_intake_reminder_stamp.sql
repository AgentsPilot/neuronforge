-- When the client was chased about their intake form.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ONE column, not a queue.
--
-- `payment_reminders` exists and was the obvious home, but it is money-shaped —
-- `invoice_id`, `installment_id`, an amount and a due date — and its drain is
-- `PaymentReminderService`. Adding a booking to it would mean teaching a
-- payments module about intake forms, for a job with no schedule to keep: the
-- question "who is unprepared for a meeting tomorrow" is answerable from the
-- bookings themselves, at any moment, without anything having been queued in
-- advance.
--
-- So the state lives beside the other two intake facts on the booking:
--
--   intake_sent_at       the form was emailed
--   intake_reminded_at   they were chased about it        ← this
--   intake_completed_at  they answered
--
-- Null and never chased are the same thing, which is what makes the cron
-- idempotent: it stamps as it sends, so a second run in the same hour finds
-- nothing to do. That is the whole of "one reminder".
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE scheduling_bookings
  ADD COLUMN IF NOT EXISTS intake_reminded_at TIMESTAMPTZ;

COMMENT ON COLUMN scheduling_bookings.intake_reminded_at IS
  'When the client was reminded to complete their intake form. Set once; null means never chased.';

-- The cron's own lookup: confirmed bookings starting soon whose intake is still
-- unanswered and unchased. Partial, because that is a small slice of a table
-- that only grows.
CREATE INDEX IF NOT EXISTS idx_bookings_intake_chase
  ON scheduling_bookings (start_time)
  WHERE status = 'confirmed'
    AND intake_completed_at IS NULL
    AND intake_reminded_at IS NULL
    AND start_time IS NOT NULL;
