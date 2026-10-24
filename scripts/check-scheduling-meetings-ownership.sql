/*
 * Verifies 20261076_scheduling_meetings_ownership.sql landed correctly.
 *
 * Read-only. Safe against production at any time.
 *
 *   psql "$DATABASE_URL" -f scripts/check-scheduling-meetings-ownership.sql
 *
 * Every row should read PASS. A FAIL names what is wrong.
 */

SET default_transaction_read_only = on;

WITH fk AS (
  SELECT c.conname,
         pg_get_constraintdef(c.oid) AS def,
         c.convalidated
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'scheduling_meetings'
     AND c.conname = 'scheduling_meetings_business_fk'
),
booking_fk AS (
  SELECT pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'scheduling_meetings'
     AND c.contype = 'f'
     AND pg_get_constraintdef(c.oid) ILIKE '%scheduling_bookings%'
),
orphans AS (
  SELECT count(*) AS n
    FROM public.scheduling_meetings m
   WHERE NOT EXISTS (
     SELECT 1 FROM public.business_profiles p WHERE p.user_id = m.user_id
   )
)

SELECT '1. business ownership constraint exists' AS check,
       CASE WHEN (SELECT conname FROM fk) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result,
       coalesce((SELECT conname FROM fk), 'MISSING') AS detail

UNION ALL
/* The cascade is the whole point: without it, deleting a business is REJECTED
   rather than completed, which is a worse failure than the leak it fixes. */
SELECT '2. points at business_profiles with a cascade',
       CASE WHEN (SELECT def FROM fk) ILIKE '%REFERENCES business_profiles(user_id)%'
             AND (SELECT def FROM fk) ILIKE '%ON DELETE CASCADE%'
            THEN 'PASS' ELSE 'FAIL' END,
       coalesce((SELECT def FROM fk), 'MISSING')

UNION ALL
/* NOT VALID is expected and correct — it binds every new and changed row
   without the full-table scan a validation needs. Matches every other
   constraint 20260916 creates. */
SELECT '3. NOT VALID, like the rest of the ownership graph',
       CASE WHEN (SELECT convalidated FROM fk) = false THEN 'PASS'
            WHEN (SELECT convalidated FROM fk) = true  THEN 'INFO'
            ELSE 'FAIL' END,
       CASE WHEN (SELECT convalidated FROM fk) = true
            THEN 'validated — fine, and stricter than required'
            ELSE 'not validated, as intended' END

UNION ALL
/* The transitive path that was already protecting these rows. It must survive:
   it is what empties the table when a booking goes, and the purge descriptor's
   PRE_BLOCKING ordering is written around it. */
SELECT '4. booking_id still cascades from scheduling_bookings',
       CASE WHEN (SELECT def FROM booking_fk) ILIKE '%ON DELETE CASCADE%' THEN 'PASS' ELSE 'FAIL' END,
       coalesce((SELECT def FROM booking_fk), 'MISSING')

UNION ALL
/* A meeting whose owner has no business profile. Cannot happen through the
   application — `syncMeeting` copies `user_id` off the booking, and bookings
   already carry this constraint — so a non-zero count is data from before the
   graph existed, not a live fault. */
SELECT '5. no meeting without a business profile',
       CASE WHEN (SELECT n FROM orphans) = 0 THEN 'PASS' ELSE 'CHECK' END,
       'orphans: ' || (SELECT n FROM orphans)::text;
