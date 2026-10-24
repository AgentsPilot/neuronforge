/*
 * Repair appointments that were moved after an outcome and kept it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * Four places write `scheduling_bookings.start_time`, and only one of them —
 * `rescheduleBooking` — was taught to clear `meeting_status` when an
 * appointment moves. The owner rescheduled through another: the route whose own
 * comment says it "writes `start_time` itself instead of calling
 * `rescheduleBooking`".
 *
 * So the booking arrived at its new time still marked `no_show`, and
 * `syncMeeting` copied that onto the newly created attempt as well.
 *
 * THE CONSEQUENCE IS NOT COSMETIC. `MEETING_HOLDS_SLOT_FILTER` reads a no-show
 * as free time, so the hour a client had just been given was not held — and
 * availability would have offered it to somebody else.
 *
 * The code fix is in `SchedulingBookingRepository.update()`, which now clears
 * the outcome for EVERY caller that moves a time, and in `syncMeeting`, which
 * never writes a settled outcome onto a new attempt. This repairs the rows
 * written before those landed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT TOUCHES, AND WHAT IT CAREFULLY DOES NOT
 *
 * Only the LATEST attempt of a booking, and only when a later attempt exists —
 * that is the signature of "this was rescheduled after somebody answered". The
 * earlier attempts keep their outcomes: those appointments really were missed,
 * and that history is the whole point of the meetings table.
 *
 * A booking with ONE attempt is never touched. A single no-show that was never
 * rescheduled is a correct record, not a fault.
 *
 * Read-only first: run the SELECT, look at what it names, then the UPDATEs.
 * ─────────────────────────────────────────────────────────────────────────────
 */

-- ── 1. What will change ─────────────────────────────────────────────────────
SELECT
  b.id                AS booking_id,
  b.status            AS job_status,
  b.meeting_status    AS booking_outcome,
  m.occurrence_number AS latest_attempt,
  m.start_time        AS latest_attempt_time,
  m.meeting_status    AS latest_attempt_outcome,
  (SELECT count(*) FROM public.scheduling_meetings x WHERE x.booking_id = b.id) AS attempts
FROM public.scheduling_bookings b
JOIN public.scheduling_meetings m ON m.booking_id = b.id
WHERE
  /* The latest attempt only. */
  m.occurrence_number = (
    SELECT max(x.occurrence_number) FROM public.scheduling_meetings x WHERE x.booking_id = b.id
  )
  /* And there is more than one, so the booking really was rescheduled. */
  AND (SELECT count(*) FROM public.scheduling_meetings x WHERE x.booking_id = b.id) > 1
  /* Carrying an outcome it should not have. */
  AND m.meeting_status IS NOT NULL
  /* And the job itself is still running — a cancelled job's meetings are
     correctly `cancelled`, which 20261075 put there on purpose. */
  AND b.status <> 'cancelled'
  AND b.cancel_reason IS NULL
  AND b.cancelled_by IS NULL
ORDER BY m.start_time DESC;


-- ── 2. The repair ───────────────────────────────────────────────────────────
BEGIN;

/* The newest attempt has not happened yet. */
UPDATE public.scheduling_meetings m
   SET meeting_status = NULL,
       updated_at = now()
  FROM public.scheduling_bookings b
 WHERE b.id = m.booking_id
   AND m.occurrence_number = (
     SELECT max(x.occurrence_number) FROM public.scheduling_meetings x WHERE x.booking_id = b.id
   )
   AND (SELECT count(*) FROM public.scheduling_meetings x WHERE x.booking_id = b.id) > 1
   AND m.meeting_status IS NOT NULL
   AND b.status <> 'cancelled'
   AND b.cancel_reason IS NULL
   AND b.cancelled_by IS NULL;

/* And the booking's own column, which describes that newest attempt. */
UPDATE public.scheduling_bookings b
   SET meeting_status = NULL,
       updated_at = now()
 WHERE (SELECT count(*) FROM public.scheduling_meetings x WHERE x.booking_id = b.id) > 1
   AND b.meeting_status IS NOT NULL
   AND b.status <> 'cancelled'
   AND b.cancel_reason IS NULL
   AND b.cancelled_by IS NULL
   /* Only where the latest attempt is now unmarked, so this cannot run ahead
      of the statement above and clear a booking whose meeting really is off. */
   AND NOT EXISTS (
     SELECT 1 FROM public.scheduling_meetings m
      WHERE m.booking_id = b.id
        AND m.occurrence_number = (
          SELECT max(x.occurrence_number) FROM public.scheduling_meetings x WHERE x.booking_id = b.id
        )
        AND m.meeting_status IS NOT NULL
   );

COMMIT;


-- ── 3. Confirm ──────────────────────────────────────────────────────────────
/* Expect 0 rows. Earlier attempts keep their outcomes; only the newest is clear. */
SELECT count(*) AS still_wrong
  FROM public.scheduling_bookings b
  JOIN public.scheduling_meetings m ON m.booking_id = b.id
 WHERE m.occurrence_number = (
         SELECT max(x.occurrence_number) FROM public.scheduling_meetings x WHERE x.booking_id = b.id
       )
   AND (SELECT count(*) FROM public.scheduling_meetings x WHERE x.booking_id = b.id) > 1
   AND m.meeting_status IS NOT NULL
   AND b.status <> 'cancelled'
   AND b.cancel_reason IS NULL
   AND b.cancelled_by IS NULL;
