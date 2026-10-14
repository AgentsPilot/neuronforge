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
         pg_catalog.pg_get_userbyid(pg_class.relowner)::text AS owner_name,
         COALESCE((SELECT view_option.option_value
                   FROM pg_catalog.pg_options_to_table(pg_class.reloptions) AS view_option
                   WHERE view_option.option_name = 'security_invoker'), 'unset') AS invoker_setting,
         (SELECT count(*)
          FROM pg_catalog.pg_attribute
          WHERE pg_attribute.attrelid = slice_view.view_oid
            AND pg_attribute.attnum > 0
            AND NOT pg_attribute.attisdropped
            AND pg_attribute.attacl IS NOT NULL) AS column_acl_total
  FROM slice_view
  LEFT JOIN pg_catalog.pg_class ON pg_class.oid = slice_view.view_oid
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
closed_role AS (
  SELECT closed_row.role_name, closed_row.check_order
  FROM (VALUES
    ('anon', 4),
    ('authenticated', 5),
    ('public', 6)
  ) AS closed_row (role_name, check_order)
),
closed_state AS (
  SELECT view_state.view_name,
         view_state.view_order,
         closed_role.role_name,
         closed_role.check_order,
         CASE WHEN view_state.view_oid IS NULL THEN NULL
              ELSE (SELECT count(*) FROM watched_privilege
                    WHERE pg_catalog.has_table_privilege(closed_role.role_name, view_state.view_oid, watched_privilege.privilege_name))
         END AS held_total,
         CASE WHEN view_state.view_oid IS NULL THEN NULL
              ELSE (SELECT string_agg(watched_privilege.privilege_name, ' ' ORDER BY watched_privilege.privilege_name COLLATE "C")
                    FROM watched_privilege
                    WHERE pg_catalog.has_table_privilege(closed_role.role_name, view_state.view_oid, watched_privilege.privilege_name))
         END AS held_list
  FROM view_state
  CROSS JOIN closed_role
),
checks AS (
  SELECT view_state.view_order * 100 + 1 AS sort_order,
         'C1 exists ' || view_state.view_name AS check_name,
         CASE WHEN view_state.view_oid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result,
         CASE WHEN view_state.view_oid IS NOT NULL THEN 'present' ELSE 'missing' END AS detail
  FROM view_state

  UNION ALL
  SELECT view_state.view_order * 100 + 2,
         'C2 owner postgres ' || view_state.view_name,
         CASE WHEN view_state.owner_name = 'postgres' THEN 'PASS' ELSE 'FAIL' END,
         COALESCE(view_state.owner_name, 'missing')
  FROM view_state

  UNION ALL
  SELECT view_state.view_order * 100 + 3,
         'C3 security invoker true ' || view_state.view_name,
         CASE WHEN view_state.invoker_setting = 'true' THEN 'PASS' ELSE 'FAIL' END,
         view_state.invoker_setting || ' expected true'
  FROM view_state

  UNION ALL
  SELECT closed_state.view_order * 100 + closed_state.check_order,
         'C' || closed_state.check_order::text || ' ' || closed_state.role_name || ' no privilege ' || closed_state.view_name,
         CASE WHEN closed_state.held_total = 0 THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN closed_state.held_total IS NULL THEN 'view missing'
              WHEN closed_state.held_total = 0 THEN 'none held'
              ELSE 'held ' || closed_state.held_list END
  FROM closed_state

  UNION ALL
  SELECT view_state.view_order * 100 + 7,
         'C7 service_role select ' || view_state.view_name,
         CASE WHEN view_state.view_oid IS NOT NULL
                   AND pg_catalog.has_table_privilege('service_role', view_state.view_oid, 'SELECT') IS TRUE
              THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN view_state.view_oid IS NULL THEN 'view missing'
              ELSE 'held ' || pg_catalog.has_table_privilege('service_role', view_state.view_oid, 'SELECT')::text
                || ' expected true' END
  FROM view_state

  UNION ALL
  SELECT view_state.view_order * 100 + 8,
         'C8 no column privileges ' || view_state.view_name,
         CASE WHEN view_state.view_oid IS NOT NULL AND view_state.column_acl_total = 0 THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN view_state.view_oid IS NULL THEN 'view missing'
              ELSE view_state.column_acl_total::text || ' columns carry an acl expected 0' END
  FROM view_state
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
