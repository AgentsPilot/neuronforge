/*
 * Calling off a job calls off the meetings it had not yet held.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NEEDED BEFORE ANY READER MOVES
 *
 * `scheduling_meetings` knows what happened at an appointment. It does NOT know
 * whether the job around it was called off — that lives on the booking, in
 * `status`, `cancel_reason` and `cancelled_by`.
 *
 * So "is this slot free" cannot be answered from the meetings table alone. A
 * parity check against live data found 58 bookings where the two tables
 * disagree, every one the same shape: the job is cancelled, the meeting is
 * unmarked, and the meeting therefore still looks like it occupies its time.
 *
 * Two ways to fix that. Join meetings to bookings on every availability query —
 * a join on the hottest read in the product, forever. Or record the
 * consequence once, where it happened. This is the second.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONLY THE MEETINGS THAT HAD NOT HAPPENED
 *
 * `meeting_status IS NULL` — nobody had said what happened yet, and now it
 * never will.
 *
 * A HELD meeting is NOT touched. The consultation took place; calling off the
 * work afterwards does not un-happen it, and that fact is the one this whole
 * separation exists to protect. The same for a recorded no-show: the client
 * did not turn up, and the job being cancelled later does not change that
 * either.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "CALLED OFF" IS THE FULL UNION, NOT JUST THE STATUS
 *
 * `SchedulingRepository.cancel` preserves a recorded attendance, so a booking
 * cancelled after its meeting was marked keeps `status = 'completed'` and
 * records the cancellation in `cancel_reason` / `cancelled_by`. Testing the
 * status alone would miss exactly those — which are the rows this separation
 * was built for. Same union as `jobCalledOff()`.
 *
 * Plan: docs/workplans/BOOKING_MEETINGS_TABLE_PLAN.md (Phase 3, prerequisite)
 * ─────────────────────────────────────────────────────────────────────────────
 */

BEGIN;

UPDATE public.scheduling_meetings m
   SET meeting_status = 'cancelled',
       updated_at = now()
  FROM public.scheduling_bookings b
 WHERE b.id = m.booking_id
   /* The job is off, by any of the three signals that say so. */
   AND (
     b.status = 'cancelled'
     OR b.cancel_reason IS NOT NULL
     OR b.cancelled_by IS NOT NULL
   )
   /* Only what had not already happened. Held and no-show are history. */
   AND m.meeting_status IS NULL;

COMMIT;
