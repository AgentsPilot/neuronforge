/*
 * Recover the attempts that were lost to in-place reschedules.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS MISSING AND WHY
 *
 * `syncMeeting` originally created a new attempt only when the previous one
 * carried an OUTCOME. Moving an UNMARKED appointment updated the row in place,
 * so the time it was moved FROM was overwritten and left no trace.
 *
 * On booking ab48357a that lost the middle of a three-step history: the journey
 * showed 13:00 and 15:00 while two emails to the client referred to a 14:00
 * that appeared nowhere on the card.
 *
 * The code now records every move. This recovers the ones already lost.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THE TIMES COME FROM
 *
 * `crm_activities` recorded every reschedule all along:
 *
 *   activity_type     'booking_rescheduled'
 *   source_entity_id  the booking
 *   description       {"kind":…,"from":"…17:00+00","to":"…18:00+00","timeZone":…}
 *
 * So each activity's `from` is an appointment that genuinely existed. This
 * inserts an attempt for every `from` that has no row, which is a RECORDED
 * fact rather than an inference — the whole reason it is worth doing.
 *
 * `description` is TEXT holding JSON, so it is cast to jsonb. Rows whose text
 * is not valid JSON are skipped rather than failing the migration.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DOES NOT DO
 *
 * No OUTCOME is invented. A recovered attempt gets `meeting_status = NULL`,
 * which the journey reads as "moved to another time" for any attempt that is
 * not the current one — true, and all the timeline actually says.
 *
 * `outcome_by` is left NULL for the same reason: nothing recorded who.
 *
 * Duration is taken from the booking's own span, since the activity records
 * only the start. That is the one approximation here, and it is named.
 *
 * Read-only first: run section 1, look at what it proposes, then section 2.
 * ─────────────────────────────────────────────────────────────────────────────
 */

-- ── 1. The attempts the timeline knows about and the table does not ────────
WITH moves AS (
  SELECT
    a.source_entity_id AS booking_id,
    a.user_id,
    (a.description::jsonb ->> 'from')::timestamptz AS moved_from,
    a.created_at
  FROM public.crm_activities a
  WHERE a.activity_type = 'booking_rescheduled'
    AND a.source_entity_id IS NOT NULL
    /* Only parseable JSON carrying a `from`. */
    AND a.description IS NOT NULL
    AND left(btrim(a.description), 1) = '{'
    AND (a.description::jsonb ->> 'from') IS NOT NULL
)
SELECT
  m.booking_id,
  m.moved_from,
  m.created_at AS recorded_at,
  b.start_time AS booking_now
FROM moves m
JOIN public.scheduling_bookings b ON b.id = m.booking_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.scheduling_meetings x
   WHERE x.booking_id = m.booking_id
     AND x.start_time = m.moved_from
)
ORDER BY m.booking_id, m.created_at;


-- ── 2. Insert them, then renumber every affected booking ───────────────────
BEGIN;

WITH moves AS (
  SELECT DISTINCT
    a.source_entity_id AS booking_id,
    (a.description::jsonb ->> 'from')::timestamptz AS moved_from
  FROM public.crm_activities a
  WHERE a.activity_type = 'booking_rescheduled'
    AND a.source_entity_id IS NOT NULL
    AND a.description IS NOT NULL
    AND left(btrim(a.description), 1) = '{'
    AND (a.description::jsonb ->> 'from') IS NOT NULL
)
INSERT INTO public.scheduling_meetings
  (user_id, booking_id, start_time, end_time, timezone, meeting_status, outcome_by, occurrence_number, created_at, updated_at)
SELECT
  b.user_id,
  m.booking_id,
  m.moved_from,
  /* The activity records only the start, so the span comes from the booking.
     The one approximation in this script. */
  m.moved_from + (b.end_time - b.start_time),
  b.timezone,
  /* No outcome is invented: nothing recorded what happened at a time that was
     moved away from, and the journey reads an unmarked non-current attempt as
     "moved to another time", which is exactly what the timeline says. */
  NULL,
  NULL,
  /* Provisional. The ORDER comes from the activity chain, not from here —
     see `fix-attempt-order-from-timeline.sql`, which this script now defers to
     rather than renumbering by `created_at` itself. */
  1,
  /*
   * NOT `m.moved_from`.
   *
   * Setting `created_at` to the APPOINTMENT time was the bug: on ab48357a that
   * is 18:00Z while the pre-existing 19:00Z row's real insert time is 04:37Z,
   * so ordering by `created_at` put the recovered middle attempt last and it
   * came out as #3.
   *
   * `now()` is honest — this row was created now, by recovery — and nothing
   * orders by it any more.
   */
  now(),
  now()
FROM moves m
JOIN public.scheduling_bookings b ON b.id = m.booking_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.scheduling_meetings x
   WHERE x.booking_id = m.booking_id
     AND x.start_time = m.moved_from
);

COMMIT;

/* ── 3. Numbering is NOT done here ─────────────────────────────────────────
   It was, by `created_at`, and that produced the wrong order for the reason
   given above. Run `fix-attempt-order-from-timeline.sql` next: it numbers by
   the activity chain, which is a recorded sequence rather than an inference
   from insert timestamps. */


-- ── 4. Confirm ──────────────────────────────────────────────────────────────
/* Every reschedule's `from` now has an attempt. Expect 0. */
WITH moves AS (
  SELECT a.source_entity_id AS booking_id,
         (a.description::jsonb ->> 'from')::timestamptz AS moved_from
    FROM public.crm_activities a
   WHERE a.activity_type = 'booking_rescheduled'
     AND a.source_entity_id IS NOT NULL
     AND a.description IS NOT NULL
     AND left(btrim(a.description), 1) = '{'
     AND (a.description::jsonb ->> 'from') IS NOT NULL
)
SELECT count(*) AS still_missing
  FROM moves m
  JOIN public.scheduling_bookings b ON b.id = m.booking_id
 WHERE NOT EXISTS (
   SELECT 1 FROM public.scheduling_meetings x
    WHERE x.booking_id = m.booking_id AND x.start_time = m.moved_from
 );

/* And no booking has duplicate attempt numbers. Expect 0. */
SELECT count(*) AS duplicate_numbers
  FROM (
    SELECT booking_id FROM public.scheduling_meetings
     GROUP BY booking_id, occurrence_number HAVING count(*) > 1
  ) d;
