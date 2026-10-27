-- DL-1a pre-check, step 3 of the PROD apply (docs/workplans/BUSINESS_OS_DELETION_DL1A_WORKPLAN.md section 9). Read-only
-- One pre-check for both files, 20261093 and 20261094. Every row must say ok. Any FAIL row stops the apply
-- Paste the output back to TL and apply nothing
-- It proves the closure objects do not exist yet, the live cleanup function is 20261092 and not 20261094,
-- and the auth facts the session cut relies on (TL schema check Q-1 to Q-8)
WITH
fn AS (
  SELECT pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)') AS oid
),
checks AS (
  SELECT 1 AS ord, 'public.business_os_account_closures does not exist yet' AS check_name,
    pg_catalog.to_regclass('public.business_os_account_closures') IS NULL AS passed
  UNION ALL
  SELECT 2, 'the claim function and the session cut function do not exist yet',
    pg_catalog.to_regprocedure('public.business_os_account_closures_claim_due(uuid, integer)') IS NULL
    AND pg_catalog.to_regprocedure('public.business_os_account_closure_cut_sessions(uuid)') IS NULL
  UNION ALL
  SELECT 3, 'the 8 argument cleanup function exists and the 6 argument one is gone',
    (SELECT fn.oid FROM fn) IS NOT NULL
    AND pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text)') IS NULL
  UNION ALL
  SELECT 4, 'its body holds the 20261092 stamp ec34d5604055abfe, the one the deployed build pins',
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('ec34d5604055abfe' in p.prosrc) > 0)
  UNION ALL
  SELECT 5, 'its body does not hold the 20261094 stamp 792d801e13101316 yet',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('792d801e13101316' in p.prosrc) > 0)
  UNION ALL
  SELECT 6, 'auth.sessions.user_id is uuid and auth.refresh_tokens.user_id is text or varchar',
    EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
      WHERE att.attrelid = pg_catalog.to_regclass('auth.sessions') AND att.attname = 'user_id'
        AND NOT att.attisdropped AND att.atttypid = 'uuid'::regtype)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
      WHERE att.attrelid = pg_catalog.to_regclass('auth.refresh_tokens') AND att.attname = 'user_id'
        AND NOT att.attisdropped AND att.atttypid IN ('text'::regtype, 'varchar'::regtype))
  UNION ALL
  SELECT 7, 'postgres, the owner of the session cut, may remove rows from auth.sessions and auth.refresh_tokens',
    pg_catalog.has_table_privilege('postgres', 'auth.sessions', 'DELETE')
    AND pg_catalog.has_table_privilege('postgres', 'auth.refresh_tokens', 'DELETE')
  UNION ALL
  SELECT 8, 'anon and authenticated may not create objects in schema public',
    NOT pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') AND NOT pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE')
)
SELECT checks.ord, checks.check_name, CASE WHEN checks.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM checks
ORDER BY checks.ord;
