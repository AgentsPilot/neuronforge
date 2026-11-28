-- Issue reporting 1.1a pre-check, ship drill step 6 (docs/workplans/BUSINESS_OS_ISSUE_REPORTING_SLICE_1_1_WORKPLAN.md section 4.3). Read-only, one SELECT
-- One pre-check for both files, 20261137 and 20261138. It returns 7 rows. Every row must say ok. Any FAIL row stops the apply
-- Run by the main session or DO through a read-only transaction. Paste the output back to TL and apply nothing
-- It proves the table does not exist yet, the auth facts the table and its policy rely on, and that the live
-- cleanup function is the 20261134 one and not the 20261138 one (SA RC-2). If row 7 says FAIL, stop and escalate
-- to TL. Never chain 20261138 onto another predecessor
WITH
fn AS (
  SELECT pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)') AS oid
),
checks AS (
  SELECT 1 AS ord, 'public.issue_reports does not exist yet' AS check_name,
    pg_catalog.to_regclass('public.issue_reports') IS NULL AS passed
  UNION ALL
  SELECT 2, 'no policy named issue_reports_owner_select exists',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS pol WHERE pol.polname = 'issue_reports_owner_select')
  UNION ALL
  SELECT 3, 'auth.users.id exists and is uuid',
    EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
      WHERE att.attrelid = pg_catalog.to_regclass('auth.users') AND att.attname = 'id'
        AND NOT att.attisdropped AND att.atttypid = 'uuid'::regtype)
  UNION ALL
  SELECT 4, 'auth.uid() resolves',
    pg_catalog.to_regprocedure('auth.uid()') IS NOT NULL
  UNION ALL
  SELECT 5, 'the roles anon, authenticated and service_role exist',
    (SELECT count(*) FROM pg_catalog.pg_roles AS r WHERE r.rolname IN ('anon', 'authenticated', 'service_role')) = 3
  UNION ALL
  SELECT 6, 'anon and authenticated may not create objects in schema public',
    NOT pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') AND NOT pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE')
  UNION ALL
  SELECT 7, 'the live 8 argument cleanup function holds the 20261134 stamp 9a097ff36229f6b5 and not the 20261138 stamp e3796cce5c2b37a7',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('9a097ff36229f6b5' in p.prosrc) > 0)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('e3796cce5c2b37a7' in p.prosrc) > 0)
)
SELECT checks.ord, checks.check_name, CASE WHEN checks.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM checks
ORDER BY checks.ord;
