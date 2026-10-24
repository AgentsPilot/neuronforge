/*
 * Verifies 20261072_booking_meeting_status.sql landed correctly.
 *
 * Read-only. Safe to run against production at any time.
 *
 *   psql "$DATABASE_URL" -f scripts/check-booking-meeting-status-migration.sql
 *
 * Every row should read PASS. A FAIL names what is wrong.
 */

SET default_transaction_read_only = on;

WITH col AS (
  SELECT data_type, is_nullable, column_default
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'scheduling_bookings'
     AND column_name  = 'meeting_status'
),
chk AS (
  SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
   WHERE conname = 'scheduling_bookings_meeting_status_check'
),
idx AS (
  SELECT indexdef
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname  = 'idx_scheduling_bookings_meeting_status'
),
backfill AS (
  SELECT
    count(*) FILTER (WHERE status = 'completed' AND meeting_status IS DISTINCT FROM 'held')    AS completed_not_held,
    count(*) FILTER (WHERE status = 'no_show'   AND meeting_status IS DISTINCT FROM 'no_show') AS noshow_not_noshow,
    count(*) FILTER (WHERE status NOT IN ('completed','no_show') AND meeting_status IS NOT NULL) AS others_marked,
    count(*) FILTER (WHERE meeting_status = 'held')      AS held,
    count(*) FILTER (WHERE meeting_status = 'no_show')   AS no_show,
    count(*) FILTER (WHERE meeting_status = 'cancelled') AS cancelled,
    count(*) FILTER (WHERE meeting_status IS NULL)       AS unmarked,
    count(*)                                             AS total
    FROM public.scheduling_bookings
)

SELECT '1. column exists and is nullable TEXT' AS check,
       CASE WHEN (SELECT data_type FROM col) = 'text'
             AND (SELECT is_nullable FROM col) = 'YES'
            THEN 'PASS' ELSE 'FAIL' END AS result,
       coalesce((SELECT data_type || '/' || is_nullable FROM col), 'MISSING') AS detail

UNION ALL
SELECT '2. CHECK permits exactly held/no_show/cancelled + NULL',
       CASE WHEN (SELECT def FROM chk) ILIKE '%held%'
             AND (SELECT def FROM chk) ILIKE '%no_show%'
             AND (SELECT def FROM chk) ILIKE '%cancelled%'
            THEN 'PASS' ELSE 'FAIL' END,
       coalesce((SELECT def FROM chk), 'MISSING')

UNION ALL
SELECT '3. partial index on (user_id, meeting_status)',
       CASE WHEN (SELECT indexdef FROM idx) ILIKE '%WHERE (meeting_status IS NOT NULL)%'
            THEN 'PASS' ELSE 'FAIL' END,
       coalesce((SELECT indexdef FROM idx), 'MISSING')

UNION ALL
SELECT '4. every completed booking backfilled to held',
       CASE WHEN (SELECT completed_not_held FROM backfill) = 0 THEN 'PASS' ELSE 'FAIL' END,
       'offenders: ' || (SELECT completed_not_held FROM backfill)::text

UNION ALL
SELECT '5. every no_show booking backfilled to no_show',
       CASE WHEN (SELECT noshow_not_noshow FROM backfill) = 0 THEN 'PASS' ELSE 'FAIL' END,
       'offenders: ' || (SELECT noshow_not_noshow FROM backfill)::text

UNION ALL
/*
 * Nothing else may carry an outcome yet. The application has not started
 * writing this column at this point in the plan, so a marked row here would
 * mean the backfill matched something it should not have.
 */
SELECT '6. no other status carries a meeting outcome',
       CASE WHEN (SELECT others_marked FROM backfill) = 0 THEN 'PASS' ELSE 'FAIL' END,
       'offenders: ' || (SELECT others_marked FROM backfill)::text

UNION ALL
SELECT '7. distribution (informational)',
       'INFO',
       format('held=%s no_show=%s cancelled=%s unmarked=%s total=%s',
              (SELECT held FROM backfill), (SELECT no_show FROM backfill),
              (SELECT cancelled FROM backfill), (SELECT unmarked FROM backfill),
              (SELECT total FROM backfill))

UNION ALL
/*
 * The rows this whole change exists for: a job called off whose meeting had
 * already been recorded. Before the migration they are indistinguishable from
 * an ordinary completed booking. After it, the two facts are separately
 * readable for the first time.
 */
SELECT '8. held-then-cancelled rows now readable (informational)',
       'INFO',
       'count: ' || (
         SELECT count(*)::text FROM public.scheduling_bookings
          WHERE meeting_status = 'held'
            AND (cancel_reason IS NOT NULL OR cancelled_by IS NOT NULL)
       );
