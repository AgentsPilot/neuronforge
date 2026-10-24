/*
 * A moved appointment gives its hour back, and two meetings cannot share one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * Rescheduling writes a SECOND row — deliberately, so the time that was
 * communicated to a client survives (20261082, and the long note in
 * `syncMeeting`). What it did not do is tell the FIRST row it had been
 * superseded. That row kept `meeting_status: NULL`, and null is the value that
 * means "nobody has said yet", which `MEETING_HOLDS_SLOT_FILTER` must read as
 * HOLDING — otherwise every future appointment would read as free.
 *
 * So the abandoned hour stayed blocked. Not for a while: forever, and against
 * everybody including the same client trying to rebook. Nothing errors and
 * nothing is logged; the owner sees an hour that simply never comes up.
 *
 * Measured on the live database before this ran: 14 abandoned attempts holding
 * hours nobody had booked, 8 of which overlapped a real appointment somebody
 * else had since taken. Zero were genuine double-bookings.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `moved` AND NOT `cancelled`
 *
 * Both free the hour, so either would fix the slot. They are kept apart
 * because a reschedule is not a lost client: the moment a reader counts
 * cancellations off this table instead of the booking mirror — which is the
 * direction this whole module is moving — collapsing the two would report
 * every moved appointment as a cancellation.
 *
 * `moved` is written by the system only, and on this table only. The booking
 * mirror's check (20261072) deliberately does not accept it: a booking shows
 * its CURRENT appointment, which is never a superseded one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE CONSTRAINT COMES WITH IT, AND NOT BEFORE
 *
 * `scheduling_meetings` has had NO exclusion constraint. It did not bite while
 * every meeting mirrored a booking that carried one — but a package is about
 * to become ONE booking with `start_time: NULL`, which
 * `scheduling_bookings_no_overlap` excludes by its own `start_time IS NOT
 * NULL` clause. Every package meeting would then be written with no
 * database-level protection against double-booking at all, and `busyMeetings`
 * is a check, not a guarantee: two clients clicking at once both read the slot
 * free.
 *
 * The constraint could not be added first. The 8 overlaps above would have
 * refused it, and the same abandoned rows would have made moving an
 * appointment BACK to an earlier time (13:00 → 19:00 → 13:00, an ordinary
 * thing to do) collide with the booking's own history. Freeing them is what
 * makes the constraint possible, so both land in one transaction.
 *
 * Plan: docs/workplans/PACKAGE_MEETINGS_PHASE_5.md § G0
 * ─────────────────────────────────────────────────────────────────────────────
 */

BEGIN;

/* btree_gist gives gist the uuid `=` operator. Already present for
   `scheduling_bookings_no_overlap` (20261001); named here so this migration
   stands on its own. */
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─── 1. The vocabulary ───────────────────────────────────────────────────────

/*
 * `scheduling_meetings_status_check`, the name 20261073 actually gave it — NOT
 * `…_meeting_status_check`, which is the column's name and what a first
 * attempt at this migration guessed. A `DROP … IF EXISTS` on a name that does
 * not exist succeeds silently, so the old three-value check survived and
 * refused the backfill below with 23514. Both names are dropped here: the
 * wrong one may exist on a database where that attempt reached this far.
 */
ALTER TABLE public.scheduling_meetings
  DROP CONSTRAINT IF EXISTS scheduling_meetings_status_check;

ALTER TABLE public.scheduling_meetings
  DROP CONSTRAINT IF EXISTS scheduling_meetings_meeting_status_check;

ALTER TABLE public.scheduling_meetings
  ADD CONSTRAINT scheduling_meetings_status_check
  CHECK (meeting_status IS NULL OR meeting_status IN ('held', 'no_show', 'cancelled', 'moved'));

-- ─── 2. Give back the hours already abandoned ────────────────────────────────

/*
 * An attempt is SUPERSEDED when a later `occurrence_number` exists for the
 * same booking — the definition `listAttempts` already orders by.
 *
 * `meeting_status IS NULL` only. A superseded attempt marked `held` or
 * `no_show` is a record of what happened and keeps saying it; this is for the
 * rows where nobody ever said anything, which are the ones holding hours.
 *
 * Idempotent: a second run finds nothing left to stamp.
 */
UPDATE public.scheduling_meetings AS m
   SET meeting_status = 'moved'
 WHERE m.meeting_status IS NULL
   AND EXISTS (
     SELECT 1
       FROM public.scheduling_meetings AS later
      WHERE later.booking_id = m.booking_id
        AND later.occurrence_number > m.occurrence_number
   )
   /*
    * ─────────────────────────────────────────────────────────────────────────
    * ONLY WHERE THE NUMBER COUNTS ATTEMPTS.
    *
    * `occurrence_number` means two things, told apart by the BOOKING rather
    * than by anything on the meeting:
    *
    *   · a booking with a clock has one appointment, and the number counts
    *     ATTEMPTS at it — #2 is the same meeting moved, which supersedes #1;
    *   · a container has no clock, and the number counts SESSIONS of a
    *     package — #2 is a different appointment, and #1 is still to happen.
    *
    * Without this clause, a package re-running this migration would have
    * sessions 1..N-1 stamped `moved` and five of its six hours put back on
    * sale while the client still holds them. The rule is idempotent, so a
    * re-run is a real possibility — a fresh environment, or a replayed
    * migration — and it has to stay safe once packages exist in that shape.
    *
    * `start_time IS NOT NULL` is the same test `syncMeeting` already uses to
    * decide a container is a purchase and has no meeting to mirror.
    * ─────────────────────────────────────────────────────────────────────────
    */
   AND EXISTS (
     SELECT 1
       FROM public.scheduling_bookings AS job
      WHERE job.id = m.booking_id
        AND job.start_time IS NOT NULL
   );

-- ─── 3. One hour, one meeting ────────────────────────────────────────────────

ALTER TABLE public.scheduling_meetings
  DROP CONSTRAINT IF EXISTS scheduling_meetings_no_overlap;

ALTER TABLE public.scheduling_meetings
  ADD CONSTRAINT scheduling_meetings_no_overlap
  EXCLUDE USING gist (
    user_id WITH =,
    tstzrange(start_time, end_time) WITH &&
  )
  WHERE (
    /*
     * The same sentence as `holdsSlot` and `MEETING_HOLDS_SLOT_FILTER`:
     * positively what HOLDS, never `NOT IN (…)`. In SQL `NULL NOT IN (…)` is
     * NULL rather than true, so the negated form drops every unmarked meeting
     * — nearly all of them — and the whole diary becomes bookable.
     *
     * The job's status is deliberately absent: it is not on this table, and it
     * does not need to be. A cancelled job's meetings are stamped
     * `meeting_status = 'cancelled'` when it is cancelled (and 20261075
     * backfilled the old ones), so the meeting-side filter already covers it.
     * That makes the runtime stamp load-bearing rather than belt-and-braces,
     * which is why it is verified: zero current attempts were found holding an
     * hour for a cancelled job.
     */
    meeting_status IS NULL OR meeting_status = 'held'
  );

COMMENT ON CONSTRAINT scheduling_meetings_no_overlap ON public.scheduling_meetings IS
  'One hour, one meeting, per business. Mirrors scheduling_bookings_no_overlap for the table that actually holds slots, and must stay in step with holdsSlot() and MEETING_HOLDS_SLOT_FILTER. Needed because a package is one booking with no time of its own, which the bookings constraint skips. A 23P01 from this means the hour went between the check and the write — tell the client it has gone, do not report a fault.';

COMMENT ON COLUMN public.scheduling_meetings.meeting_status IS
  'The meeting''s own outcome: held, no_show, cancelled, or moved. NULL means nobody has said yet, which is the normal state of a future appointment and reads as HOLDING its hour. `moved` is system-written by syncMeeting on the attempt a reschedule supersedes, and frees the hour; it is distinct from cancelled so that a reschedule is never counted as a lost client.';

COMMIT;
