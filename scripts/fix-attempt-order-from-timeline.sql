/*
 * Number attempts by the order they were actually arranged in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `created_at` CANNOT ORDER THEM
 *
 * `backfill-attempts-from-timeline.sql` recovered the lost attempts and then
 * renumbered by `created_at`. That was wrong twice over:
 *
 *   - The recovered rows were given `created_at = moved_from`, the APPOINTMENT
 *     time. On booking ab48357a that is 18:00Z, while the pre-existing 19:00Z
 *     row's real `created_at` is 04:37Z — so the recovered middle attempt
 *     sorted AFTER the current one and came out as #3.
 *
 *   - Even without that, a row's `created_at` records when it was inserted, not
 *     when it became the time it now holds. A row updated in place keeps its
 *     original insert time, so it cannot say where it belongs in the sequence.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CHAIN IS THE ORDER
 *
 * `crm_activities` records each move as `from` → `to`, in time order. So the
 * sequence of times is: the `from` of the earliest move, then each `to` in the
 * order the moves happened.
 *
 *   04:37  17:00Z → 18:00Z
 *   05:28  18:00Z → 19:00Z     gives  17:00Z, 18:00Z, 19:00Z
 *
 * That is a recorded chain, not an inference from timestamps. Attempts are
 * numbered by their position in it.
 *
 * An attempt whose time appears NOWHERE in the chain — a booking never
 * rescheduled, or a package child — keeps its place by `start_time` AFTER the
 * chained ones. Those bookings have no chain at all, so they are untouched.
 *
 * Read-only first: run section 1 and compare `numbered` with `should_be`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

-- ── The chain, per booking ──────────────────────────────────────────────────
CREATE TEMPORARY VIEW attempt_chain AS
WITH moves AS (
  SELECT
    a.source_entity_id AS booking_id,
    (a.description::jsonb ->> 'from')::timestamptz AS moved_from,
    (a.description::jsonb ->> 'to')::timestamptz   AS moved_to,
    row_number() OVER (
      PARTITION BY a.source_entity_id ORDER BY a.created_at
    ) AS move_seq
  FROM public.crm_activities a
  WHERE a.activity_type = 'booking_rescheduled'
    AND a.source_entity_id IS NOT NULL
    AND a.description IS NOT NULL
    AND left(btrim(a.description), 1) = '{'
    AND (a.description::jsonb ->> 'from') IS NOT NULL
    AND (a.description::jsonb ->> 'to') IS NOT NULL
)
/* Position 0 is where the booking started; each move adds the time it moved TO. */
SELECT booking_id, moved_from AS at_time, 0 AS pos
  FROM moves
 WHERE move_seq = 1
UNION
SELECT booking_id, moved_to AS at_time, move_seq AS pos
  FROM moves;


-- ── 1. What the numbering is, and what it should be ────────────────────────
SELECT
  m.booking_id,
  m.occurrence_number AS numbered,
  m.start_time,
  m.meeting_status,
  row_number() OVER (
    PARTITION BY m.booking_id
    /* Chained times first, in chain order; anything unchained after, by time. */
    ORDER BY c.pos NULLS LAST, m.start_time
  ) AS should_be
FROM public.scheduling_meetings m
LEFT JOIN attempt_chain c
       ON c.booking_id = m.booking_id
      AND c.at_time = m.start_time
WHERE m.booking_id IN (SELECT DISTINCT booking_id FROM attempt_chain)
ORDER BY m.booking_id, should_be;


-- ── 2. The repair ───────────────────────────────────────────────────────────
BEGIN;

WITH ordered AS (
  SELECT
    m.id,
    row_number() OVER (
      PARTITION BY m.booking_id
      ORDER BY c.pos NULLS LAST, m.start_time
    ) AS n
  FROM public.scheduling_meetings m
  LEFT JOIN attempt_chain c
         ON c.booking_id = m.booking_id
        AND c.at_time = m.start_time
  WHERE m.booking_id IN (SELECT DISTINCT booking_id FROM attempt_chain)
)
UPDATE public.scheduling_meetings m
   SET occurrence_number = o.n,
       updated_at = now()
  FROM ordered o
 WHERE o.id = m.id
   AND m.occurrence_number IS DISTINCT FROM o.n;

COMMIT;


-- ── 3. Confirm ──────────────────────────────────────────────────────────────
/* The newest attempt must be the booking's CURRENT time — that is what the
   journey calls "current", and the whole point of the ordering. Expect 0. */
SELECT count(*) AS newest_is_not_the_current_time
  FROM public.scheduling_bookings b
  JOIN public.scheduling_meetings m ON m.booking_id = b.id
 WHERE m.occurrence_number = (
         SELECT max(x.occurrence_number) FROM public.scheduling_meetings x
          WHERE x.booking_id = b.id
       )
   AND b.start_time IS NOT NULL
   AND m.start_time <> b.start_time
   AND b.id IN (SELECT DISTINCT booking_id FROM attempt_chain);

/* And no duplicates anywhere. Expect 0. */
SELECT count(*) AS duplicate_numbers
  FROM (
    SELECT booking_id FROM public.scheduling_meetings
     GROUP BY booking_id, occurrence_number HAVING count(*) > 1
  ) d;

DROP VIEW attempt_chain;
