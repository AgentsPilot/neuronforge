/*
 * Renumber attempts that were reset to 1.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * `syncMeeting` built its row from the booking, including
 * `occurrence_number: booking.occurrence_number ?? 1`. That is correct for a
 * package CHILD booking, where the number says which session of the package the
 * meeting is. On an ordinary booking that column is NULL, so the fallback is 1 —
 * and because the row was written on every UPDATE as well as every insert, an
 * ordinary reschedule renumbered the attempt back to 1.
 *
 * Booking ab48357a ended up with two attempts both numbered 1. `listAttempts`
 * orders by that column, so the journey's history had no stable order and "the
 * current attempt" — the last row — could resolve to the OLDER appointment.
 * Which is why a reschedule looked like it had not refreshed the drawer.
 *
 * The code fix leaves `occurrence_number` out of the update payload entirely:
 * the number belongs to the attempt, and only the insert sets it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW THE CORRECT NUMBER IS RECOVERED
 *
 * By `created_at`: attempts are inserted in the order they were arranged, so
 * the row that was created first is attempt 1. That is more reliable here than
 * `start_time`, because a reschedule can move an appointment EARLIER — a client
 * who misses Monday and rebooks for Sunday would otherwise be renumbered into
 * the wrong order.
 *
 * ONLY bookings whose numbers are actually broken: a duplicate within one
 * booking. A package's children are numbered from the booking on purpose and
 * are left alone, and so is every booking with a single attempt.
 *
 * Read-only first. Run the SELECT, look at what it names, then the UPDATE.
 * ─────────────────────────────────────────────────────────────────────────────
 */

-- ── 1. Which bookings have duplicate attempt numbers ───────────────────────
WITH broken AS (
  SELECT booking_id
    FROM public.scheduling_meetings
   GROUP BY booking_id, occurrence_number
  HAVING count(*) > 1
)
SELECT
  m.booking_id,
  m.occurrence_number AS numbered,
  m.start_time,
  m.meeting_status,
  m.created_at,
  row_number() OVER (PARTITION BY m.booking_id ORDER BY m.created_at, m.start_time) AS should_be
FROM public.scheduling_meetings m
WHERE m.booking_id IN (SELECT booking_id FROM broken)
ORDER BY m.booking_id, m.created_at;


-- ── 2. The repair ───────────────────────────────────────────────────────────
BEGIN;

WITH broken AS (
  SELECT booking_id
    FROM public.scheduling_meetings
   GROUP BY booking_id, occurrence_number
  HAVING count(*) > 1
),
renumbered AS (
  SELECT
    m.id,
    row_number() OVER (PARTITION BY m.booking_id ORDER BY m.created_at, m.start_time) AS n
  FROM public.scheduling_meetings m
  WHERE m.booking_id IN (SELECT booking_id FROM broken)
)
UPDATE public.scheduling_meetings m
   SET occurrence_number = r.n,
       updated_at = now()
  FROM renumbered r
 WHERE r.id = m.id
   AND m.occurrence_number IS DISTINCT FROM r.n;

COMMIT;


-- ── 3. Confirm ──────────────────────────────────────────────────────────────
/* Expect 0. Every booking's attempts are numbered 1..n with no repeats. */
SELECT count(*) AS bookings_with_duplicate_numbers
  FROM (
    SELECT booking_id
      FROM public.scheduling_meetings
     GROUP BY booking_id, occurrence_number
    HAVING count(*) > 1
  ) dupes;
