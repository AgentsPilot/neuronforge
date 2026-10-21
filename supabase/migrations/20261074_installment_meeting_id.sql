/*
 * A payment stage learns which MEETING it bills.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE THING THAT BREAKS WITHOUT THIS
 *
 * `payment_plan_installments.booking_id` points at a CHILD booking today. That
 * is how "bill after session 3" finds session 3: the child row IS the meeting,
 * and `billSessionOnCompletion` looks the stage up by its booking id.
 *
 * Meetings are moving to `scheduling_meetings` (20261073). When child bookings
 * stop being written, a stage bound by `booking_id` can still name the JOB —
 * but it can no longer name WHICH SESSION of that job it bills. On a package of
 * six that is the whole meaning of the row.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ADDITIVE, AND `booking_id` IS NOT TOUCHED
 *
 * The column is added and backfilled. `booking_id` keeps its current value and
 * every existing reader keeps working, unchanged, including
 * `billSessionOnCompletion`. Nothing switches to the new key in this migration.
 *
 * That ordering is the point. Adding the key and repointing the readers in one
 * step would leave a window where the money has no correct answer for which
 * meeting it belongs to; doing it this way there is never such a moment.
 *
 * NOT EVERY STAGE GETS ONE, AND THAT IS CORRECT. A plan on a service that is
 * bought rather than booked — a course, a product — has no appointment to bill
 * against. Those keep `meeting_id IS NULL`, which is the honest answer, and is
 * why the column is nullable with no default.
 *
 * Plan: docs/workplans/BOOKING_MEETINGS_TABLE_PLAN.md (Phase 2)
 * ─────────────────────────────────────────────────────────────────────────────
 */

BEGIN;

ALTER TABLE public.payment_plan_installments
  ADD COLUMN IF NOT EXISTS meeting_id uuid
  REFERENCES public.scheduling_meetings(id) ON DELETE SET NULL;

/*
 * ON DELETE SET NULL, not CASCADE.
 *
 * A deleted meeting must never take a payment row with it. The money arrived,
 * or is owed, whatever happened to the appointment — and an instalment that
 * vanishes is a figure that stops reconciling.
 */

/* The question this is asked: "which stage bills this meeting". */
CREATE INDEX IF NOT EXISTS idx_installments_meeting
  ON public.payment_plan_installments (meeting_id)
  WHERE meeting_id IS NOT NULL;

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BACKFILL
 *
 * Every timed booking has exactly one meeting (20261073 guarantees it and its
 * check script proves it), so the lookup is a clean 1:1 — and it holds whether
 * the stage points at a package child or at an ordinary booking.
 *
 * Guarded on `meeting_id IS NULL` so re-running cannot overwrite a binding the
 * application has since recorded.
 * ─────────────────────────────────────────────────────────────────────────────
 */
UPDATE public.payment_plan_installments i
   SET meeting_id = m.id
  FROM public.scheduling_meetings m
 WHERE i.booking_id = m.booking_id
   AND i.meeting_id IS NULL;

COMMENT ON COLUMN public.payment_plan_installments.meeting_id IS
  'The APPOINTMENT this stage bills, for a plan that charges per session. NULL where the plan has no appointment to bill against — a course, a product — or where the stage falls due on a date rather than on work being done. `booking_id` names the JOB and remains valid; this names which meeting of it.';

COMMIT;
