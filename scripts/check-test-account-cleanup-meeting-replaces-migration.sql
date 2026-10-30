-- 20261101 checker, step 3 of the PROD apply (docs/workplans/TEST_ACCOUNT_CLEANUP_MEETING_REPLACES_FK_FIX_WORKPLAN.md). Read-only
-- Run after 20261101. Every row must say ok, row 8 included. Any FAIL row: paste the output back before the merge
-- Row 8 is an operator gate. ok proves the exact committed body. A FAIL there is resolved before the merge
-- by comparing the pasted bytes and their line endings with the PR head, and is never ignored
-- Until the build pinning 41d799d7a76e829b is deployed, the Danger Zone check and delete refuse on the version stamp. Deploy fast
WITH
fn AS (
  SELECT pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)') AS oid
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
  SELECT 5, 'its body holds the version stamp this build pins (41d799d7a76e829b)',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('41d799d7a76e829b' in p.prosrc) > 0)
  UNION ALL
  SELECT 6, 'the 20261096 stamp b1203c526bc9ec91 is gone from it',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('b1203c526bc9ec91' in p.prosrc) > 0)
  UNION ALL
  SELECT 7, 'its body reviews the link scheduling_meetings_replaces_meeting_id_fkey for G-18',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn)
      AND position(pg_catalog.quote_literal('scheduling_meetings_replaces_meeting_id_fkey') in p.prosrc) > 0)
  UNION ALL
  SELECT 8, 'operator gate. md5 of the body is 95adf58340f1344bd4fc6be7e36c1df3, the committed 20261101 body',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND pg_catalog.md5(p.prosrc) = '95adf58340f1344bd4fc6be7e36c1df3')
)
SELECT checks.ord, checks.check_name, CASE WHEN checks.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM checks
ORDER BY checks.ord;
