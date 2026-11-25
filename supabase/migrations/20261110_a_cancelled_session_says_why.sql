/*
 * A cancelled SESSION can say why, the same way a cancelled job can.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS MISSING TODAY
 *
 * `scheduling_bookings` carries four columns for this — `cancellation_reason`,
 * `cancel_reason`, `cancel_note`, `cancelled_by` — and `scheduling_meetings`
 * carries none. So calling off one session of a package records that it was
 * called off and nothing about why.
 *
 * Measured on the live database, 2026-11-09: 169 sessions carry
 * `meeting_status = 'cancelled'` and not one of them can name a reason, against
 * 147 cancelled jobs that all can.
 *
 * The cost is not only a report. `RetCancelPatternDetector` exists to tell an
 * owner WHY clients cancel, and it reads the booking because that is the only
 * row that knows. Pointing it at the meetings table without these columns would
 * trade a narrow answer for a wider blank one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SAME FOUR, DELIBERATELY, AND NOT A SUBSET
 *
 * A reader that has to ask "which of the two shapes is this" is the drift this
 * whole table separation has been paying down. The columns are named and typed
 * exactly as on the booking so a caller can read either and a future reader can
 * merge them without a translation table.
 *
 *   cancellation_reason  free text, what was typed
 *   cancel_reason        the structured code, where one was chosen
 *   cancel_note          the owner's own note
 *   cancelled_by         who did it
 *
 * NO CHECK CONSTRAINT on `cancelled_by` here, matching the booking. The
 * neighbouring `moved_by` has one, and a repair script that tried to stamp a
 * marker into it failed with 23514 — see
 * `SQL Scripts/20261109_restore_moved_makeup_lineage_data.sql`. Copying that
 * constraint onto a column the application fills from a wider set of actors
 * would reproduce the failure at write time instead of repair time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING IS BACKFILLED, AND THAT IS NOT AN OVERSIGHT
 *
 * The 169 rows never captured a reason; there is nothing to copy. Taking the
 * parent job's reason would be an invention: a job cancelled in March does not
 * explain a session called off in October, and a detector reading those would
 * report a pattern nobody caused.
 *
 * They read as "no reason given" for good, which is true.
 *
 * REVERSIBLE by dropping the four columns. Nothing reads them until the write
 * path fills them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

BEGIN;

ALTER TABLE public.scheduling_meetings
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancel_reason       text,
  ADD COLUMN IF NOT EXISTS cancel_note         text,
  ADD COLUMN IF NOT EXISTS cancelled_by        text;

COMMENT ON COLUMN public.scheduling_meetings.cancellation_reason IS
  'Free text: why this APPOINTMENT was called off. Mirrors scheduling_bookings.cancellation_reason, which answers the same question for the whole job. NULL on every row cancelled before 20261110 — the reason was never captured and must not be inferred from the parent job.';

COMMENT ON COLUMN public.scheduling_meetings.cancel_reason IS
  'The structured code behind the cancellation, where the caller chose one. Same vocabulary as scheduling_bookings.cancel_reason so a reader can merge the two without translating.';

COMMENT ON COLUMN public.scheduling_meetings.cancel_note IS
  'The owner''s own note about this cancellation. Mirrors scheduling_bookings.cancel_note.';

COMMENT ON COLUMN public.scheduling_meetings.cancelled_by IS
  'Who called it off. Deliberately NOT constrained, matching scheduling_bookings.cancelled_by: the neighbouring moved_by carries a CHECK and a script writing outside its values failed with 23514. Distinct from outcome_by, which records who last ruled on the appointment whatever that ruling was.';

COMMIT;
