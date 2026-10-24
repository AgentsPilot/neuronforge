/*
 * Recompute `outcome_at` by the attempt that was CURRENT when it was recorded.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG, AND IT WAS WRITTEN BY 20261080
 *
 * That migration matched a `booking_no_show` / `booking_completed` activity to
 * an attempt by a window around the attempt's START — a day before, two days
 * after. On a booking rescheduled within one day, every attempt is inside every
 * window, so each activity matched several attempts and the update kept
 * whichever row the join happened to produce.
 *
 * Booking ab48357a came out with attempt #1 and attempt #3 both stamped
 * 02:00:00, when #3 was marked at 05:45:35. The rail then shows a no-show
 * recorded hours before the appointment it belongs to even existed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WINDOW IS THE ATTEMPT'S OWN LIFE, NOT A GUESS AROUND ITS START
 *
 * An outcome is recorded while its attempt is the current one. An attempt
 * becomes current when the booking is created (the first) or when a move
 * produces it, and stops when the next move happens — all recorded in
 * `crm_activities` as `from` → `to` pairs.
 *
 *   #1  current 01:49:03 → 04:37:32   contains the 02:00:00 no-show
 *   #2  current 04:37:32 → 05:28:00   contains nothing; stays NULL
 *   #3  current 05:28:00 → now        contains the 05:45:35 no-show
 *
 * The same rule `fix-email-attempt-attribution.sql` uses for mail, which is
 * the point: one definition of "which attempt was live then".
 *
 * Overwrites rather than filling gaps, because the existing values are the ones
 * being corrected. Attempts with no activity in their window are set back to
 * NULL — an honest blank beats a wrong timestamp.
 *
 * Read-only first: run section 1 and compare `stamped_now` with `should_be`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

CREATE TEMPORARY VIEW attempt_window AS
WITH moves AS (
  SELECT
    a.source_entity_id AS booking_id,
    (a.description::jsonb ->> 'from')::timestamptz AS moved_from,
    (a.description::jsonb ->> 'to')::timestamptz   AS moved_to,
    a.created_at,
    row_number() OVER (PARTITION BY a.source_entity_id ORDER BY a.created_at) AS seq
  FROM public.crm_activities a
  JOIN public.scheduling_bookings sb ON sb.id = a.source_entity_id
  WHERE a.activity_type = 'booking_rescheduled'
    AND a.description IS NOT NULL
    AND left(btrim(a.description), 1) = '{'
    AND (a.description::jsonb ->> 'from') IS NOT NULL
    AND (a.description::jsonb ->> 'to') IS NOT NULL
),
became AS (
  /* The appointment the booking started on. */
  SELECT m.booking_id, mt.id AS meeting_id, b.created_at AS from_ts
    FROM moves m
    JOIN public.scheduling_bookings b  ON b.id = m.booking_id
    JOIN public.scheduling_meetings mt ON mt.booking_id = m.booking_id
                                      AND mt.start_time = m.moved_from
   WHERE m.seq = 1
  UNION
  /* And each later one, from the move that produced it. */
  SELECT m.booking_id, mt.id AS meeting_id, m.created_at AS from_ts
    FROM moves m
    JOIN public.scheduling_meetings mt ON mt.booking_id = m.booking_id
                                      AND mt.start_time = m.moved_to
)
SELECT
  booking_id,
  meeting_id,
  from_ts,
  /* Until the next attempt took over, or for ever if it is the latest. */
  lead(from_ts) OVER (PARTITION BY booking_id ORDER BY from_ts) AS until_ts
FROM became;


-- ── 1. What is stamped, and what it should be ──────────────────────────────
SELECT
  m.booking_id,
  m.occurrence_number,
  m.meeting_status,
  m.outcome_at AS stamped_now,
  (SELECT a.created_at
     FROM public.crm_activities a
    WHERE a.source_entity_id = m.booking_id
      AND a.activity_type = CASE m.meeting_status
                              WHEN 'no_show' THEN 'booking_no_show'
                              WHEN 'held'    THEN 'booking_completed'
                            END
      AND a.created_at >= w.from_ts
      AND (w.until_ts IS NULL OR a.created_at < w.until_ts)
    ORDER BY a.created_at
    LIMIT 1) AS should_be
FROM public.scheduling_meetings m
JOIN attempt_window w ON w.meeting_id = m.id
WHERE m.meeting_status IN ('no_show', 'held')
ORDER BY m.booking_id, m.occurrence_number;


-- ── 2. The repair ───────────────────────────────────────────────────────────
BEGIN;

UPDATE public.scheduling_meetings m
   SET outcome_at = (
         SELECT a.created_at
           FROM public.crm_activities a
          WHERE a.source_entity_id = m.booking_id
            AND a.activity_type = CASE m.meeting_status
                                    WHEN 'no_show' THEN 'booking_no_show'
                                    WHEN 'held'    THEN 'booking_completed'
                                  END
            AND a.created_at >= w.from_ts
            AND (w.until_ts IS NULL OR a.created_at < w.until_ts)
          ORDER BY a.created_at
          LIMIT 1
       ),
       updated_at = now()
  FROM attempt_window w
 WHERE w.meeting_id = m.id
   AND m.meeting_status IN ('no_show', 'held');

/* The booking's copy describes its CURRENT attempt. */
UPDATE public.scheduling_bookings b
   SET outcome_at = m.outcome_at,
       updated_at = now()
  FROM public.scheduling_meetings m
 WHERE m.booking_id = b.id
   AND m.occurrence_number = (
     SELECT max(x.occurrence_number) FROM public.scheduling_meetings x
      WHERE x.booking_id = b.id
   )
   AND b.outcome_at IS DISTINCT FROM m.outcome_at;

COMMIT;


-- ── 3. Confirm ──────────────────────────────────────────────────────────────
/* No two attempts of one booking share an outcome moment. Expect 0. */
SELECT count(*) AS shared_timestamps
  FROM (
    SELECT booking_id, outcome_at
      FROM public.scheduling_meetings
     WHERE outcome_at IS NOT NULL
     GROUP BY booking_id, outcome_at
    HAVING count(*) > 1
  ) d;

/* And none is stamped before its own appointment was arranged. Expect 0. */
SELECT count(*) AS recorded_before_it_existed
  FROM public.scheduling_meetings m
  JOIN attempt_window w ON w.meeting_id = m.id
 WHERE m.outcome_at IS NOT NULL
   AND m.outcome_at < w.from_ts;

DROP VIEW attempt_window;
