-- 20261092 checker, step 3 of the PROD apply (docs/workplans/TEST_ACCOUNT_CLEANUP_MEETINGS_FK_FIX_WORKPLAN.md). Read-only
-- Run after 20261092. Rows 1 to 7 must say ok. Any FAIL row: paste the output back to TL before the merge and deploy
-- Row 8 is information only, never a gate. ok proves the exact body. FAIL may only mean the paste changed line endings
-- Until the build pinning ec34d5604055abfe is deployed, the Danger Zone check and delete refuse on the version stamp. Deploy fast
WITH
fn AS (
  SELECT pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)') AS oid
),
links AS (
  SELECT link_values.constraint_name
  FROM (VALUES
    ('abandoned_bookings_booking_id_fkey'), ('abandoned_bookings_business_fk'), ('abandoned_bookings_service_id_fkey'),
    ('email_sends_booking_id_fkey'), ('email_sends_meeting_id_fkey'), ('payment_plan_installments_meeting_id_fkey'),
    ('scheduling_meetings_booking_id_fkey'), ('scheduling_meetings_business_fk')
  ) AS link_values(constraint_name)
),
checks AS (
  SELECT 1 AS ord, 'the 8 argument cleanup function exists' AS check_name, (SELECT fn.oid FROM fn) IS NOT NULL AS passed
  UNION ALL
  SELECT 2, 'the 6 argument cleanup function is gone',
    pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text)') IS NULL
  UNION ALL
  SELECT 3, 'it runs with its owner rights (prosecdef), is owned by postgres and has search_path pg_catalog, public, pg_temp',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = (SELECT fn.oid FROM fn) AND p.prosecdef
        AND p.proowner = (SELECT r.oid FROM pg_catalog.pg_roles AS r WHERE r.rolname = 'postgres')
        AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']::text[])
  UNION ALL
  SELECT 4, 'EXECUTE is service_role only',
    (SELECT fn.oid FROM fn) IS NOT NULL
    AND pg_catalog.has_function_privilege('service_role', (SELECT fn.oid FROM fn), 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('anon', (SELECT fn.oid FROM fn), 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('authenticated', (SELECT fn.oid FROM fn), 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS acl
      WHERE p.oid = (SELECT fn.oid FROM fn) AND acl.grantee = 0)
  UNION ALL
  SELECT 5, 'its body holds the version stamp this build pins (ec34d5604055abfe)',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('ec34d5604055abfe' in p.prosrc) > 0)
  UNION ALL
  SELECT 6, 'the 20261081 stamp 2bd40a46795e4555 is gone from it',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('2bd40a46795e4555' in p.prosrc) > 0)
  UNION ALL
  SELECT 7, 'its body names all eight reviewed links',
    (SELECT count(*) FROM links AS link
      WHERE EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn)
        AND position(pg_catalog.quote_literal(link.constraint_name) in p.prosrc) > 0)) = 8
  UNION ALL
  SELECT 8, 'information only. md5 of the body is c721f252594edd75ca91c7263f088412, the committed 20261092 body',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND pg_catalog.md5(p.prosrc) = 'c721f252594edd75ca91c7263f088412')
)
SELECT checks.ord, checks.check_name, CASE WHEN checks.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM checks
ORDER BY checks.ord;
