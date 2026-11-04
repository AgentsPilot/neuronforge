-- Checker for 20261106_secdef_rpc_tenant_isolation.sql (S11.1 / F4).
--
-- Read-only. Run it BEFORE the migration as well as after: before, C1 to C4,
-- C6, C7 and C8 must FAIL. A checker that cannot fail has proved nothing, and
-- the failing baseline is the evidence that this one can.
--
-- After the migration every check must read PASS. C9 to C16 are the invariants
-- the fix must NOT regress — C9 above all: revoking EXECUTE from
-- `authenticated` would close the hole and break agent execution for every
-- user, because all five RPCs are also reached through the user-cookie client.
--
-- @see supabase/migrations/20261106_secdef_rpc_tenant_isolation.sql
-- @see https://app.clickup.com/t/868mnrnbb

SET default_transaction_read_only = on;

WITH watched AS (
  SELECT *
  FROM (VALUES
    ('update_execution_baseline', false),
    ('record_execution_anomaly',  false),
    ('upsert_error_pattern',      false),
    ('record_auto_fix_result',    false),
    ('increment_executions_used', true)
  ) AS v (fname, must_be_definer)
),
fns AS (
  SELECT watched.fname,
         watched.must_be_definer,
         pg_proc.oid,
         pg_proc.prosecdef,
         pg_proc.proconfig,
         lower(pg_proc.prosrc) AS src
  FROM watched
  LEFT JOIN pg_proc ON pg_proc.proname = watched.fname
    AND pg_proc.pronamespace = 'public'::regnamespace
),
guard AS (
  SELECT fns.oid, fns.src, fns.proconfig
  FROM fns
  WHERE fns.fname = 'increment_executions_used'
),
watched_tables AS (
  SELECT *
  FROM (VALUES
    ('execution_baselines'),
    ('execution_anomalies'),
    ('error_patterns')
  ) AS v (tname)
),
checks AS (
  -- The change itself -------------------------------------------------------
  SELECT 1000 + row_number() OVER (ORDER BY fns.fname) AS sort_order,
         'C' || row_number() OVER (ORDER BY fns.fname)
           || ' ' || fns.fname || ' runs with the caller rights' AS check_name,
         CASE WHEN fns.oid IS NULL THEN 'FAIL'
              WHEN fns.prosecdef = false THEN 'PASS'
              ELSE 'FAIL' END AS result,
         CASE WHEN fns.oid IS NULL THEN 'function absent'
              ELSE 'definer=' || fns.prosecdef::text || ' expected false' END AS detail
  FROM fns
  WHERE fns.must_be_definer = false

  UNION ALL
  SELECT 1100,
         'C5 increment_executions_used still runs with the definer rights',
         CASE WHEN (SELECT fns.prosecdef FROM fns WHERE fns.fname = 'increment_executions_used')
              THEN 'PASS' ELSE 'FAIL' END,
         'authenticated holds SELECT only on user_subscriptions, so it must stay'

  UNION ALL
  SELECT 1101,
         'C6 increment_executions_used has a pinned search path',
         CASE WHEN EXISTS (
                SELECT 1 FROM guard
                WHERE array_to_string(guard.proconfig, ' ') LIKE '%search_path%')
              THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT array_to_string(guard.proconfig, ' ') FROM guard), 'not set')

  UNION ALL
  SELECT 1102,
         'C7 the caller check tolerates a NULL identity (trap T-2)',
         CASE WHEN EXISTS (
                SELECT 1 FROM guard
                WHERE strpos(guard.src, 'auth.uid() is not null') > 0)
              THEN 'PASS' ELSE 'FAIL' END,
         'a bare equality would refuse every scheduled and webhook run'

  UNION ALL
  SELECT 1103,
         'C8 the caller check compares the charged account',
         CASE WHEN EXISTS (
                SELECT 1 FROM guard
                WHERE strpos(guard.src, 'auth.uid() <> p_user_id') > 0)
              THEN 'PASS' ELSE 'FAIL' END,
         'guard must refuse a mismatch, not merely mention auth.uid()'

  -- Invariants that must not regress ---------------------------------------
  UNION ALL
  SELECT 1200,
         'C9 authenticated keeps EXECUTE on all five (trap T-1)',
         CASE WHEN (SELECT count(*) FROM fns
                    WHERE fns.oid IS NOT NULL
                      AND has_function_privilege('authenticated', fns.oid, 'EXECUTE')) = 5
              THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM fns
          WHERE fns.oid IS NOT NULL
            AND has_function_privilege('authenticated', fns.oid, 'EXECUTE'))
           || ' of 5 executable by authenticated, 5 expected'

  UNION ALL
  SELECT 1201,
         'C10 service_role keeps EXECUTE on all five',
         CASE WHEN (SELECT count(*) FROM fns
                    WHERE fns.oid IS NOT NULL
                      AND has_function_privilege('service_role', fns.oid, 'EXECUTE')) = 5
              THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM fns
          WHERE fns.oid IS NOT NULL
            AND has_function_privilege('service_role', fns.oid, 'EXECUTE'))
           || ' of 5 executable by service_role, 5 expected'

  UNION ALL
  SELECT 1202,
         'C11 anon can execute none of the five',
         CASE WHEN (SELECT count(*) FROM fns
                    WHERE fns.oid IS NOT NULL
                      AND has_function_privilege('anon', fns.oid, 'EXECUTE')) = 0
              THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM fns
          WHERE fns.oid IS NOT NULL
            AND has_function_privilege('anon', fns.oid, 'EXECUTE'))
           || ' executable by anon, 0 expected'

  UNION ALL
  SELECT 1203,
         'C12 one overload per name, so the ALTER signatures were unambiguous',
         CASE WHEN (SELECT count(*) FROM pg_proc
                    JOIN watched ON watched.fname = pg_proc.proname
                    WHERE pg_proc.pronamespace = 'public'::regnamespace) = 5
              THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM pg_proc
          JOIN watched ON watched.fname = pg_proc.proname
          WHERE pg_proc.pronamespace = 'public'::regnamespace)
           || ' functions found, 5 expected'

  UNION ALL
  SELECT 1300,
         'C13 RLS still on the three tables the caller rights now rely on',
         CASE WHEN (SELECT count(*) FROM pg_class
                    JOIN watched_tables ON watched_tables.tname = pg_class.relname
                    WHERE pg_class.relnamespace = 'public'::regnamespace
                      AND pg_class.relrowsecurity) = 3
              THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM pg_class
          JOIN watched_tables ON watched_tables.tname = pg_class.relname
          WHERE pg_class.relnamespace = 'public'::regnamespace
            AND pg_class.relrowsecurity)
           || ' of 3 with RLS on, 3 expected'

  UNION ALL
  SELECT 1301,
         'C14 each of the three tables keeps a user_id = auth.uid() policy',
         CASE WHEN (SELECT count(DISTINCT pg_class.relname)
                    FROM pg_policy
                    JOIN pg_class ON pg_class.oid = pg_policy.polrelid
                    JOIN watched_tables ON watched_tables.tname = pg_class.relname
                    WHERE pg_class.relnamespace = 'public'::regnamespace
                      AND strpos(
                            COALESCE(pg_get_expr(pg_policy.polqual, pg_policy.polrelid), ''),
                            'auth.uid()') > 0) = 3
              THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(DISTINCT pg_class.relname)
          FROM pg_policy
          JOIN pg_class ON pg_class.oid = pg_policy.polrelid
          JOIN watched_tables ON watched_tables.tname = pg_class.relname
          WHERE pg_class.relnamespace = 'public'::regnamespace
            AND strpos(
                  COALESCE(pg_get_expr(pg_policy.polqual, pg_policy.polrelid), ''),
                  'auth.uid()') > 0)
           || ' of 3 tables policy-scoped, 3 expected'

  UNION ALL
  SELECT 1302,
         'C15 authenticated keeps the table writes the caller rights need',
         CASE WHEN (SELECT count(*)
                    FROM information_schema.role_table_grants g
                    JOIN watched_tables ON watched_tables.tname = g.table_name
                    WHERE g.table_schema = 'public'
                      AND g.grantee = 'authenticated'
                      AND g.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) = 12
              THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*)
          FROM information_schema.role_table_grants g
          JOIN watched_tables ON watched_tables.tname = g.table_name
          WHERE g.table_schema = 'public'
            AND g.grantee = 'authenticated'
            AND g.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
           || ' of 12 grants present, 12 expected (3 tables x 4 privileges)'

  UNION ALL
  SELECT 1303,
         'C16 authenticated still cannot write user_subscriptions',
         CASE WHEN (SELECT count(*)
                    FROM information_schema.role_table_grants g
                    WHERE g.table_schema = 'public'
                      AND g.table_name = 'user_subscriptions'
                      AND g.grantee = 'authenticated'
                      AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')) = 0
              THEN 'PASS' ELSE 'FAIL' END,
         'a write grant here would make the definer rights unnecessary and the guard load-bearing on its own'

  UNION ALL
  SELECT 1304,
         'C17 service_role still bypasses RLS, so server callers are unaffected',
         CASE WHEN (SELECT pg_roles.rolbypassrls FROM pg_roles
                    WHERE pg_roles.rolname = 'service_role')
              THEN 'PASS' ELSE 'FAIL' END,
         'scheduledAgentRunner, the sentinel webhook and DryRunValidator depend on this'
)
SELECT report.check_name, report.result, report.detail
FROM (
  SELECT 0 AS sort_order,
         'VERDICT' AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.result <> 'PASS') THEN 'FAIL' ELSE 'PASS' END AS result,
         (SELECT count(*) FROM checks WHERE checks.result = 'PASS') || ' pass '
           || (SELECT count(*) FROM checks WHERE checks.result <> 'PASS') || ' fail' AS detail
  UNION ALL
  SELECT checks.sort_order, checks.check_name, checks.result, checks.detail FROM checks
) AS report
ORDER BY report.sort_order;
