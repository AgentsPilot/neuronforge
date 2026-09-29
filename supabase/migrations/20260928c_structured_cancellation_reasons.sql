-- Cancellation reasons you can actually count, and a column for WHO cancelled.
--
-- WHY
--
-- Five surfaces cancel something and only two recorded a reason that could be
-- grouped (`decline_reason` on proposals, and `stop_reason` added alongside this).
-- A booking cancellation stored prose in `cancellation_reason`, so the two
-- detectors that report on cancellations group raw strings:
--
--   RetCancellationSpikeDetector    b.cancellation_reason || 'No reason provided'
--   OpsLastMinuteCancelsDetector    b.cancellation_reason || 'No reason'
--
-- "Client is ill", "client ill", "ill" and "sick" are four reasons in that
-- report and one reason in life.
--
-- WORSE: WHO CANCELLED WAS A STRING PREFIX
--
-- `lib/services/bookingCancellationReason.ts` says it outright — "THE ONLY
-- RECORD OF WHO CANCELLED. There is no column for it." The business/client
-- distinction was `cancellation_reason LIKE 'Cancelled by client%'`, parsed by
-- the `booking_cancelled` gap and by CashCancelledUnrefundedDetector. Its own
-- comment records that it has already broken once, when two files spelled the
-- same sentence differently and every explained cancellation went invisible.
--
-- HOW THIS STAYS SAFE
--
-- Purely ADDITIVE. `cancellation_reason` is left exactly as it is and the prefix
-- is still written, so every existing reader keeps working unchanged. New readers
-- prefer `cancelled_by`, and fall back to the prefix for rows that predate this.
--
-- NULLABLE, on purpose. Rows cancelled before this shipped have no code and never
-- will. NOT NULL would require backfilling a default, which would invent data in
-- the exact column the analytics are meant to trust. The reason is MANDATORY at
-- the API and in the UI, where a person is present to answer; "unknown" stays
-- representable for history.
--
-- Codes are NOT constrained by a CHECK. The vocabulary lives in
-- `lib/business-os/cancellationReasons.ts` and will be added to; a constraint
-- would turn every new reason into a migration. The API's Zod enum is the gate.

ALTER TABLE scheduling_bookings
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

ALTER TABLE scheduling_bookings
  ADD COLUMN IF NOT EXISTS cancel_note TEXT;

-- 'client' | 'owner' | 'system' — see CANCELLED_BY.
--
-- Constrained, unlike the reason codes: this is a closed set of actors, not
-- product vocabulary, and a typo here silently misattributes a cancellation to
-- the wrong party in every report that reads it.
ALTER TABLE scheduling_bookings
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT
  CHECK (cancelled_by IS NULL OR cancelled_by IN ('client', 'owner', 'system'));

COMMENT ON COLUMN scheduling_bookings.cancel_reason IS
  'Why it was cancelled, from CLIENT_CANCEL_REASONS or OWNER_CANCEL_REASONS. Null for rows cancelled before this column existed. Group with canonicalReason() — some stored codes have equivalent spellings.';

COMMENT ON COLUMN scheduling_bookings.cancel_note IS
  'The sentence the client or owner typed. Never a substitute for cancel_reason.';

COMMENT ON COLUMN scheduling_bookings.cancelled_by IS
  'Who called it off. Replaces parsing the CLIENT_CANCELLED_PREFIX out of cancellation_reason, which is still written for existing readers.';

-- The report this exists to serve: cancellations by reason and by party.
-- Partial, because most bookings are not cancelled.
CREATE INDEX IF NOT EXISTS idx_bookings_cancel_reason
  ON scheduling_bookings (user_id, cancel_reason, cancelled_by)
  WHERE status = 'cancelled';
