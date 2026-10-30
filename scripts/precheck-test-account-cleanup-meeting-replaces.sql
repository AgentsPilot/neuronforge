-- 20261101 pre-check, step 1 of the PROD apply (docs/workplans/TEST_ACCOUNT_CLEANUP_MEETING_REPLACES_FK_FIX_WORKPLAN.md). Read-only
-- Every row must say ok. Any FAIL row stops the apply. Paste the output back and apply nothing
-- It proves the live cleanup function is 20261096 and not 20261101, and the link 20261097 added exists under the reviewed name
WITH
fn AS (
  SELECT pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)') AS oid
),
checks AS (
  SELECT 1 AS ord, 'the 8 argument cleanup function exists and the 6 argument one is gone' AS check_name,
    (SELECT fn.oid FROM fn) IS NOT NULL
    AND pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text)') IS NULL AS passed
  UNION ALL
  SELECT 2, 'its body holds the 20261096 stamp b1203c526bc9ec91, the one the deployed build pins',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('b1203c526bc9ec91' in p.prosrc) > 0)
  UNION ALL
  SELECT 3, 'its body does not hold the 20261101 stamp 41d799d7a76e829b yet',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('41d799d7a76e829b' in p.prosrc) > 0)
  UNION ALL
  SELECT 4, 'the link scheduling_meetings_replaces_meeting_id_fkey exists on scheduling_meetings (20261097 is applied)',
    EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con
      WHERE con.contype = 'f' AND con.conname = 'scheduling_meetings_replaces_meeting_id_fkey'
        AND con.conrelid = pg_catalog.to_regclass('public.scheduling_meetings')
        AND con.confrelid = pg_catalog.to_regclass('public.scheduling_meetings'))
)
SELECT checks.ord, checks.check_name, CASE WHEN checks.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM checks
ORDER BY checks.ord;
