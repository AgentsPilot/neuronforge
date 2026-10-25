-- 20261092 pre-check, step 1 of the PROD apply (docs/workplans/TEST_ACCOUNT_CLEANUP_MEETINGS_FK_FIX_WORKPLAN.md). Read-only
-- Rows 1 to 5 must say ok. Any FAIL row stops the apply: paste the output back to TL and apply nothing
-- Row 6 is information only. ok means the hand made bridge of 2026-10-23 is live, FAIL means the committed 20261081 is
-- It proves the live cleanup function carries the 20261081 stamp, that 20261092 is not applied yet, and that the eight links exist
WITH
fn AS (
  SELECT pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)') AS oid
),
links AS (
  SELECT link_values.table_name, link_values.constraint_name
  FROM (VALUES
    ('abandoned_bookings', 'abandoned_bookings_booking_id_fkey'), ('abandoned_bookings', 'abandoned_bookings_business_fk'),
    ('abandoned_bookings', 'abandoned_bookings_service_id_fkey'), ('email_sends', 'email_sends_booking_id_fkey'),
    ('email_sends', 'email_sends_meeting_id_fkey'), ('payment_plan_installments', 'payment_plan_installments_meeting_id_fkey'),
    ('scheduling_meetings', 'scheduling_meetings_booking_id_fkey'), ('scheduling_meetings', 'scheduling_meetings_business_fk')
  ) AS link_values(table_name, constraint_name)
),
checks AS (
  SELECT 1 AS ord, 'the 8 argument cleanup function exists and the 6 argument one is gone' AS check_name,
    (SELECT fn.oid FROM fn) IS NOT NULL
    AND pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text)') IS NULL AS passed
  UNION ALL
  SELECT 2, 'its body holds the 20261081 stamp 2bd40a46795e4555, the one the deployed build pins',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('2bd40a46795e4555' in p.prosrc) > 0)
  UNION ALL
  SELECT 3, 'its body does not hold the 20261092 stamp ec34d5604055abfe yet',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('ec34d5604055abfe' in p.prosrc) > 0)
  UNION ALL
  SELECT 4, 'each of the eight links exists as a foreign key on its table',
    (SELECT count(*) FROM links AS link
      JOIN pg_catalog.pg_constraint AS con ON con.conname = link.constraint_name AND con.contype = 'f'
      JOIN pg_catalog.pg_class AS rel ON rel.oid = con.conrelid AND rel.relname = link.table_name
      JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace AND nsp.nspname = 'public') = 8
  UNION ALL
  SELECT 5, 'anon and authenticated may not create objects in schema public',
    NOT pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') AND NOT pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE')
  UNION ALL
  SELECT 6, 'information only. the live body already names all eight links (the bridge)',
    (SELECT count(*) FROM links AS link
      WHERE EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn)
        AND position(pg_catalog.quote_literal(link.constraint_name) in p.prosrc) > 0)) = 8
)
SELECT checks.ord, checks.check_name, CASE WHEN checks.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM checks
ORDER BY checks.ord;
