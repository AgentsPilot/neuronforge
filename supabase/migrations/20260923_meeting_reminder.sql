-- A reminder before the appointment, on a schedule the owner chooses.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS ADDS THAT DID NOT EXIST
--
-- There is already a booking reminder email and a sender for it, but it can
-- only be reached through an INSIGHT — `send_reminder_sequence`, paired with
-- the no-show and cancellation-spike detectors. So it fires when something has
-- already started going wrong, and only then.
--
-- This is the standing version: every confirmed appointment, every time, at a
-- lead time the owner sets. And it tells the OWNER as well as the client,
-- which nothing currently does — a solo business owner wants the same nudge
-- their client gets.
--
-- WHY THE LEAD TIME IS A COLUMN AND NOT A CONSTANT
--
-- Every other operational automation has a fixed delay chosen by us, because
-- the right answer is the same for everybody: fifteen minutes to reply to an
-- enquiry, three days to chase an invoice. A meeting reminder is not like that.
-- A therapist wants twenty-four hours so the client can rearrange their day; a
-- barber wants two, because a day's notice is forgotten by morning. Getting it
-- wrong in either direction is the difference between a useful nudge and an
-- annoyance, and only the owner knows which their clients are.
--
-- Bounded at both ends by the CHECK below: under an hour is too late to act on,
-- and beyond a week the client has not planned that far ahead.
--
-- OFF UNTIL ASKED FOR, like every other operational automation. Writing to
-- somebody's client in their name is consent that has to be given rather than
-- assumed.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS meeting_reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS meeting_reminder_hours_before INTEGER NOT NULL DEFAULT 24;

-- ----------------------------------------------------------------------------
-- Who gets it. Two audiences, two switches, because they are different needs.
--
-- The CLIENT reminder exists so they turn up. The OWNER reminder exists so a
-- solo business owner working from a phone between jobs gets the same nudge
-- their client does — several asked for exactly that, and nothing on the
-- platform currently tells an owner anything before an appointment.
--
-- Both default TRUE so that switching the card on does the obvious thing; the
-- card itself is off until asked for, so neither sends until then.
-- ----------------------------------------------------------------------------
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS meeting_reminder_notify_client BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS meeting_reminder_notify_owner BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'business_profiles_meeting_reminder_hours_check'
  ) THEN
    ALTER TABLE business_profiles
      ADD CONSTRAINT business_profiles_meeting_reminder_hours_check
      CHECK (meeting_reminder_hours_before BETWEEN 1 AND 168);
  END IF;
END $$;

COMMENT ON COLUMN business_profiles.meeting_reminder_enabled IS
  'Whether a reminder goes out before EVERY confirmed appointment. Answered through the advisor card; off until asked for. While it is ON, the insight-triggered reminder (send_reminder_sequence, fired by the no-show and cancellation-spike detectors) stands down for this business — the two are alternatives, not layers, and running both would send two reminders for one appointment. See InsightActionDispatchService.bookingReminder.';

COMMENT ON COLUMN business_profiles.meeting_reminder_notify_client IS
  'Whether the client is reminded before their appointment. Only applies while meeting_reminder_enabled is true.';

COMMENT ON COLUMN business_profiles.meeting_reminder_notify_owner IS
  'Whether the OWNER is reminded before the appointment. Nothing else on the platform tells an owner anything before a booking. Only applies while meeting_reminder_enabled is true.';

COMMENT ON COLUMN business_profiles.meeting_reminder_hours_before IS
  'How many hours before the appointment the reminder goes out, 1-168. Owner-chosen because the right answer differs by trade: a day suits a therapist, two hours suits a barber. Read by the meeting_upcoming gap and by enqueueApprovedChases.';

-- ----------------------------------------------------------------------------
-- The queue has to accept the new kind.
--
-- `lead_responses.kind` is constrained, and the constraint rejected
-- 'meeting_reminder' — which is the correct behaviour and exactly why the
-- column has a CHECK: an unrecognised kind would otherwise be stored happily
-- and then skipped forever by a dispatcher that has never heard of it.
--
-- CHECK constraints cannot be extended in place, so the old one is dropped and
-- rewritten with the full set. Existing rows are unaffected: every value they
-- hold is still permitted.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  stray TEXT;
BEGIN
  SELECT string_agg(DISTINCT kind, ', ')
    INTO stray
    FROM lead_responses
   WHERE kind NOT IN ('invite', 'chase', 'invoice_chase', 'intake_chase', 'meeting_reminder');

  IF stray IS NOT NULL THEN
    RAISE EXCEPTION
      'lead_responses.kind holds unexpected value(s): %. Decide what those rows should be before constraining the column.',
      stray;
  END IF;
END $$;

ALTER TABLE lead_responses DROP CONSTRAINT IF EXISTS lead_responses_kind_check;

ALTER TABLE lead_responses
  ADD CONSTRAINT lead_responses_kind_check
  CHECK (kind IN ('invite', 'chase', 'invoice_chase', 'intake_chase', 'meeting_reminder'));

COMMENT ON COLUMN lead_responses.kind IS
  'What the queued message is: invite (booking link after an enquiry), chase (follow-up on that invite), invoice_chase, intake_chase, meeting_reminder. The roster lives in lib/business-os/gaps/automations.ts; a kind here with no dispatcher is queued and never sent.';

COMMIT;
