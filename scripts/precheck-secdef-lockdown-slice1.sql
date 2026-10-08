SET default_transaction_read_only = on;

WITH watched AS (
  SELECT watched_row.fn_name,
         watched_row.fn_signature,
         watched_row.fn_order,
         watched_row.expected_grantees,
         watched_row.is_lock_wrapper,
         watched_row.bare_signature
  FROM (VALUES
    ('claim_due_daily_briefings', 'public.claim_due_daily_briefings(uuid, integer)', 1, 'PUBLIC postgres service_role', false, NULL),
    ('claim_due_insight_actions', 'public.claim_due_insight_actions(uuid, integer)', 2, 'PUBLIC postgres service_role', false, NULL),
    ('claim_due_lead_responses', 'public.claim_due_lead_responses(uuid, integer)', 3, 'PUBLIC postgres service_role', false, NULL),
    ('claim_due_payment_automation_executions', 'public.claim_due_payment_automation_executions(uuid, integer)', 4, 'PUBLIC postgres service_role', false, NULL),
    ('claim_due_payment_reminders', 'public.claim_due_payment_reminders(uuid, integer)', 5, 'PUBLIC postgres service_role', false, NULL),
    ('reap_stale_daily_briefings', 'public.reap_stale_daily_briefings(integer, integer)', 6, 'PUBLIC postgres service_role', false, NULL),
    ('reap_stale_insight_actions', 'public.reap_stale_insight_actions(integer, integer)', 7, 'PUBLIC postgres service_role', false, NULL),
    ('reap_stale_lead_responses', 'public.reap_stale_lead_responses(integer, integer)', 8, 'PUBLIC postgres service_role', false, NULL),
    ('reap_stale_payment_automation_executions', 'public.reap_stale_payment_automation_executions(integer, integer)', 9, 'PUBLIC postgres service_role', false, NULL),
    ('reap_stale_payment_reminders', 'public.reap_stale_payment_reminders(integer, integer)', 10, 'PUBLIC postgres service_role', false, NULL),
    ('pg_try_advisory_lock', 'public.pg_try_advisory_lock(bigint)', 11, 'PUBLIC postgres anon authenticated service_role', true, 'pg_try_advisory_lock(bigint)'),
    ('pg_advisory_unlock', 'public.pg_advisory_unlock(bigint)', 12, 'PUBLIC postgres anon authenticated service_role', true, 'pg_advisory_unlock(bigint)'),
    ('auto_disable_ineffective_behavior_rules', 'public.auto_disable_ineffective_behavior_rules(integer, numeric)', 13, 'PUBLIC postgres anon authenticated service_role', false, NULL)
  ) AS watched_row (fn_name, fn_signature, fn_order, expected_grantees, is_lock_wrapper, bare_signature)
),
watched_fn AS (
  SELECT watched.*,
         'public' || chr(46) || watched.fn_name AS qualified_name,
         pg_catalog.to_regprocedure(watched.fn_signature) AS fn_oid
  FROM watched
),
fn_state AS (
  SELECT watched_fn.*,
         pg_catalog.pg_get_userbyid(pg_proc.proowner)::text AS owner_name,
         pg_proc.prosecdef AS is_secdef,
         COALESCE(array_to_string(pg_proc.proconfig, ' '), 'none') AS config_text,
         COALESCE(pg_proc.proacl, acldefault('f', pg_proc.proowner)) AS fn_acl
  FROM watched_fn
  LEFT JOIN pg_catalog.pg_proc ON pg_proc.oid = watched_fn.fn_oid
),
fn_execute_entry AS (
  SELECT fn_state.fn_name,
         CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl_item.grantee)::text END AS grantee_name,
         pg_catalog.pg_get_userbyid(acl_item.grantor)::text AS grantor_name
  FROM fn_state
  CROSS JOIN LATERAL aclexplode(fn_state.fn_acl) AS acl_item
  WHERE fn_state.fn_oid IS NOT NULL
    AND acl_item.privilege_type = 'EXECUTE'
),
caller_proc AS (
  SELECT fn_state.fn_name,
         fn_state.fn_order,
         fn_state.is_lock_wrapper,
         caller_namespace.nspname AS caller_schema,
         pg_proc.proname AS caller_name,
         pg_proc.prosecdef AS caller_secdef,
         pg_catalog.pg_get_userbyid(pg_proc.proowner)::text AS caller_owner,
         COALESCE(array_to_string(pg_proc.proconfig, ' '), 'none') AS caller_config,
         strpos(lower(pg_proc.prosrc), fn_state.qualified_name) > 0 AS is_qualified,
         strpos(COALESCE(array_to_string(pg_proc.proconfig, ' '), ''), 'public') > 0
           AND strpos(COALESCE(array_to_string(pg_proc.proconfig, ' '), ''), 'pg_catalog')
               > strpos(COALESCE(array_to_string(pg_proc.proconfig, ' '), ''), 'public') AS pins_public_first
  FROM fn_state
  JOIN pg_catalog.pg_proc ON strpos(lower(pg_proc.prosrc), fn_state.fn_name) > 0
  JOIN pg_catalog.pg_namespace AS caller_namespace ON caller_namespace.oid = pg_proc.pronamespace
  WHERE left(caller_namespace.nspname, 3) <> 'pg_'
    AND caller_namespace.nspname <> 'information_schema'
    AND pg_proc.oid IS DISTINCT FROM fn_state.fn_oid
),
caller_verdict AS (
  SELECT caller_proc.*,
         CASE
           WHEN caller_proc.is_lock_wrapper THEN caller_proc.is_qualified OR caller_proc.pins_public_first
           ELSE NOT caller_proc.caller_secdef OR caller_proc.caller_owner <> 'postgres'
         END AS needs_stop
  FROM caller_proc
),
policy_hit AS (
  SELECT fn_state.fn_name,
         fn_state.fn_order,
         pg_policies.schemaname AS policy_schema,
         pg_policies.tablename AS policy_table,
         pg_policies.policyname AS policy_name,
         pg_policies.roles::text AS policy_roles,
         CASE
           WHEN fn_state.is_lock_wrapper
             THEN strpos(lower(COALESCE(pg_policies.qual, '') || ' ' || COALESCE(pg_policies.with_check, '')), fn_state.qualified_name) > 0
           ELSE pg_policies.roles && ARRAY['public', 'anon', 'authenticated']::name[]
         END AS needs_stop
  FROM fn_state
  JOIN pg_catalog.pg_policies
    ON strpos(lower(COALESCE(pg_policies.qual, '') || ' ' || COALESCE(pg_policies.with_check, '')), fn_state.fn_name) > 0
),
view_source AS (
  SELECT pg_views.schemaname AS view_schema,
         pg_views.viewname AS view_name,
         pg_views.definition AS view_definition
  FROM pg_catalog.pg_views
  UNION ALL
  SELECT pg_matviews.schemaname, pg_matviews.matviewname, pg_matviews.definition
  FROM pg_catalog.pg_matviews
),
view_hit AS (
  SELECT fn_state.fn_name,
         fn_state.fn_order,
         view_source.view_schema,
         view_source.view_name,
         CASE
           WHEN fn_state.is_lock_wrapper THEN strpos(lower(view_source.view_definition), fn_state.qualified_name) > 0
           ELSE true
         END AS needs_stop
  FROM fn_state
  JOIN view_source ON strpos(lower(view_source.view_definition), fn_state.fn_name) > 0
  WHERE left(view_source.view_schema, 3) <> 'pg_'
    AND view_source.view_schema <> 'information_schema'
),
report AS (
  SELECT 0 AS sort_order,
         'READ ME' AS item,
         'this session is now read only so run the migration in a NEW tab' AS detail

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 10,
         'Q1 exists ' || fn_state.fn_name,
         CASE WHEN fn_state.fn_oid IS NULL THEN 'MISSING stop here' ELSE 'present' END
  FROM fn_state

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 20,
         'Q2 owner ' || fn_state.fn_name,
         CASE
           WHEN fn_state.owner_name IS NULL THEN 'missing stop here'
           WHEN fn_state.owner_name = 'postgres' THEN 'postgres ok'
           ELSE fn_state.owner_name || ' stop here'
         END
  FROM fn_state

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 30,
         'Q3 secdef ' || fn_state.fn_name,
         'secdef ' || COALESCE(fn_state.is_secdef::text, 'missing')
           || ' config ' || COALESCE(fn_state.config_text, 'missing')
           || CASE WHEN fn_state.is_secdef IS TRUE THEN ' ok' ELSE ' stop here' END
  FROM fn_state

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 40,
         'Q4 privileges ' || fn_state.fn_name,
         CASE
           WHEN fn_state.fn_oid IS NULL THEN 'missing stop here'
           ELSE 'public ' || pg_catalog.has_function_privilege('public', fn_state.fn_oid, 'EXECUTE')::text
             || ' anon ' || pg_catalog.has_function_privilege('anon', fn_state.fn_oid, 'EXECUTE')::text
             || ' authenticated ' || pg_catalog.has_function_privilege('authenticated', fn_state.fn_oid, 'EXECUTE')::text
             || ' service_role ' || pg_catalog.has_function_privilege('service_role', fn_state.fn_oid, 'EXECUTE')::text
             || CASE
                  WHEN pg_catalog.has_function_privilege('public', fn_state.fn_oid, 'EXECUTE')
                   AND pg_catalog.has_function_privilege('anon', fn_state.fn_oid, 'EXECUTE')
                   AND pg_catalog.has_function_privilege('authenticated', fn_state.fn_oid, 'EXECUTE')
                   AND pg_catalog.has_function_privilege('service_role', fn_state.fn_oid, 'EXECUTE')
                    THEN ' ok'
                  ELSE ' stop here'
                END
         END
  FROM fn_state

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 50,
         'Q5 grantees ' || fn_state.fn_name || ' expected ' || fn_state.expected_grantees,
         COALESCE(
           (SELECT string_agg(fn_execute_entry.grantee_name, ' ' ORDER BY fn_execute_entry.grantee_name COLLATE "C")
            FROM fn_execute_entry
            WHERE fn_execute_entry.fn_name = fn_state.fn_name),
           'none')
         || CASE
              WHEN (SELECT string_agg(fn_execute_entry.grantee_name, ' ' ORDER BY fn_execute_entry.grantee_name COLLATE "C")
                    FROM fn_execute_entry
                    WHERE fn_execute_entry.fn_name = fn_state.fn_name)
                 = (SELECT string_agg(expected_grantee, ' ' ORDER BY expected_grantee COLLATE "C")
                    FROM unnest(string_to_array(fn_state.expected_grantees, ' ')) AS expected_grantee)
                THEN ' match'
              ELSE ' DIFFERS stop here rollback must change'
            END
  FROM fn_state

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 55,
         'Q5 grantors ' || fn_state.fn_name,
         COALESCE(
           (SELECT string_agg(fn_execute_entry.grantee_name || ' by ' || fn_execute_entry.grantor_name, ' '
                              ORDER BY fn_execute_entry.grantee_name COLLATE "C")
            FROM fn_execute_entry
            WHERE fn_execute_entry.fn_name = fn_state.fn_name),
           'none')
         || CASE
              WHEN fn_state.fn_oid IS NULL THEN ' stop here'
              WHEN EXISTS (SELECT 1 FROM fn_execute_entry
                           WHERE fn_execute_entry.fn_name = fn_state.fn_name
                             AND fn_execute_entry.grantor_name IS DISTINCT FROM fn_state.owner_name)
                THEN ' OTHER GRANTOR stop here'
              ELSE ' owner granted all'
            END
  FROM fn_state

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 60,
         'Q6 callers count ' || fn_state.fn_name,
         (SELECT count(*) FROM caller_verdict WHERE caller_verdict.fn_name = fn_state.fn_name)::text
           || ' found '
           || (SELECT count(*) FROM caller_verdict
               WHERE caller_verdict.fn_name = fn_state.fn_name AND caller_verdict.needs_stop)::text
           || ' flagged'
  FROM fn_state

  UNION ALL
  SELECT caller_verdict.fn_order * 1000 + 61,
         'Q6 caller ' || caller_verdict.caller_schema || ' ' || caller_verdict.caller_name || ' of ' || caller_verdict.fn_name,
         'secdef ' || caller_verdict.caller_secdef::text
           || ' owner ' || caller_verdict.caller_owner
           || ' config ' || caller_verdict.caller_config
           || ' qualified ' || caller_verdict.is_qualified::text
           || CASE
                WHEN caller_verdict.needs_stop THEN ' stop here'
                WHEN caller_verdict.is_lock_wrapper THEN ' bare name resolves pg_catalog ok'
                ELSE ' ok'
              END
  FROM caller_verdict

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 70,
         'Q7 policies count ' || fn_state.fn_name,
         (SELECT count(*) FROM policy_hit WHERE policy_hit.fn_name = fn_state.fn_name)::text
  FROM fn_state

  UNION ALL
  SELECT policy_hit.fn_order * 1000 + 71,
         'Q7 policy ' || policy_hit.policy_schema || ' ' || policy_hit.policy_table || ' ' || policy_hit.policy_name
           || ' of ' || policy_hit.fn_name,
         'roles ' || policy_hit.policy_roles || CASE WHEN policy_hit.needs_stop THEN ' stop here' ELSE ' ok' END
  FROM policy_hit

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 80,
         'Q8 views count ' || fn_state.fn_name,
         (SELECT count(*) FROM view_hit WHERE view_hit.fn_name = fn_state.fn_name)::text
  FROM fn_state

  UNION ALL
  SELECT view_hit.fn_order * 1000 + 81,
         'Q8 view ' || view_hit.view_schema || ' ' || view_hit.view_name || ' of ' || view_hit.fn_name,
         CASE WHEN view_hit.needs_stop THEN 'stop here' ELSE 'bare name resolves pg_catalog ok' END
  FROM view_hit

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 90,
         'Q9 cron ' || fn_state.fn_name,
         CASE
           WHEN pg_catalog.to_regclass('cron.job') IS NULL THEN 'cron not installed'
           WHEN strpos(lower(query_to_xml('TABLE cron.job', true, false, '')::text),
                       CASE WHEN fn_state.is_lock_wrapper THEN fn_state.qualified_name ELSE fn_state.fn_name END) > 0
             THEN 'NAMED visible jobs only stop here'
           ELSE 'none visible jobs only'
         END
  FROM fn_state

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 95,
         'Q10 bare name resolves ' || fn_state.fn_name,
         COALESCE(
           (SELECT bare_namespace.nspname::text
            FROM pg_catalog.pg_proc AS bare_proc
            JOIN pg_catalog.pg_namespace AS bare_namespace ON bare_namespace.oid = bare_proc.pronamespace
            WHERE bare_proc.oid = pg_catalog.to_regprocedure(fn_state.bare_signature)),
           'unresolved')
         || CASE
              WHEN (SELECT bare_namespace.nspname::text
                    FROM pg_catalog.pg_proc AS bare_proc
                    JOIN pg_catalog.pg_namespace AS bare_namespace ON bare_namespace.oid = bare_proc.pronamespace
                    WHERE bare_proc.oid = pg_catalog.to_regprocedure(fn_state.bare_signature)) = 'pg_catalog'
                THEN ' ok'
              ELSE ' stop here'
            END
  FROM fn_state
  WHERE fn_state.is_lock_wrapper

  UNION ALL
  SELECT 99000, 'checked at utc', (now() AT TIME ZONE 'UTC')::text
)
SELECT final_report.sort_order, final_report.item, final_report.detail
FROM (
  SELECT 1 AS sort_order,
         'PRECHECK STATUS' AS item,
         CASE
           WHEN (SELECT count(*) FROM report WHERE strpos(report.detail, 'stop here') > 0) = 0 THEN 'CLEAN'
           ELSE 'STOP ' || (SELECT count(*) FROM report WHERE strpos(report.detail, 'stop here') > 0)::text
             || ' rows need review'
         END AS detail
  UNION ALL
  SELECT report.sort_order, report.item, report.detail FROM report
) AS final_report
ORDER BY final_report.sort_order, final_report.item;
