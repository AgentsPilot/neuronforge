-- Checker for 20261107_anon_write_exposure_slice1.sql (S11.2 slice 1).
--
-- Read-only. Run it BEFORE the migration as well as after: before, C1 to C6
-- must FAIL. A checker that cannot fail has proved nothing, and the failing
-- baseline is the evidence that this one can.
--
-- C7 to C12 are the invariants the fix must NOT regress. C9 above all: the
-- approvals UI reads and writes through the BROWSER client as `authenticated`,
-- so if those two policies stop applying to `authenticated` the UI breaks.
--
-- A catalogue PASS is not the whole proof. The live half is an unauthenticated
-- request with the publishable key, paired with a control on the same path:
--   agent_memories and workflow_step_executions must return [] or 401
--   agents and crm_contacts must still return [] (the control)
-- An unpaired refusal cannot be told from an outage.
--
-- @see supabase/migrations/20261107_anon_write_exposure_slice1.sql

SET default_transaction_read_only = on;

WITH gone AS (
  -- the five policies this migration removes or replaces
  SELECT * FROM (VALUES
    ('workflow_step_executions',   'Enable read for anon role'),
    ('workflow_step_executions',   'Enable insert for anon role'),
    ('workflow_step_executions',   'Enable update for anon role'),
    ('agent_memories',             'Service role can access all agent memories'),
    ('execution_insights',         'Service role can insert insights')
  ) AS v (tname, pname)
),
live AS (
  SELECT c.relname AS tname,
         p.polname AS pname,
         p.polcmd,
         p.polroles,
         p.polpermissive,
         coalesce(pg_get_expr(p.polqual, p.polrelid), '')      AS using_expr,
         coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') AS check_expr
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  WHERE c.relnamespace = 'public'::regnamespace
),
-- every permissive policy still reachable by anon with a gate that never
-- consults the caller identity, across the whole schema
open_to_anon AS (
  SELECT live.tname, live.pname, live.polcmd,
         live.using_expr || ' | ' || live.check_expr AS gate
  FROM live
  WHERE live.polpermissive
    AND (live.polroles = '{0}'::oid[] OR 'anon'::regrole = ANY(live.polroles))
    AND (live.using_expr || ' ' || live.check_expr)
          !~* 'auth\.uid|auth\.role|auth\.jwt|is_platform_admin|current_setting'
    AND coalesce(nullif(live.using_expr, ''), 'true') <> 'false'
),
-- Tables this slice deliberately leaves open, each named in the migration
-- header with the reason. C7 excludes them; C8 caps the total so a new one
-- cannot be added silently.
deferred AS (
  SELECT unnest(ARRAY['smart_link_clicks','website_page_views','newsletter_subscribers',
                      'ais_scoring_weights','ais_system_config','system_settings_config',
                      'help_articles','helpbot_page_contexts','reward_config',
                      'website_archetypes']) AS tname
),
checks AS (
  -- The change itself -------------------------------------------------------
  SELECT 1000 + row_number() OVER (ORDER BY gone.tname, gone.pname) AS sort_order,
         'C' || row_number() OVER (ORDER BY gone.tname, gone.pname)
           || ' policy removed: ' || gone.tname || ' / ' || gone.pname AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM live
                           WHERE live.tname = gone.tname AND live.pname = gone.pname)
              THEN 'FAIL' ELSE 'PASS' END AS result,
         'must no longer exist' AS detail
  FROM gone

  UNION ALL
  SELECT 1100,
         'C6 execution_insights INSERT is scoped to the caller own row',
         CASE WHEN EXISTS (
                SELECT 1 FROM live
                WHERE live.tname = 'execution_insights'
                  AND live.polcmd = 'a'
                  AND live.check_expr ~* 'auth\.uid\(\) = user_id')
              THEN 'PASS' ELSE 'FAIL' END,
         coalesce((SELECT live.check_expr FROM live
                   WHERE live.tname = 'execution_insights' AND live.polcmd = 'a'
                   LIMIT 1), 'no INSERT policy')

  -- Invariants that must not regress ---------------------------------------
  UNION ALL
  SELECT 1200,
         'C7 no policy anywhere in public is still open to anon without an identity check',
         CASE WHEN (SELECT count(*) FROM open_to_anon
                    WHERE open_to_anon.tname NOT IN (SELECT deferred.tname FROM deferred)) = 0
              THEN 'PASS' ELSE 'FAIL' END,
         coalesce((SELECT string_agg(open_to_anon.tname || '/' || open_to_anon.pname, '; ')
                   FROM open_to_anon
                   WHERE open_to_anon.tname NOT IN (SELECT deferred.tname FROM deferred)),
                  'none outside the deliberately deferred set')

  UNION ALL
  SELECT 1201,
         'C8 the deferred set is exactly the 10 tables the migration names',
         CASE WHEN (SELECT count(DISTINCT open_to_anon.tname) FROM open_to_anon) <= 10
              THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(DISTINCT open_to_anon.tname) FROM open_to_anon)
           || ' tables still open to anon, 10 or fewer expected (all deferred by name). '
           || 'Baseline before this migration was 14 = 4 fixed here + 10 deferred.'

  UNION ALL
  SELECT 1300,
         'C9 the approvals UI keeps both policies as authenticated (trap T-1)',
         CASE WHEN (SELECT count(*) FROM live
                    WHERE live.tname = 'workflow_approval_requests'
                      AND live.polcmd IN ('a','w')
                      AND 'authenticated'::regrole = ANY(live.polroles)) = 2
              THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM live
          WHERE live.tname = 'workflow_approval_requests'
            AND live.polcmd IN ('a','w')
            AND 'authenticated'::regrole = ANY(live.polroles))
           || ' of 2 write policies apply to authenticated, 2 expected'

  UNION ALL
  SELECT 1301,
         'C10 workflow_approval_requests write policies no longer reach anon',
         CASE WHEN (SELECT count(*) FROM live
                    WHERE live.tname = 'workflow_approval_requests'
                      AND live.polcmd IN ('a','w')
                      AND (live.polroles = '{0}'::oid[]
                           OR 'anon'::regrole = ANY(live.polroles))) = 0
              THEN 'PASS' ELSE 'FAIL' END,
         'a PUBLIC or anon write policy here lets anyone approve a workflow'

  UNION ALL
  SELECT 1302,
         'C11 execution_insights keeps its three own-row policies',
         CASE WHEN (SELECT count(*) FROM live
                    WHERE live.tname = 'execution_insights'
                      AND live.polcmd IN ('r','w','d')
                      AND live.using_expr ~* 'auth\.uid\(\) = user_id') = 3
              THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM live
          WHERE live.tname = 'execution_insights'
            AND live.polcmd IN ('r','w','d')
            AND live.using_expr ~* 'auth\.uid\(\) = user_id')
           || ' of 3 own-row policies present, 3 expected'

  UNION ALL
  SELECT 1303,
         'C12 RLS still enabled on all four tables touched',
         CASE WHEN (SELECT count(*) FROM pg_class
                    WHERE pg_class.relnamespace = 'public'::regnamespace
                      AND pg_class.relname IN
                        ('workflow_step_executions','agent_memories',
                         'execution_insights','workflow_approval_requests')
                      AND pg_class.relrowsecurity) = 4
              THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM pg_class
          WHERE pg_class.relnamespace = 'public'::regnamespace
            AND pg_class.relname IN
              ('workflow_step_executions','agent_memories',
               'execution_insights','workflow_approval_requests')
            AND pg_class.relrowsecurity)
           || ' of 4 with RLS on, 4 expected'

  UNION ALL
  SELECT 1304,
         'C13 service_role still bypasses RLS, so every server path is unaffected',
         CASE WHEN (SELECT pg_roles.rolbypassrls FROM pg_roles
                    WHERE pg_roles.rolname = 'service_role')
              THEN 'PASS' ELSE 'FAIL' END,
         'StateManager writes step executions through supabaseAdmin and depends on this'
)
SELECT report.check_name, report.result, report.detail
FROM (
  SELECT 0 AS sort_order,
         'VERDICT' AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.result <> 'PASS')
              THEN 'FAIL' ELSE 'PASS' END AS result,
         (SELECT count(*) FROM checks WHERE checks.result = 'PASS') || ' pass '
           || (SELECT count(*) FROM checks WHERE checks.result <> 'PASS') || ' fail' AS detail
  UNION ALL
  SELECT checks.sort_order, checks.check_name, checks.result, checks.detail FROM checks
) AS report
ORDER BY report.sort_order;
