/*
 * Tie each email to the appointment that was current when it was sent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THEY ARE ALL ON THE WRONG ONE
 *
 * `resolveMeetingId` attaches an email to the LATEST attempt at the moment of
 * sending, which is right. But while `syncMeeting` moved an unmarked
 * appointment IN PLACE, one row held several different times in succession — so
 * every email sent across those moves points at the same row, and that row now
 * shows the final time.
 *
 * On booking ab48357a all three emails sit under the 15:00 attempt, including
 * the notice that announced the move to 14:00 and a confirmation resent while
 * 14:00 was the appointment. The owner sees mail about 14:00 filed under 15:00.
 *
 * Every move now creates its own attempt, so `resolveMeetingId` is correct from
 * here. This repairs what the old rule mis-filed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW "WHICH ONE WAS CURRENT" IS KNOWN
 *
 * `crm_activities` recorded each move as `from` → `to` against
 * `source_entity_id`. So:
 *
 *   - the attempt matching the FIRST move's `from` became current when the
 *     booking was created;
 *   - every other attempt became current at the `created_at` of the move whose
 *     `to` is its time.
 *
 * An email then belongs to the attempt with the latest "became current" at or
 * before the email was sent. That is a recorded sequence, not a guess from
 * proximity — which is the whole reason `meeting_id` exists rather than the
 * time-window heuristic the journey used to rely on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONLY EMAILS THAT ALREADY CARRY A BOOKING
 *
 * `booking_id IS NOT NULL`, so nothing predating 20261077 is touched: those
 * have no recorded link and the journey falls back to its heuristic for them.
 * Nothing here invents an attribution where none was stored.
 *
 * Read-only first: run section 1 and compare `now_on` with `should_be_on`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

CREATE TEMPORARY VIEW attempt_became_current AS
WITH moves AS (
  SELECT
    a.source_entity_id AS booking_id,
    (a.description::jsonb ->> 'from')::timestamptz AS moved_from,
    (a.description::jsonb ->> 'to')::timestamptz   AS moved_to,
    a.created_at,
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
/* The appointment the booking started on: current from the booking's creation. */
SELECT
  m.booking_id,
  mt.id          AS meeting_id,
  b.created_at   AS became_current
FROM moves m
JOIN public.scheduling_bookings b  ON b.id = m.booking_id
JOIN public.scheduling_meetings mt ON mt.booking_id = m.booking_id
                                  AND mt.start_time = m.moved_from
WHERE m.move_seq = 1

UNION

/* And each later appointment: current from the move that produced it. */
SELECT
  m.booking_id,
  mt.id        AS meeting_id,
  m.created_at AS became_current
FROM moves m
JOIN public.scheduling_meetings mt ON mt.booking_id = m.booking_id
                                  AND mt.start_time = m.moved_to;


-- ── 1. What each email is on, and what it should be on ─────────────────────
SELECT
  e.id,
  left(e.subject, 42)                      AS subject,
  coalesce(e.sent_at, e.created_at)        AS went_out,
  (SELECT mt.start_time FROM public.scheduling_meetings mt WHERE mt.id = e.meeting_id) AS now_on,
  (SELECT mt.start_time
     FROM attempt_became_current c
     JOIN public.scheduling_meetings mt ON mt.id = c.meeting_id
    WHERE c.booking_id = e.booking_id
      AND c.became_current <= coalesce(e.sent_at, e.created_at)
    ORDER BY c.became_current DESC
    LIMIT 1)                               AS should_be_on
FROM public.email_sends e
WHERE e.booking_id IS NOT NULL
  AND e.booking_id IN (SELECT DISTINCT booking_id FROM attempt_became_current)
ORDER BY e.booking_id, went_out;


-- ── 2. The repair ───────────────────────────────────────────────────────────
BEGIN;

WITH correct AS (
  SELECT
    e.id AS email_id,
    (SELECT c.meeting_id
       FROM attempt_became_current c
      WHERE c.booking_id = e.booking_id
        AND c.became_current <= coalesce(e.sent_at, e.created_at)
      ORDER BY c.became_current DESC
      LIMIT 1) AS meeting_id
  FROM public.email_sends e
  WHERE e.booking_id IS NOT NULL
    AND e.booking_id IN (SELECT DISTINCT booking_id FROM attempt_became_current)
)
UPDATE public.email_sends e
   SET meeting_id = c.meeting_id
  FROM correct c
 WHERE c.email_id = e.id
   /* Never blank an existing link: an email sent before the first attempt
      became current has no better answer than the one it already has. */
   AND c.meeting_id IS NOT NULL
   AND e.meeting_id IS DISTINCT FROM c.meeting_id;

COMMIT;


-- ── 3. Confirm ──────────────────────────────────────────────────────────────
/* No email is filed on an attempt that became current AFTER it was sent.
   Expect 0. */
SELECT count(*) AS filed_on_a_later_attempt
  FROM public.email_sends e
  JOIN attempt_became_current c
    ON c.meeting_id = e.meeting_id
   AND c.booking_id = e.booking_id
 WHERE e.booking_id IS NOT NULL
   AND c.became_current > coalesce(e.sent_at, e.created_at);

/* And every linked email still names a meeting of its own booking. Expect 0. */
SELECT count(*) AS cross_booking
  FROM public.email_sends e
  JOIN public.scheduling_meetings m ON m.id = e.meeting_id
 WHERE e.booking_id IS NOT NULL
   AND m.booking_id IS DISTINCT FROM e.booking_id;

DROP VIEW attempt_became_current;
