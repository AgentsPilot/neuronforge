/*
 * Verifies 20261073_scheduling_meetings.sql landed correctly.
 *
 * Read-only. Safe against production at any time.
 *
 *   psql "$DATABASE_URL" -f scripts/check-scheduling-meetings-migration.sql
 *
 * Every row should read PASS. A FAIL names what is wrong.
 */

SET default_transaction_read_only = on;

WITH tbl AS (
  SELECT to_regclass('public.scheduling_meetings') AS oid
),
cols AS (
  SELECT count(*) AS n
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'scheduling_meetings'
),
idx AS (
  SELECT count(*) AS n
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'scheduling_meetings'
     AND indexname IN ('idx_meetings_user_time', 'idx_meetings_booking', 'idx_meetings_unmarked')
),
fill AS (
  SELECT
    (SELECT count(*) FROM public.scheduling_bookings WHERE start_time IS NOT NULL) AS bookings_with_time,
    (SELECT count(*) FROM public.scheduling_meetings)                              AS meetings,
    /* Every timed booking must have exactly one meeting, and no meeting may
       exist without its booking. */
    (SELECT count(*) FROM public.scheduling_bookings b
      WHERE b.start_time IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.scheduling_meetings m WHERE m.booking_id = b.id)) AS missing,
    (SELECT count(*) FROM public.scheduling_meetings m
      WHERE NOT EXISTS (SELECT 1 FROM public.scheduling_bookings b WHERE b.id = m.booking_id))  AS orphaned,
    /* The outcome must have come across unchanged: a meeting the owner marked
       held that arrives here as NULL is the migration losing a fact. */
    (SELECT count(*) FROM public.scheduling_meetings m
       JOIN public.scheduling_bookings b ON b.id = m.booking_id
      WHERE m.meeting_status IS DISTINCT FROM b.meeting_status)                     AS status_drift,
    (SELECT count(*) FROM public.scheduling_meetings m
       JOIN public.scheduling_bookings b ON b.id = m.booking_id
      WHERE m.user_id <> b.user_id)                                                 AS tenant_drift,
    (SELECT count(*) FROM public.scheduling_meetings WHERE end_time <= start_time)  AS bad_times,
    (SELECT count(*) FROM public.scheduling_meetings WHERE meeting_status = 'held')    AS held,
    (SELECT count(*) FROM public.scheduling_meetings WHERE meeting_status = 'no_show') AS no_show,
    (SELECT count(*) FROM public.scheduling_meetings WHERE meeting_status IS NULL)     AS unmarked
)

SELECT '1. table exists' AS check,
       CASE WHEN (SELECT oid FROM tbl) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result,
       coalesce((SELECT oid FROM tbl)::text, 'MISSING') AS detail

UNION ALL
SELECT '2. narrow — 14 columns or fewer',
       CASE WHEN (SELECT n FROM cols) BETWEEN 1 AND 14 THEN 'PASS' ELSE 'FAIL' END,
       (SELECT n FROM cols)::text || ' columns (scheduling_bookings has 37)'

UNION ALL
SELECT '3. all three indexes present',
       CASE WHEN (SELECT n FROM idx) = 3 THEN 'PASS' ELSE 'FAIL' END,
       (SELECT n FROM idx)::text || ' of 3'

UNION ALL
SELECT '4. every timed booking has a meeting',
       CASE WHEN (SELECT missing FROM fill) = 0 THEN 'PASS' ELSE 'FAIL' END,
       'missing: ' || (SELECT missing FROM fill)::text

UNION ALL
SELECT '5. no meeting without its booking',
       CASE WHEN (SELECT orphaned FROM fill) = 0 THEN 'PASS' ELSE 'FAIL' END,
       'orphaned: ' || (SELECT orphaned FROM fill)::text

UNION ALL
SELECT '6. the outcome came across unchanged',
       CASE WHEN (SELECT status_drift FROM fill) = 0 THEN 'PASS' ELSE 'FAIL' END,
       'drifted: ' || (SELECT status_drift FROM fill)::text

UNION ALL
/* CLAUDE.md rule 4: a meeting filed under the wrong owner is a cross-tenant
   leak the moment anything reads this table. */
SELECT '7. every meeting under its booking''s owner',
       CASE WHEN (SELECT tenant_drift FROM fill) = 0 THEN 'PASS' ELSE 'FAIL' END,
       'mismatched: ' || (SELECT tenant_drift FROM fill)::text

UNION ALL
SELECT '8. no meeting ends before it starts',
       CASE WHEN (SELECT bad_times FROM fill) = 0 THEN 'PASS' ELSE 'FAIL' END,
       'offenders: ' || (SELECT bad_times FROM fill)::text

UNION ALL
SELECT '9. counts (informational)',
       'INFO',
       format('bookings with a time=%s  meetings=%s  held=%s  no_show=%s  unmarked=%s',
              (SELECT bookings_with_time FROM fill), (SELECT meetings FROM fill),
              (SELECT held FROM fill), (SELECT no_show FROM fill), (SELECT unmarked FROM fill));
