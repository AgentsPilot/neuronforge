/*
 * Verifies 20261074_installment_meeting_id.sql landed correctly.
 *
 * Read-only. Safe against production at any time.
 *
 *   psql "$DATABASE_URL" -f scripts/check-installment-meeting-id-migration.sql
 *
 * Every row should read PASS. A FAIL names what is wrong.
 */

SET default_transaction_read_only = on;

WITH col AS (
  SELECT data_type, is_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'payment_plan_installments'
     AND column_name  = 'meeting_id'
),
fk AS (
  SELECT pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'payment_plan_installments'
     AND c.contype = 'f'
     AND pg_get_constraintdef(c.oid) ILIKE '%scheduling_meetings%'
),
state AS (
  SELECT
    (SELECT count(*) FROM public.payment_plan_installments)                          AS total,
    (SELECT count(*) FROM public.payment_plan_installments WHERE booking_id IS NOT NULL) AS bound_to_booking,
    (SELECT count(*) FROM public.payment_plan_installments WHERE meeting_id IS NOT NULL) AS bound_to_meeting,
    /* A stage whose booking HAS a meeting, but which did not get one: the
       backfill missing a row it should have matched. */
    (SELECT count(*) FROM public.payment_plan_installments i
       JOIN public.scheduling_meetings m ON m.booking_id = i.booking_id
      WHERE i.meeting_id IS NULL)                                                     AS should_have_matched,
    /* The binding must agree with itself: the meeting it names must belong to
       the booking it names. */
    (SELECT count(*) FROM public.payment_plan_installments i
       JOIN public.scheduling_meetings m ON m.id = i.meeting_id
      WHERE i.booking_id IS DISTINCT FROM m.booking_id)                               AS disagreeing,
    /* Stages with no appointment to bill — a course or a product. Expected,
       and the reason the column is nullable. */
    (SELECT count(*) FROM public.payment_plan_installments i
      WHERE i.meeting_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.scheduling_meetings m WHERE m.booking_id = i.booking_id)) AS no_meeting_to_bill
)

SELECT '1. column exists, nullable uuid' AS check,
       CASE WHEN (SELECT data_type FROM col) = 'uuid'
             AND (SELECT is_nullable FROM col) = 'YES'
            THEN 'PASS' ELSE 'FAIL' END AS result,
       coalesce((SELECT data_type || '/' || is_nullable FROM col), 'MISSING') AS detail

UNION ALL
/* SET NULL, never CASCADE: a deleted meeting must not take a payment row with
   it, or a figure stops reconciling. */
SELECT '2. foreign key is ON DELETE SET NULL',
       CASE WHEN (SELECT def FROM fk) ILIKE '%ON DELETE SET NULL%' THEN 'PASS' ELSE 'FAIL' END,
       coalesce((SELECT def FROM fk), 'MISSING')

UNION ALL
SELECT '3. every stage whose booking has a meeting got one',
       CASE WHEN (SELECT should_have_matched FROM state) = 0 THEN 'PASS' ELSE 'FAIL' END,
       'unmatched: ' || (SELECT should_have_matched FROM state)::text

UNION ALL
SELECT '4. the meeting named belongs to the booking named',
       CASE WHEN (SELECT disagreeing FROM state) = 0 THEN 'PASS' ELSE 'FAIL' END,
       'disagreeing: ' || (SELECT disagreeing FROM state)::text

UNION ALL
/* `booking_id` is deliberately untouched by this migration: every existing
   reader, `billSessionOnCompletion` included, still works off it. */
SELECT '5. booking_id left intact',
       CASE WHEN (SELECT bound_to_booking FROM state) > 0 THEN 'PASS' ELSE 'CHECK' END,
       (SELECT bound_to_booking FROM state)::text || ' of ' || (SELECT total FROM state)::text || ' still bound by booking_id'

UNION ALL
SELECT '6. counts (informational)',
       'INFO',
       format('instalments=%s  bound to a meeting=%s  no appointment to bill=%s',
              (SELECT total FROM state),
              (SELECT bound_to_meeting FROM state),
              (SELECT no_meeting_to_bill FROM state));
