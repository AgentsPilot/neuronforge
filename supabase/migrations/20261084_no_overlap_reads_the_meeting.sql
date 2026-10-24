/*
 * The hour a cancelled meeting gave back is actually free.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO LAYERS DISAGREEING ABOUT ONE HOUR
 *
 * `scheduling_bookings_no_overlap` (20261001) decides what is taken from
 * `status` alone:
 *
 *     WHERE status IN ('confirmed', 'pending', 'completed')
 *
 * That was the whole truth while every meeting outcome overwrote the job's
 * status: marking a no-show wrote `status = 'no_show'`, which is absent from
 * that list, and the slot was released as a side effect.
 *
 * The meetings module ended that. Held, no-show and cancelled now write
 * `meeting_status` and leave `status` alone — deliberately, because calling off
 * an appointment is not calling off the work. The application layer was taught
 * the new rule (`holdsSlot` and `MEETING_HOLDS_SLOT_FILTER` in
 * `lib/business-os/bookingStatus.ts`, and `busyMeetings()`), and this constraint
 * was not.
 *
 * So the two now contradict each other on exactly one case, and it is a case
 * clients hit:
 *
 *   · the public calendar offers the hour, because the meeting is cancelled
 *   · the insert is refused with 23P01, because the booking is still confirmed
 *
 * The client picks a time and is told it has gone. The owner cannot rebook it
 * either, and nothing on screen explains why.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SAME SENTENCE AS `holdsSlot`
 *
 * Written as `IS NULL OR = 'held'` rather than `NOT IN ('no_show','cancelled')`
 * for the reason `MEETING_HOLDS_SLOT_FILTER` records: `NULL NOT IN (…)` is NULL
 * in SQL, not true, so the negated form would drop every unmarked meeting —
 * which is nearly all of them — and free slots that are genuinely taken.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SAFE TO VALIDATE
 *
 * The new predicate is strictly NARROWER than the old one: it adds a condition,
 * so fewer rows participate. Every pair the current constraint permits, the new
 * one permits too, and it cannot fail on data already in the table.
 *
 * Dropping and adding a GiST exclusion constraint takes an ACCESS EXCLUSIVE
 * lock for the length of the rebuild. On a booking table this is milliseconds,
 * and it is one statement inside one transaction, so there is no window in
 * which the table is unprotected.
 *
 * Plan: docs/workplans/BOOKING_MEETINGS_TABLE_PLAN.md
 * ─────────────────────────────────────────────────────────────────────────────
 */

BEGIN;

ALTER TABLE public.scheduling_bookings
  DROP CONSTRAINT IF EXISTS scheduling_bookings_no_overlap;

ALTER TABLE public.scheduling_bookings
  ADD CONSTRAINT scheduling_bookings_no_overlap
  EXCLUDE USING gist (
    user_id WITH =,
    tstzrange(start_time, end_time) WITH &&
  )
  WHERE (
    status IN ('confirmed', 'pending', 'completed')
    /* The meeting's own answer, matching `holdsSlot`. An appointment that was
       missed or called off does not hold its time, whatever the job says. */
    AND (meeting_status IS NULL OR meeting_status = 'held')
    AND start_time IS NOT NULL
    AND end_time IS NOT NULL
    AND end_time > start_time
  );

COMMENT ON CONSTRAINT scheduling_bookings_no_overlap ON public.scheduling_bookings IS
  'One slot, one booking, per business. Covers SLOT_HOLDING_STATUSES whose meeting has not been missed or called off — the same rule as holdsSlot() and MEETING_HOLDS_SLOT_FILTER, which this must stay in step with. Skips bookings with no times (products) and any inverted range. A 23P01 from this means the slot was taken between the check and the write — tell the client it has gone, do not report a fault.';

COMMIT;
