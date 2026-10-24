/*
 * WHEN an outcome was recorded, not only what it was.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE RAIL COULD NOT SAY
 *
 * An attempt carries `meeting_status` and now `outcome_by`, but no time. So a
 * row reads:
 *
 *   15:00 · לא הגיע
 *      ✉ הפגישה נקבעה מחדש · 01:28 · נשלח
 *      ✉ התגעגענו אליך     · 01:45 · נשלח
 *
 * One state, two emails, sent seventeen minutes apart — and nothing says that
 * the first went out when the appointment was ARRANGED and the second only
 * after it was MISSED. The owner reported this twice as the rail being
 * confusing, and it is: the node collapses a lifecycle into its last word while
 * the mail beneath it spans the whole of it.
 *
 * With a time on the outcome the rail can place it among the emails in order,
 * so each mail sits on the side of the outcome it belongs to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `updated_at` WILL NOT DO
 *
 * It moves for any write — a calendar sync, a timezone correction, the
 * attribution backfill that ran this week. It records when the ROW last
 * changed, which is a different question from when somebody answered.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BACKFILL IS THE TIMELINE, AND IT REFUSES WHERE IT CANNOT TELL
 *
 * `crm_activities` records `booking_no_show` and `booking_completed` against
 * the booking at the moment the owner pressed the button. Matched to the
 * attempt whose period contains it, which is a recorded time rather than an
 * inference.
 *
 * Attempts with an outcome and no such activity keep NULL — the automated
 * writers record no CRM activity, and `updated_at` is not an answer. A rail
 * that shows no time is honest; one showing the time of an unrelated write is
 * not.
 *
 * Plan: docs/workplans/BOOKING_MEETINGS_TABLE_PLAN.md (Phase 4c)
 * ─────────────────────────────────────────────────────────────────────────────
 */

BEGIN;

ALTER TABLE public.scheduling_meetings
  ADD COLUMN IF NOT EXISTS outcome_at timestamptz;

ALTER TABLE public.scheduling_bookings
  ADD COLUMN IF NOT EXISTS outcome_at timestamptz;

/*
 * The moment the owner answered, from the timeline.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MATCHED BY THE ATTEMPT'S OWN LIFE, NOT A WINDOW AROUND ITS START.
 *
 * The first version of this used "a day before the attempt's start to two days
 * after". On a booking rescheduled within one day every attempt falls inside
 * every window, so each activity matched several attempts and the update kept
 * whichever the join produced. Booking ab48357a came out with attempts #1 and
 * #3 both stamped 02:00:00 when #3 was marked at 05:45:35.
 *
 * An outcome is recorded while its attempt is CURRENT, and the reschedule
 * activities say exactly when each became so. `scripts/fix-outcome-at-from-
 * timeline.sql` carries the same query for databases that ran the broken one.
 * ─────────────────────────────────────────────────────────────────────────────
 */
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
  SELECT m.booking_id, mt.id AS meeting_id, b.created_at AS from_ts
    FROM moves m
    JOIN public.scheduling_bookings b  ON b.id = m.booking_id
    JOIN public.scheduling_meetings mt ON mt.booking_id = m.booking_id
                                      AND mt.start_time = m.moved_from
   WHERE m.seq = 1
  UNION
  SELECT m.booking_id, mt.id AS meeting_id, m.created_at AS from_ts
    FROM moves m
    JOIN public.scheduling_meetings mt ON mt.booking_id = m.booking_id
                                      AND mt.start_time = m.moved_to
),
windowed AS (
  SELECT booking_id, meeting_id, from_ts,
         lead(from_ts) OVER (PARTITION BY booking_id ORDER BY from_ts) AS until_ts
    FROM became
)
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
  FROM windowed w
 WHERE w.meeting_id = m.id
   AND m.outcome_at IS NULL
   AND m.meeting_status IN ('no_show', 'held');

/* The booking's own copy, describing its current attempt. */
UPDATE public.scheduling_bookings b
   SET outcome_at = m.outcome_at,
       updated_at = now()
  FROM public.scheduling_meetings m
 WHERE m.booking_id = b.id
   AND b.outcome_at IS NULL
   AND m.outcome_at IS NOT NULL
   AND m.occurrence_number = (
     SELECT max(x.occurrence_number) FROM public.scheduling_meetings x
      WHERE x.booking_id = b.id
   );

COMMENT ON COLUMN public.scheduling_meetings.outcome_at IS
  'When `meeting_status` was recorded. NULL where nobody recorded a time — rows predating 20261080 with no matching CRM activity, which is how the automated writers look. Distinct from `updated_at`, which moves for any write and so cannot answer "when did somebody answer".';

COMMIT;
