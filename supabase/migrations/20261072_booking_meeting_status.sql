/*
 * The meeting gets its own outcome, separate from the booking's.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * `scheduling_bookings.status` answers three independent questions with one
 * five-value enum:
 *
 *   · is the time still reserved?   `confirmed`/`pending`/`completed` hold it
 *   · did the meeting happen?       `completed`, `no_show`
 *   · is the job still on?          `cancelled`
 *
 * They are independent in reality, so the compression leaks. The reported
 * symptom was a quoted consultation marked "הפגישה התקיימה" and then cancelled:
 * the create-quote button stayed on screen, because `SchedulingRepository.cancel`
 * deliberately preserves a recorded attendance and therefore never writes
 * `cancelled`, while `quoteGate` tests for exactly that value. Two production
 * rows are in this state today, reading `status = 'completed'` with a
 * `cancel_reason` and a `cancelled_by` beside them.
 *
 * This column gives the meeting somewhere of its own to live, so neither fact
 * has to overwrite the other. The money layer (`payment_status`, invoices,
 * plans) and the proposal layer (`proposals.status`) already have this; the
 * meeting was the only one without it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NULL IS A REAL VALUE, AND IT IS THE ONE THAT DID NOT EXIST
 *
 * `null` means NOBODY HAS SAID YET. Not "it did not happen" — a past meeting
 * nobody marked is the ordinary case, because owners quote from the van and
 * rarely tick an appointment first. The journey currently has to guess that
 * state from the clock, which is how a site visit nobody attended came to be
 * reported as a price the owner owed.
 *
 * FOUR OUTCOMES, AND `no_show` IS NOT `cancelled`:
 *
 *   · `held`      the meeting took place
 *   · `no_show`   the time passed and they did not come. Unplanned, and it may
 *                 carry a fee or a policy
 *   · `cancelled` known in advance, the meeting will not take place. Planned,
 *                 and usually chargeable to nobody
 *
 * Both of the last two free the slot. Only one of them is the client's doing,
 * and today the card cannot say which.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS MIGRATION CHANGES NO BEHAVIOUR
 *
 * Nothing reads the column yet. `status` keeps its current meaning and keeps
 * being written exactly as before; the application writes BOTH from here on, so
 * every existing reader is untouched. Readers move across one at a time, each
 * with its own test, and only then does `status` stop carrying the meeting.
 *
 * The backfill is exact rather than approximate: today's `completed` and
 * `no_show` ARE the meeting's outcome, which is the whole problem this fixes.
 *
 * A row cancelled BEFORE its meeting is left `null` here on purpose. Its
 * meeting has no recorded outcome — the job was called off, which is
 * `status`/`cancel_reason`'s business, not this column's.
 *
 * Workplan: docs/workplans/BOOKING_MEETING_SEPARATION_WORKPLAN.md (P1-1)
 * Requirement: docs/requirements/BOOKING_MEETING_SEPARATION_REQUIREMENT.md
 * ─────────────────────────────────────────────────────────────────────────────
 */

BEGIN;

ALTER TABLE public.scheduling_bookings
  ADD COLUMN IF NOT EXISTS meeting_status TEXT;

/*
 * Named so a failure says which value was refused. `NULL` passes: the CHECK is
 * about what a WRITTEN value may be, and "not said yet" is the default state of
 * every booking ever made.
 */
ALTER TABLE public.scheduling_bookings
  DROP CONSTRAINT IF EXISTS scheduling_bookings_meeting_status_check;

ALTER TABLE public.scheduling_bookings
  ADD CONSTRAINT scheduling_bookings_meeting_status_check
  CHECK (meeting_status IS NULL OR meeting_status IN ('held', 'no_show', 'cancelled'));

/*
 * The backfill.
 *
 * Guarded on `IS NULL` so re-running this migration cannot overwrite an outcome
 * the application has since recorded.
 */
UPDATE public.scheduling_bookings
   SET meeting_status = 'held'
 WHERE status = 'completed'
   AND meeting_status IS NULL;

UPDATE public.scheduling_bookings
   SET meeting_status = 'no_show'
 WHERE status = 'no_show'
   AND meeting_status IS NULL;

/*
 * Partial, because every query that will use this column asks for a MARKED
 * meeting — "which were held", "which were missed". The unmarked rows are the
 * majority and are never selected by value; they are found by `IS NULL`, which
 * this index deliberately does not cover.
 */
CREATE INDEX IF NOT EXISTS idx_scheduling_bookings_meeting_status
  ON public.scheduling_bookings (user_id, meeting_status)
  WHERE meeting_status IS NOT NULL;

COMMENT ON COLUMN public.scheduling_bookings.meeting_status IS
  'What happened at the APPOINTMENT, independent of the job. NULL means nobody has said yet, which is the ordinary state of a past meeting. held | no_show | cancelled. The job''s own state stays in status/cancel_reason/cancelled_by.';

COMMIT;
