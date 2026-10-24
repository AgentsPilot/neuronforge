/*
 * An email learns which booking, and which APPOINTMENT, it was about.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS WRONG TODAY
 *
 * `email_sends` has no link to a booking. None. It carries `contact_id`,
 * `sequence_id` and `campaign_id`, and the contact drawer's journey therefore
 * matches an email to a booking by GUESSING — `findConfirmationEmail(
 * booking.created_at, service_name)`, a time-and-name heuristic.
 *
 * That was survivable while a booking had exactly one appointment and one
 * confirmation. It is not survivable now: a booking rescheduled after a
 * no-show has several attempts, each with its own emails, and a heuristic
 * keyed on the booking's CREATION time cannot tell which attempt an email
 * belongs to. Every email would attach to the first one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO COLUMNS, BECAUSE THEY ANSWER TWO QUESTIONS
 *
 * `booking_id` — which JOB this email was about. Useful on its own, and the
 * right answer for an email that concerns the whole job rather than one
 * appointment: an invoice, a quote, a thank-you.
 *
 * `meeting_id` — which ATTEMPT. This is what lets the journey put a
 * confirmation under the appointment it confirmed and a reschedule request
 * under the one that was missed, instead of stacking all of them on the first.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FORWARD-ONLY, DELIBERATELY, AND NOT BACKFILLED
 *
 * There is NO backfill here, and that is a decision rather than an omission.
 * Nothing in the database records which booking an existing email was about —
 * the link was never stored — so any backfill would be the same guess the
 * heuristic already makes, written into a column that then LOOKS authoritative.
 * A wrong answer that cannot be told apart from a right one is worse than a
 * visible absence.
 *
 * So: both columns are NULL on every existing row, new emails carry the real
 * link, and the journey keeps the heuristic as its fallback for rows where
 * `meeting_id IS NULL`. Over time the guessing shrinks to nothing on its own.
 *
 * ON DELETE SET NULL on both, never CASCADE. A deleted booking must not delete
 * the record of what was sent to a client — that an email went out is a fact
 * about the business's conduct, and it outlives the appointment it was about.
 *
 * Plan: docs/workplans/BOOKING_MEETINGS_TABLE_PLAN.md (Phase 4c, emails)
 * ─────────────────────────────────────────────────────────────────────────────
 */

BEGIN;

ALTER TABLE public.email_sends
  ADD COLUMN IF NOT EXISTS booking_id uuid
  REFERENCES public.scheduling_bookings(id) ON DELETE SET NULL;

ALTER TABLE public.email_sends
  ADD COLUMN IF NOT EXISTS meeting_id uuid
  REFERENCES public.scheduling_meetings(id) ON DELETE SET NULL;

/*
 * The question these are asked: "what was sent about this appointment", and
 * "about this job". Partial, because the overwhelming majority of rows are
 * campaign and sequence sends that have no booking at all and never will.
 */
CREATE INDEX IF NOT EXISTS idx_email_sends_booking
  ON public.email_sends (booking_id)
  WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_sends_meeting
  ON public.email_sends (meeting_id)
  WHERE meeting_id IS NOT NULL;

COMMENT ON COLUMN public.email_sends.booking_id IS
  'The JOB this email was about, where it was about one. NULL for campaign and sequence sends, and for every row written before 20261077 — the link was never stored, and guessing it would put a heuristic into a column that reads as authoritative.';

COMMENT ON COLUMN public.email_sends.meeting_id IS
  'The APPOINTMENT this email was about — which attempt, for a booking rescheduled after an outcome. NULL where the email concerns the whole job rather than one appointment, and on every row predating 20261077.';

COMMIT;
