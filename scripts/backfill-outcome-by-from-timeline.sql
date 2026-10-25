/*
 * Recover who recorded an outcome, from the timeline.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS MISSING
 *
 * `20261078` added `outcome_by` and deliberately backfilled CANCELLED meetings
 * only. Held and no-show were left NULL, on the reasoning that the owner's
 * drawer is not the only writer — `LeadResponseDispatchService` completes a
 * booking when a lead replies, and the plugin executor marks outcomes for an
 * agent — so writing `owner` across the board would put a guess in a column the
 * journey presents as a record.
 *
 * That reasoning still holds in general. What it missed is that the timeline
 * distinguishes them: `crm_activities` rows of type `booking_no_show` and
 * `booking_completed` are written by the OWNER-FACING routes, naming the
 * booking in `source_entity_id`. An attempt whose outcome has such a row was
 * recorded by a person operating the business — that is a record, not a guess.
 *
 * The visible cost of leaving it: on booking ab48357a the 13:00 attempt shows
 * "לא הגיע" with no icon beside it while the 15:00 attempt shows one, so the
 * card appears to know who answered one and not the other when both were the
 * same owner.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STILL NOT GUESSED WHERE IT IS NOT KNOWN
 *
 * An attempt with an outcome and NO corresponding activity keeps `NULL`. That
 * is the automated paths, which write no CRM activity — exactly the case
 * `20261078` refused to assume about, and it is still refused here.
 *
 * Matched on the booking and a time window around the attempt's own period, so
 * an activity cannot be credited to an attempt it was not about.
 *
 * Read-only first: run section 1.
 * ─────────────────────────────────────────────────────────────────────────────
 */

CREATE TEMPORARY VIEW owner_recorded AS
SELECT
  m.id                AS meeting_id,
  m.booking_id,
  m.occurrence_number,
  m.meeting_status,
  a.activity_type,
  a.created_at        AS recorded_at
FROM public.scheduling_meetings m
JOIN public.crm_activities a
  ON a.source_entity_id = m.booking_id
 AND a.activity_type = CASE m.meeting_status
                         WHEN 'no_show' THEN 'booking_no_show'
                         WHEN 'held'    THEN 'booking_completed'
                       END
WHERE m.outcome_by IS NULL
  AND m.meeting_status IN ('no_show', 'held')
  /*
   * The activity has to belong to THIS attempt. An outcome is recorded after
   * the appointment's start, and before the booking moved on from it — a
   * generous day either side, since an owner often marks attendance the next
   * morning.
   */
  AND a.created_at >= m.start_time - interval '1 day'
  AND a.created_at <= m.start_time + interval '2 days';


-- ── 1. What would be credited to the owner ─────────────────────────────────
SELECT
  o.booking_id,
  o.occurrence_number,
  o.meeting_status,
  o.activity_type,
  o.recorded_at
FROM owner_recorded o
ORDER BY o.booking_id, o.occurrence_number;

/* And what stays NULL: an outcome nothing in the timeline accounts for, which
   is how an automated write looks. */
SELECT count(*) AS left_unknown
  FROM public.scheduling_meetings m
 WHERE m.outcome_by IS NULL
   AND m.meeting_status IN ('no_show', 'held')
   AND NOT EXISTS (SELECT 1 FROM owner_recorded o WHERE o.meeting_id = m.id);


-- ── 2. The repair ───────────────────────────────────────────────────────────
BEGIN;

UPDATE public.scheduling_meetings m
   SET outcome_by = 'owner',
       updated_at = now()
  FROM owner_recorded o
 WHERE o.meeting_id = m.id
   AND m.outcome_by IS NULL;

/* The booking's own copy, which describes its current attempt. */
UPDATE public.scheduling_bookings b
   SET outcome_by = 'owner',
       updated_at = now()
 WHERE b.outcome_by IS NULL
   AND b.meeting_status IN ('no_show', 'held')
   AND EXISTS (
     SELECT 1 FROM public.scheduling_meetings m
      WHERE m.booking_id = b.id
        AND m.outcome_by = 'owner'
        AND m.occurrence_number = (
          SELECT max(x.occurrence_number) FROM public.scheduling_meetings x
           WHERE x.booking_id = b.id
        )
   );

COMMIT;


-- ── 3. Confirm ──────────────────────────────────────────────────────────────
/* Every value is one the column allows. Expect 0. */
SELECT count(*) AS invalid_values
  FROM public.scheduling_meetings
 WHERE outcome_by IS NOT NULL
   AND outcome_by NOT IN ('owner', 'client', 'system');

/* How many attempts can now say who answered. */
SELECT
  count(*) FILTER (WHERE outcome_by IS NOT NULL) AS attributed,
  count(*) FILTER (WHERE outcome_by IS NULL AND meeting_status IS NOT NULL) AS still_unknown
FROM public.scheduling_meetings;

DROP VIEW owner_recorded;
