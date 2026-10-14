SET default_transaction_read_only = on;

WITH watched AS (
  SELECT watched_row.view_name, watched_row.view_regclass, watched_row.view_order
  FROM (VALUES
    ('monthly_token_usage', 'public.monthly_token_usage', 1),
    ('daily_token_usage', 'public.daily_token_usage', 2),
    ('agent_executions_with_details', 'public.agent_executions_with_details', 3),
    ('agent_memory_stats', 'public.agent_memory_stats', 4),
    ('calculator_config', 'public.calculator_config', 5),
    ('agent_intensity_distribution', 'public.agent_intensity_distribution', 6),
    ('top_complex_agents', 'public.top_complex_agents', 7),
    ('token_prediction_accuracy', 'public.token_prediction_accuracy', 8),
    ('calibration_success_metrics', 'public.calibration_success_metrics', 9),
    ('production_workflow_health', 'public.production_workflow_health', 10),
    ('v6_quality_trends', 'public.v6_quality_trends', 11),
    ('error_pattern_summary', 'public.error_pattern_summary', 12),
    ('website_analytics_summary', 'public.website_analytics_summary', 13)
  ) AS watched_row (view_name, view_regclass, view_order)
),
slice_view AS (
  SELECT watched.view_name,
         watched.view_order,
         pg_catalog.to_regclass(watched.view_regclass) AS view_oid
  FROM watched
),
view_state AS (
  SELECT slice_view.view_name,
         slice_view.view_order,
         slice_view.view_oid,
         pg_class.relkind::text AS kind_code,
         pg_class.reltype AS row_type,
         pg_catalog.pg_get_userbyid(pg_class.relowner)::text AS owner_name,
         COALESCE((SELECT view_option.option_value
                   FROM pg_catalog.pg_options_to_table(pg_class.reloptions) AS view_option
                   WHERE view_option.option_name = 'security_invoker'), 'unset') AS invoker_setting
  FROM slice_view
  LEFT JOIN pg_catalog.pg_class ON pg_class.oid = slice_view.view_oid
),
watched_role AS (
  SELECT role_row.role_name, role_row.role_order
  FROM (VALUES
    ('public', 1),
    ('anon', 2),
    ('authenticated', 3),
    ('service_role', 4)
  ) AS role_row (role_name, role_order)
),
watched_privilege AS (
  SELECT privilege_row.privilege_name
  FROM (VALUES
    ('SELECT', 0),
    ('INSERT', 0),
    ('UPDATE', 0),
    ('DELETE', 0),
    ('TRUNCATE', 0),
    ('REFERENCES', 0),
    ('TRIGGER', 0),
    ('MAINTAIN', 170000)
  ) AS privilege_row (privilege_name, min_version)
  WHERE pg_catalog.current_setting('server_version_num')::int >= privilege_row.min_version
),
role_held AS (
  SELECT view_state.view_name,
         view_state.view_order,
         watched_role.role_name,
         watched_role.role_order,
         watched_privilege.privilege_name,
         pg_catalog.has_table_privilege(watched_role.role_name, view_state.view_oid, watched_privilege.privilege_name) AS is_held
  FROM view_state
  CROSS JOIN watched_role
  CROSS JOIN watched_privilege
  WHERE view_state.view_oid IS NOT NULL
),
role_summary AS (
  SELECT role_held.view_name,
         role_held.view_order,
         role_held.role_name,
         role_held.role_order,
         count(*) AS privilege_total,
         count(*) FILTER (WHERE role_held.is_held) AS held_total,
         COALESCE(string_agg(role_held.privilege_name, ' ' ORDER BY role_held.privilege_name COLLATE "C")
                    FILTER (WHERE role_held.is_held), 'none') AS held_list
  FROM role_held
  GROUP BY role_held.view_name, role_held.view_order, role_held.role_name, role_held.role_order
),
acl_entry AS (
  SELECT view_state.view_name,
         view_state.view_order,
         CASE WHEN acl_row.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl_row.grantee)::text END AS grantee_name,
         pg_catalog.pg_get_userbyid(acl_row.grantor)::text AS grantor_name,
         acl_row.privilege_type
  FROM view_state
  JOIN pg_catalog.pg_class ON pg_class.oid = view_state.view_oid
  CROSS JOIN LATERAL pg_catalog.aclexplode(pg_class.relacl) AS acl_row
),
grantor_summary AS (
  SELECT acl_entry.view_name,
         acl_entry.view_order,
         acl_entry.grantee_name,
         acl_entry.grantor_name,
         string_agg(acl_entry.privilege_type, ' ' ORDER BY acl_entry.privilege_type COLLATE "C") AS privilege_list
  FROM acl_entry
  WHERE acl_entry.grantee_name IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
  GROUP BY acl_entry.view_name, acl_entry.view_order, acl_entry.grantee_name, acl_entry.grantor_name
),
dependent AS (
  SELECT view_state.view_name,
         view_state.view_order,
         pg_catalog.pg_describe_object(pg_depend.classid, pg_depend.objid, pg_depend.objsubid) AS dependent_name,
         EXISTS (SELECT 1
                 FROM pg_catalog.pg_rewrite
                 JOIN slice_view AS other_view ON other_view.view_oid = pg_rewrite.ev_class
                 WHERE pg_depend.classid = 'pg_rewrite'::regclass
                   AND pg_rewrite.oid = pg_depend.objid) AS is_inside_slice
  FROM view_state
  JOIN pg_catalog.pg_depend
    ON pg_depend.refclassid = 'pg_class'::regclass
   AND pg_depend.refobjid = view_state.view_oid
  WHERE NOT (pg_depend.classid = 'pg_type'::regclass AND pg_depend.objid = view_state.row_type)
    AND NOT (pg_depend.classid = 'pg_rewrite'::regclass
             AND EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite
                         WHERE pg_rewrite.oid = pg_depend.objid
                           AND pg_rewrite.ev_class = view_state.view_oid))
),
function_mention AS (
  SELECT watched.view_name,
         watched.view_order,
         pg_proc.oid::regprocedure::text AS function_name
  FROM watched
  JOIN pg_catalog.pg_proc ON strpos(pg_proc.prosrc, watched.view_name) > 0
  JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname NOT IN ('pg_catalog', 'information_schema')
),
policy_mention AS (
  SELECT watched.view_name,
         watched.view_order,
         pg_policies.schemaname || ' ' || pg_policies.tablename || ' ' || pg_policies.policyname AS policy_name
  FROM watched
  JOIN pg_catalog.pg_policies
    ON strpos(COALESCE(pg_policies.qual, ''), watched.view_name) > 0
    OR strpos(COALESCE(pg_policies.with_check, ''), watched.view_name) > 0
),
other_view_mention AS (
  SELECT watched.view_name,
         watched.view_order,
         pg_views.schemaname || ' ' || pg_views.viewname AS mentioning_view,
         (pg_views.schemaname = 'public'
          AND pg_views.viewname IN (SELECT inner_watched.view_name FROM watched AS inner_watched)) AS is_inside_slice
  FROM watched
  JOIN pg_catalog.pg_views
    ON strpos(pg_views.definition, watched.view_name) > 0
   AND pg_views.viewname <> watched.view_name
),
base_relation AS (
  SELECT DISTINCT view_state.view_name,
         view_state.view_order,
         pg_namespace.nspname || ' ' || pg_class.relname AS relation_label,
         pg_class.relkind::text AS relation_kind,
         pg_class.relrowsecurity AS relation_rls,
         pg_catalog.has_table_privilege('service_role', pg_class.oid, 'SELECT')
           AND pg_catalog.has_schema_privilege('service_role', pg_namespace.oid, 'USAGE') AS service_role_reads
  FROM view_state
  JOIN pg_catalog.pg_rewrite ON pg_rewrite.ev_class = view_state.view_oid
  JOIN pg_catalog.pg_depend
    ON pg_depend.classid = 'pg_rewrite'::regclass
   AND pg_depend.objid = pg_rewrite.oid
   AND pg_depend.refclassid = 'pg_class'::regclass
   AND pg_depend.refobjid <> view_state.view_oid
  JOIN pg_catalog.pg_class ON pg_class.oid = pg_depend.refobjid
  JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pg_class.relnamespace
),
base_function AS (
  SELECT DISTINCT view_state.view_name,
         view_state.view_order,
         pg_proc.oid::regprocedure::text AS function_name,
         pg_proc.prosecdef AS runs_as_owner,
         pg_catalog.has_function_privilege('service_role', pg_proc.oid, 'EXECUTE') AS service_role_runs
  FROM view_state
  JOIN pg_catalog.pg_rewrite ON pg_rewrite.ev_class = view_state.view_oid
  JOIN pg_catalog.pg_depend
    ON pg_depend.classid = 'pg_rewrite'::regclass
   AND pg_depend.objid = pg_rewrite.oid
   AND pg_depend.refclassid = 'pg_proc'::regclass
  JOIN pg_catalog.pg_proc ON pg_proc.oid = pg_depend.refobjid
),
column_acl AS (
  SELECT view_state.view_name,
         view_state.view_order,
         (SELECT count(*)
          FROM pg_catalog.pg_attribute
          WHERE pg_attribute.attrelid = view_state.view_oid
            AND pg_attribute.attnum > 0
            AND NOT pg_attribute.attisdropped
            AND pg_attribute.attacl IS NOT NULL) AS column_acl_total
  FROM view_state
  WHERE view_state.view_oid IS NOT NULL
),
report AS (
  SELECT 1 AS sort_order,
         'Q0 server version' AS item,
         pg_catalog.current_setting('server_version_num')
           || CASE WHEN pg_catalog.current_setting('server_version_num')::int >= 170000 THEN ' ok' ELSE ' below 17 stop here' END AS detail

  UNION ALL
  SELECT 2,
         'Q0 can switch to service_role',
         CASE WHEN pg_catalog.pg_has_role('service_role', 'SET')
              THEN 'yes ok'
              ELSE 'no so the migration read probe would fail stop here' END

  UNION ALL
  SELECT view_state.view_order * 1000 + 1,
         'Q1 exists ' || view_state.view_name,
         CASE WHEN view_state.view_oid IS NULL THEN 'missing stop here'
              WHEN view_state.kind_code <> 'v' THEN 'not a plain view kind ' || view_state.kind_code || ' stop here'
              ELSE 'present plain view' END
  FROM view_state

  UNION ALL
  SELECT view_state.view_order * 1000 + 2,
         'Q2 owner ' || view_state.view_name,
         COALESCE(view_state.owner_name, 'missing')
           || CASE WHEN view_state.owner_name = 'postgres' THEN ' ok' ELSE ' expected postgres stop here' END
  FROM view_state

  UNION ALL
  SELECT view_state.view_order * 1000 + 3,
         'Q3 security invoker ' || view_state.view_name,
         view_state.invoker_setting
           || CASE WHEN view_state.invoker_setting = 'unset' THEN ' ok matches the rollback'
                   ELSE ' expected unset stop here' END
  FROM view_state

  UNION ALL
  SELECT role_summary.view_order * 1000 + 10 + role_summary.role_order,
         'Q4 privileges ' || role_summary.role_name || ' ' || role_summary.view_name,
         role_summary.held_total::text || ' of ' || role_summary.privilege_total::text || ' held ' || role_summary.held_list
           || CASE
                WHEN role_summary.role_name IN ('anon', 'authenticated') AND role_summary.held_total = role_summary.privilege_total
                  THEN ' ALL matches the rollback'
                WHEN role_summary.role_name IN ('anon', 'authenticated')
                  THEN ' differs from ALL so adjust the rollback to this list'
                WHEN role_summary.role_name = 'public' AND role_summary.held_total = 0 THEN ' none as expected'
                WHEN role_summary.role_name = 'public' THEN ' unexpected so adjust the rollback to this list'
                WHEN role_summary.role_name = 'service_role' AND role_summary.held_total > 0 THEN ' kept by the migration'
                ELSE ' service_role holds nothing stop here'
              END
  FROM role_summary

  UNION ALL
  SELECT grantor_summary.view_order * 1000 + 20,
         'Q5 grant ' || grantor_summary.grantee_name || ' ' || grantor_summary.view_name,
         'by ' || grantor_summary.grantor_name || ' ' || grantor_summary.privilege_list
           || CASE WHEN grantor_summary.grantor_name = 'postgres' THEN ''
                   ELSE ' OTHER GRANTOR stop here' END
  FROM grantor_summary

  UNION ALL
  SELECT view_state.view_order * 1000 + 30,
         'Q6 dependents count ' || view_state.view_name,
         (SELECT count(*) FROM dependent
          WHERE dependent.view_name = view_state.view_name AND NOT dependent.is_inside_slice)::text
           || CASE WHEN (SELECT count(*) FROM dependent
                         WHERE dependent.view_name = view_state.view_name AND NOT dependent.is_inside_slice) = 0
                   THEN ' outside the slice ok' ELSE ' outside the slice stop here' END
  FROM view_state

  UNION ALL
  SELECT dependent.view_order * 1000 + 31,
         'Q6 dependent ' || dependent.view_name,
         dependent.dependent_name
           || CASE WHEN dependent.is_inside_slice THEN ' inside the slice ok' ELSE ' stop here' END
  FROM dependent

  UNION ALL
  SELECT watched.view_order * 1000 + 40,
         'Q7 function mentions count ' || watched.view_name,
         (SELECT count(*) FROM function_mention WHERE function_mention.view_name = watched.view_name)::text
           || CASE WHEN (SELECT count(*) FROM function_mention WHERE function_mention.view_name = watched.view_name) = 0
                   THEN ' ok' ELSE ' stop here' END
  FROM watched

  UNION ALL
  SELECT function_mention.view_order * 1000 + 41,
         'Q7 function mention ' || function_mention.view_name,
         function_mention.function_name || ' stop here'
  FROM function_mention

  UNION ALL
  SELECT watched.view_order * 1000 + 50,
         'Q8 policy mentions count ' || watched.view_name,
         (SELECT count(*) FROM policy_mention WHERE policy_mention.view_name = watched.view_name)::text
           || CASE WHEN (SELECT count(*) FROM policy_mention WHERE policy_mention.view_name = watched.view_name) = 0
                   THEN ' ok' ELSE ' stop here' END
  FROM watched

  UNION ALL
  SELECT policy_mention.view_order * 1000 + 51,
         'Q8 policy mention ' || policy_mention.view_name,
         policy_mention.policy_name || ' stop here'
  FROM policy_mention

  UNION ALL
  SELECT watched.view_order * 1000 + 60,
         'Q9 other view mentions count ' || watched.view_name,
         (SELECT count(*) FROM other_view_mention
          WHERE other_view_mention.view_name = watched.view_name AND NOT other_view_mention.is_inside_slice)::text
           || CASE WHEN (SELECT count(*) FROM other_view_mention
                         WHERE other_view_mention.view_name = watched.view_name AND NOT other_view_mention.is_inside_slice) = 0
                   THEN ' outside the slice ok' ELSE ' outside the slice stop here' END
  FROM watched

  UNION ALL
  SELECT other_view_mention.view_order * 1000 + 61,
         'Q9 other view mention ' || other_view_mention.view_name,
         other_view_mention.mentioning_view
           || CASE WHEN other_view_mention.is_inside_slice THEN ' inside the slice ok' ELSE ' stop here' END
  FROM other_view_mention

  UNION ALL
  SELECT base_relation.view_order * 1000 + 70,
         'Q10 reads ' || base_relation.view_name,
         base_relation.relation_label || ' kind ' || base_relation.relation_kind
           || ' rls ' || base_relation.relation_rls::text
           || CASE WHEN base_relation.service_role_reads THEN ' service_role reads ok'
                   ELSE ' service_role cannot read so the migration would refuse stop here' END
  FROM base_relation

  UNION ALL
  SELECT base_function.view_order * 1000 + 80,
         'Q11 calls ' || base_function.view_name,
         base_function.function_name
           || CASE WHEN base_function.runs_as_owner THEN ' runs as owner' ELSE ' runs as caller' END
           || CASE WHEN base_function.service_role_runs THEN ' service_role runs ok'
                   ELSE ' service_role cannot run so the migration would refuse stop here' END
  FROM base_function

  UNION ALL
  SELECT column_acl.view_order * 1000 + 90,
         'Q12 column privileges ' || column_acl.view_name,
         column_acl.column_acl_total::text
           || CASE WHEN column_acl.column_acl_total = 0 THEN ' ok'
                   ELSE ' so the migration would refuse stop here' END
  FROM column_acl

  UNION ALL
  SELECT view_state.view_order * 1000 + 95,
         'Q13 writable through the view ' || view_state.view_name,
         CASE WHEN pg_catalog.pg_relation_is_updatable(view_state.view_oid, true) = 0
              THEN 'no information only'
              ELSE 'yes code ' || pg_catalog.pg_relation_is_updatable(view_state.view_oid, true)::text
                || ' information only record for the incident' END
  FROM view_state
  WHERE view_state.view_oid IS NOT NULL
)
SELECT final_report.sort_order, final_report.item, final_report.detail
FROM (
  SELECT 0 AS sort_order,
         'PRECHECK STATUS' AS item,
         CASE
           WHEN (SELECT count(*) FROM report WHERE strpos(report.detail, 'stop here') > 0) > 0
             THEN 'STOP ' || (SELECT count(*) FROM report WHERE strpos(report.detail, 'stop here') > 0)::text
               || ' rows need review'
           WHEN (SELECT count(*) FROM report WHERE strpos(report.detail, 'adjust the rollback') > 0) > 0
             THEN 'CLEAN but adjust the rollback grants to the Q4 lists then run the migration in a NEW tab'
           ELSE 'CLEAN run the migration in a NEW tab'
         END AS detail
  UNION ALL
  SELECT report.sort_order, report.item, report.detail FROM report
) AS final_report
ORDER BY final_report.sort_order, final_report.item;
