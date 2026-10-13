SET default_transaction_read_only = on;

WITH watched AS (
  SELECT watched_row.fn_name,
         watched_row.fn_signature,
         watched_row.fn_order,
         watched_row.expected_grantees,
         watched_row.keeps_authenticated
  FROM (VALUES
    ('search_business_chat_plans_semantic', 'public.search_business_chat_plans_semantic(vector, text, text, uuid, double precision, integer)', 1, 'PUBLIC postgres anon authenticated service_role', false),
    ('record_business_chat_plan_outcome', 'public.record_business_chat_plan_outcome(uuid, boolean)', 2, 'PUBLIC postgres anon authenticated service_role', false),
    ('match_verified_questions', 'public.match_verified_questions(vector, uuid, text, double precision, integer)', 3, 'PUBLIC postgres service_role', false),
    ('increment_verified_question_uses', 'public.increment_verified_question_uses(uuid[])', 4, 'PUBLIC postgres service_role', false),
    ('get_or_create_user_organization', 'public.get_or_create_user_organization(uuid)', 5, 'PUBLIC postgres anon authenticated service_role', false),
    ('check_subdomain_available', 'public.check_subdomain_available(text)', 6, 'PUBLIC postgres anon authenticated service_role', false),
    ('generate_subdomain', 'public.generate_subdomain(text)', 7, 'PUBLIC postgres anon authenticated service_role', false),
    ('upsert_intent_example', 'public.upsert_intent_example(text, jsonb, text[], integer, integer, text)', 8, 'PUBLIC postgres anon authenticated service_role', false),
    ('find_similar_intent_examples', 'public.find_similar_intent_examples(text[], text, text, integer)', 9, 'PUBLIC postgres anon authenticated service_role', false),
    ('record_intent_example_usage', 'public.record_intent_example_usage(uuid, boolean)', 10, 'PUBLIC postgres anon authenticated service_role', false),
    ('upsert_workflow_pattern', 'public.upsert_workflow_pattern(text[], text, integer, text, boolean, numeric, numeric)', 11, 'PUBLIC postgres anon authenticated service_role', false),
    ('get_similar_patterns', 'public.get_similar_patterns(text[], integer)', 12, 'PUBLIC postgres anon authenticated service_role', false),
    ('record_global_failure', 'public.record_global_failure(text, text, text, text, boolean)', 13, 'PUBLIC postgres anon authenticated service_role', false),
    ('get_active_failures', 'public.get_active_failures(text, text)', 14, 'PUBLIC postgres anon authenticated service_role', false),
    ('advance_contact_stage', 'public.advance_contact_stage(uuid, uuid, text, text[])', 15, 'PUBLIC postgres anon authenticated service_role', false),
    ('increment_calibration_count', 'public.increment_calibration_count(uuid)', 16, 'PUBLIC postgres anon authenticated service_role', false),
    ('record_business_event', 'public.record_business_event(uuid, text, text, text, uuid, uuid, numeric, jsonb, text, timestamp with time zone)', 17, 'PUBLIC postgres service_role', false),
    ('is_platform_admin', 'public.is_platform_admin()', 18, 'postgres anon authenticated service_role', true)
  ) AS watched_row (fn_name, fn_signature, fn_order, expected_grantees, keeps_authenticated)
),
watched_fn AS (
  SELECT watched.*,
         'public' || chr(46) || watched.fn_name AS qualified_name,
         strpos(watched.expected_grantees, 'PUBLIC') > 0 AS expects_public,
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
         fn_state.keeps_authenticated,
         caller_namespace.nspname AS caller_schema,
         pg_proc.proname AS caller_name,
         pg_proc.prosecdef AS caller_secdef,
         pg_proc.prorettype = 'trigger'::regtype AS caller_is_trigger,
         pg_catalog.has_function_privilege('anon', pg_proc.oid, 'EXECUTE') AS caller_anon_executes,
         pg_catalog.pg_get_userbyid(pg_proc.proowner)::text AS caller_owner,
         COALESCE(array_to_string(pg_proc.proconfig, ' '), 'none') AS caller_config,
         strpos(lower(pg_proc.prosrc), fn_state.qualified_name) > 0 AS is_qualified
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
           WHEN caller_proc.caller_secdef THEN caller_proc.caller_owner <> 'postgres'
           WHEN NOT caller_proc.keeps_authenticated THEN true
           WHEN caller_proc.caller_is_trigger THEN true
           ELSE caller_proc.caller_anon_executes
         END AS needs_stop
  FROM caller_proc
),
policy_hit AS (
  SELECT fn_state.fn_name,
         fn_state.fn_order,
         pg_policies.schemaname AS policy_schema,
         pg_policies.tablename AS policy_table,
         pg_policies.policyname AS policy_name,
         pg_policies.cmd AS policy_command,
         pg_policies.roles::text AS policy_roles,
         CASE
           WHEN fn_state.keeps_authenticated
             THEN NOT (pg_policies.roles <@ ARRAY['authenticated', 'service_role']::name[])
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
         view_source.view_name
  FROM fn_state
  JOIN view_source ON strpos(lower(view_source.view_definition), fn_state.fn_name) > 0
  WHERE left(view_source.view_schema, 3) <> 'pg_'
    AND view_source.view_schema <> 'information_schema'
),
dependent_hit AS (
  SELECT fn_state.fn_name,
         fn_state.fn_order,
         COALESCE(pg_catalog.pg_describe_object(pg_depend.classid, pg_depend.objid, pg_depend.objsubid), 'undescribed') AS dependent_description,
         pg_depend.classid::regclass::text AS dependent_catalog,
         pg_depend.deptype::text AS dependent_type,
         COALESCE(dependent_policy.polroles::regrole[]::text, 'none') AS dependent_roles,
         CASE
           WHEN fn_state.keeps_authenticated
            AND pg_depend.classid = 'pg_policy'::regclass
            AND dependent_policy.polroles <@ ARRAY[
                  pg_catalog.to_regrole('authenticated')::oid,
                  pg_catalog.to_regrole('service_role')::oid
                ]
             THEN false
           ELSE true
         END AS needs_stop
  FROM fn_state
  JOIN pg_catalog.pg_depend
    ON pg_depend.refclassid = 'pg_proc'::regclass
   AND pg_depend.refobjid = fn_state.fn_oid
  LEFT JOIN pg_catalog.pg_policy AS dependent_policy
    ON pg_depend.classid = 'pg_policy'::regclass
   AND dependent_policy.oid = pg_depend.objid
  WHERE fn_state.fn_oid IS NOT NULL
),
report AS (
  SELECT 0 AS sort_order,
         'READ ME' AS item,
         'this session is now read only so run the migration in a NEW tab' AS detail

  UNION ALL
  SELECT 5,
         'Q0 type vector',
         CASE
           WHEN pg_catalog.to_regtype('vector') IS NULL THEN 'unresolved on this search path stop here'
           ELSE 'resolves in schema '
             || (SELECT pg_namespace.nspname::text
                 FROM pg_catalog.pg_type
                 JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pg_type.typnamespace
                 WHERE pg_type.oid = pg_catalog.to_regtype('vector'))
             || ' ok'
         END

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
         'Q4 privileges ' || fn_state.fn_name || ' expected public ' || fn_state.expects_public::text,
         CASE
           WHEN fn_state.fn_oid IS NULL THEN 'missing stop here'
           ELSE 'public ' || pg_catalog.has_function_privilege('public', fn_state.fn_oid, 'EXECUTE')::text
             || ' anon ' || pg_catalog.has_function_privilege('anon', fn_state.fn_oid, 'EXECUTE')::text
             || ' authenticated ' || pg_catalog.has_function_privilege('authenticated', fn_state.fn_oid, 'EXECUTE')::text
             || ' service_role ' || pg_catalog.has_function_privilege('service_role', fn_state.fn_oid, 'EXECUTE')::text
             || CASE
                  WHEN pg_catalog.has_function_privilege('public', fn_state.fn_oid, 'EXECUTE') = fn_state.expects_public
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
           || ' trigger ' || caller_verdict.caller_is_trigger::text
           || ' anon executes ' || caller_verdict.caller_anon_executes::text
           || ' config ' || caller_verdict.caller_config
           || ' qualified ' || caller_verdict.is_qualified::text
           || CASE WHEN caller_verdict.needs_stop THEN ' stop here' ELSE ' ok' END
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
         'command ' || policy_hit.policy_command
           || ' roles ' || policy_hit.policy_roles
           || CASE WHEN policy_hit.needs_stop THEN ' stop here' ELSE ' ok' END
  FROM policy_hit

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 80,
         'Q8 views count ' || fn_state.fn_name,
         (SELECT count(*) FROM view_hit WHERE view_hit.fn_name = fn_state.fn_name)::text
  FROM fn_state

  UNION ALL
  SELECT view_hit.fn_order * 1000 + 81,
         'Q8 view ' || view_hit.view_schema || ' ' || view_hit.view_name || ' of ' || view_hit.fn_name,
         'stop here'
  FROM view_hit

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 90,
         'Q9 cron ' || fn_state.fn_name,
         CASE
           WHEN pg_catalog.to_regclass('cron.job') IS NULL THEN 'cron not installed'
           WHEN strpos(lower(query_to_xml('TABLE cron.job', true, false, '')::text), fn_state.fn_name) > 0
             THEN 'NAMED visible jobs only stop here'
           ELSE 'none visible jobs only'
         END
  FROM fn_state

  UNION ALL
  SELECT fn_state.fn_order * 1000 + 100,
         'Q11 dependents count ' || fn_state.fn_name,
         (SELECT count(*) FROM dependent_hit WHERE dependent_hit.fn_name = fn_state.fn_name)::text
  FROM fn_state

  UNION ALL
  SELECT dependent_hit.fn_order * 1000 + 101,
         'Q11 dependent ' || dependent_hit.dependent_description || ' of ' || dependent_hit.fn_name,
         'catalog ' || dependent_hit.dependent_catalog
           || ' deptype ' || dependent_hit.dependent_type
           || ' roles ' || dependent_hit.dependent_roles
           || CASE WHEN dependent_hit.needs_stop THEN ' stop here' ELSE ' ok' END
  FROM dependent_hit

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
