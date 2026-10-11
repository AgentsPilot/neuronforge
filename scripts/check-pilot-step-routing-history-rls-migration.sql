SET default_transaction_read_only = on;

WITH RECURSIVE target_table AS (
  SELECT pg_class.oid AS table_oid,
         pg_get_userbyid(pg_class.relowner) AS owner_name,
         pg_class.relrowsecurity AS rls_on,
         pg_class.relforcerowsecurity AS force_rls_on,
         pg_class.relacl AS table_acl
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname = 'pilot_step_routing_history'
    AND pg_class.relkind = 'r'
),
view_walk (view_oid, depth) AS (
  SELECT pg_rewrite.ev_class, 1
  FROM target_table
  JOIN pg_depend ON pg_depend.refobjid = target_table.table_oid
  JOIN pg_rewrite ON pg_rewrite.oid = pg_depend.objid
  WHERE pg_depend.classid = 'pg_rewrite'::regclass
    AND pg_depend.refclassid = 'pg_class'::regclass
    AND pg_rewrite.ev_class <> target_table.table_oid
  UNION
  SELECT pg_rewrite.ev_class, view_walk.depth + 1
  FROM view_walk
  JOIN pg_depend ON pg_depend.refobjid = view_walk.view_oid
  JOIN pg_rewrite ON pg_rewrite.oid = pg_depend.objid
  WHERE pg_depend.classid = 'pg_rewrite'::regclass
    AND pg_depend.refclassid = 'pg_class'::regclass
    AND pg_rewrite.ev_class <> view_walk.view_oid
    AND view_walk.depth < 10
),
dependent_views AS (
  SELECT view_walk.view_oid, min(view_walk.depth) AS view_depth
  FROM view_walk
  GROUP BY view_walk.view_oid
),
dependent_view_state AS (
  SELECT dependent_views.view_oid,
         (pg_namespace.nspname || ' ' || pg_class.relname)::text AS qualified_name,
         pg_class.relname::text AS view_name,
         (dependent_views.view_depth = 1
          AND EXISTS (
            SELECT 1
            FROM pg_rewrite AS own_rule
            JOIN pg_depend AS own_dependency ON own_dependency.classid = 'pg_rewrite'::regclass
                                            AND own_dependency.objid = own_rule.oid
                                            AND own_dependency.refclassid = 'pg_class'::regclass
            JOIN pg_class AS pricing_class ON pricing_class.oid = own_dependency.refobjid
            JOIN pg_namespace AS pricing_namespace ON pricing_namespace.oid = pricing_class.relnamespace
            WHERE pricing_namespace.nspname = 'public'
              AND pricing_class.relname = 'ai_model_pricing'
              AND own_rule.ev_class = dependent_views.view_oid
          )) AS is_excluded
  FROM dependent_views
  JOIN pg_class ON pg_class.oid = dependent_views.view_oid
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
),
privilege_list AS (
  SELECT privilege.privilege_name, privilege.privilege_order
  FROM (VALUES
    ('SELECT', 1),
    ('INSERT', 2),
    ('UPDATE', 3),
    ('DELETE', 4),
    ('TRUNCATE', 5),
    ('REFERENCES', 6),
    ('TRIGGER', 7),
    ('MAINTAIN', 8)
  ) AS privilege (privilege_name, privilege_order)
),
role_list AS (
  SELECT listed.role_name, listed.role_order, listed.check_code, listed.keeps_select
  FROM (VALUES
    ('anon', 1, 'C7', false),
    ('authenticated', 2, 'C8', true),
    ('service_role', 3, 'C9', true)
  ) AS listed (role_name, role_order, check_code, keeps_select)
),
captured_views AS (
  SELECT captured.view_name, captured.view_order
  FROM (VALUES
    ('pilot_routing_performance', 1),
    ('pilot_step_type_analysis', 2),
    ('pilot_tier_distribution', 3)
  ) AS captured (view_name, view_order)
),
captured_view_state AS (
  SELECT captured_views.view_name,
         captured_views.view_order,
         pg_class.oid AS view_oid
  FROM captured_views
  LEFT JOIN pg_namespace ON pg_namespace.nspname = 'public'
  LEFT JOIN pg_class ON pg_class.relnamespace = pg_namespace.oid
                    AND pg_class.relname = captured_views.view_name
),
admin_policy AS (
  SELECT pg_policies.policyname
  FROM pg_policies
  WHERE pg_policies.schemaname = 'public'
    AND pg_policies.tablename = 'pilot_step_routing_history'
    AND pg_policies.policyname = 'pilot_step_routing_history_admin_select'
    AND pg_policies.permissive = 'PERMISSIVE'
    AND pg_policies.roles = ARRAY['authenticated']::name[]
    AND pg_policies.cmd = 'SELECT'
    AND strpos(pg_policies.qual, 'is_platform_admin') > 0
    AND pg_policies.with_check IS NULL
),
cleanup_function AS (
  SELECT pg_get_userbyid(pg_proc.proowner) AS owner_name,
         pg_proc.prosecdef AS runs_as_owner
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_proc.proname = 'operator_test_account_cleanup'
),
slice_two_view AS (
  SELECT pg_class.oid AS view_oid,
         COALESCE(array_to_string(pg_class.reloptions, ' '), 'none') AS view_options
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname = 'pilot_cost_savings_summary'
),
checks AS (
  SELECT 100 AS sort_order,
         'C1 table exists' AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM target_table) THEN 'PASS' ELSE 'FAIL' END AS result,
         CASE WHEN EXISTS (SELECT 1 FROM target_table) THEN 'present' ELSE 'missing' END AS detail

  UNION ALL
  SELECT 200, 'C2 row security on',
         CASE WHEN COALESCE((SELECT target_table.rls_on FROM target_table), false) THEN 'PASS' ELSE 'FAIL' END,
         'rls ' || COALESCE((SELECT target_table.rls_on::text FROM target_table), 'missing')

  UNION ALL
  SELECT 300, 'C3 row security not forced',
         CASE WHEN (SELECT target_table.force_rls_on FROM target_table) = false THEN 'PASS' ELSE 'FAIL' END,
         'force ' || COALESCE((SELECT target_table.force_rls_on::text FROM target_table), 'missing')

  UNION ALL
  SELECT 400, 'C4 owner is postgres',
         CASE WHEN (SELECT target_table.owner_name FROM target_table) = 'postgres' THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT target_table.owner_name::text FROM target_table), 'missing')

  UNION ALL
  SELECT 500, 'C5 exactly one policy',
         CASE WHEN (SELECT count(*) FROM pg_policies
                    WHERE pg_policies.schemaname = 'public'
                      AND pg_policies.tablename = 'pilot_step_routing_history') = 1 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM pg_policies
          WHERE pg_policies.schemaname = 'public'
            AND pg_policies.tablename = 'pilot_step_routing_history')::text || ' found'

  UNION ALL
  SELECT 600, 'C6 admin select policy for authenticated calls is_platform_admin',
         CASE WHEN EXISTS (SELECT 1 FROM admin_policy) THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN EXISTS (SELECT 1 FROM admin_policy) THEN 'present' ELSE 'missing or wrong shape' END

  UNION ALL
  SELECT 700 + role_list.role_order * 10 + privilege_list.privilege_order,
         role_list.check_code || ' ' || role_list.role_name || ' ' || privilege_list.privilege_name,
         CASE
           WHEN NOT EXISTS (SELECT 1 FROM target_table) THEN 'FAIL'
           WHEN has_table_privilege(role_list.role_name, (SELECT target_table.table_oid FROM target_table), privilege_list.privilege_name)
                = (role_list.keeps_select AND privilege_list.privilege_name = 'SELECT') THEN 'PASS'
           ELSE 'FAIL'
         END,
         CASE
           WHEN NOT EXISTS (SELECT 1 FROM target_table) THEN 'table missing'
           ELSE 'held ' || has_table_privilege(role_list.role_name, (SELECT target_table.table_oid FROM target_table), privilege_list.privilege_name)::text
                || ' expected ' || (role_list.keeps_select AND privilege_list.privilege_name = 'SELECT')::text
         END
  FROM role_list
  CROSS JOIN privilege_list

  UNION ALL
  SELECT 1000, 'C10 no PUBLIC entry in the table acl',
         CASE WHEN EXISTS (SELECT 1 FROM target_table)
                   AND NOT EXISTS (SELECT 1 FROM target_table
                                   CROSS JOIN LATERAL aclexplode(target_table.table_acl) AS acl_item
                                   WHERE acl_item.grantee = 0)
              THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT target_table.table_acl::text FROM target_table), 'default acl')

  UNION ALL
  SELECT 1100, 'C11 no column privileges on the table',
         CASE WHEN EXISTS (SELECT 1 FROM target_table)
                   AND NOT EXISTS (SELECT 1 FROM target_table
                                   JOIN pg_attribute ON pg_attribute.attrelid = target_table.table_oid
                                   WHERE pg_attribute.attnum > 0
                                     AND NOT pg_attribute.attisdropped
                                     AND pg_attribute.attacl IS NOT NULL)
              THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM target_table
          JOIN pg_attribute ON pg_attribute.attrelid = target_table.table_oid
          WHERE pg_attribute.attnum > 0
            AND NOT pg_attribute.attisdropped
            AND pg_attribute.attacl IS NOT NULL)::text || ' columns with privileges'

  UNION ALL
  SELECT 1200, 'C12 owner postgres still holds DELETE',
         CASE WHEN COALESCE(has_table_privilege('postgres', (SELECT target_table.table_oid FROM target_table), 'DELETE'), false)
              THEN 'PASS' ELSE 'FAIL' END,
         'held ' || COALESCE(has_table_privilege('postgres', (SELECT target_table.table_oid FROM target_table), 'DELETE')::text, 'table missing')

  UNION ALL
  SELECT 1300 + captured_view_state.view_order * 10,
         'C13 no client privilege on view ' || captured_view_state.view_name,
         CASE
           WHEN captured_view_state.view_oid IS NULL THEN 'FAIL'
           WHEN EXISTS (SELECT 1 FROM privilege_list
                        WHERE has_table_privilege('anon', captured_view_state.view_oid, privilege_list.privilege_name)
                           OR has_table_privilege('authenticated', captured_view_state.view_oid, privilege_list.privilege_name))
             THEN 'FAIL'
           ELSE 'PASS'
         END,
         CASE
           WHEN captured_view_state.view_oid IS NULL THEN 'view missing'
           ELSE (SELECT count(*) FROM privilege_list
                 WHERE has_table_privilege('anon', captured_view_state.view_oid, privilege_list.privilege_name)
                    OR has_table_privilege('authenticated', captured_view_state.view_oid, privilege_list.privilege_name))::text
                || ' client privileges found'
         END
  FROM captured_view_state

  UNION ALL
  SELECT 1301 + captured_view_state.view_order * 10,
         'C13 service_role keeps SELECT on view ' || captured_view_state.view_name,
         CASE WHEN captured_view_state.view_oid IS NOT NULL
                   AND has_table_privilege('service_role', captured_view_state.view_oid, 'SELECT')
              THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN captured_view_state.view_oid IS NULL THEN 'view missing'
              ELSE 'held ' || has_table_privilege('service_role', captured_view_state.view_oid, 'SELECT')::text
         END
  FROM captured_view_state

  UNION ALL
  SELECT 1400, 'C14 dependent views other than the excluded one match the capture',
         CASE WHEN ARRAY(SELECT dependent_view_state.qualified_name FROM dependent_view_state
                         WHERE NOT dependent_view_state.is_excluded
                         ORDER BY dependent_view_state.qualified_name COLLATE "C")
                   = ARRAY['public pilot_routing_performance', 'public pilot_step_type_analysis', 'public pilot_tier_distribution']::text[]
              THEN 'PASS' ELSE 'FAIL' END,
         COALESCE(array_to_string(ARRAY(SELECT dependent_view_state.qualified_name FROM dependent_view_state
                                        WHERE NOT dependent_view_state.is_excluded
                                        ORDER BY dependent_view_state.qualified_name COLLATE "C"), ' and '), 'none')

  UNION ALL
  SELECT 1401, 'C14 exactly one depth 1 view reads ai_model_pricing directly',
         CASE WHEN (SELECT count(*) FROM dependent_view_state WHERE dependent_view_state.is_excluded) = 1
              THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM dependent_view_state WHERE dependent_view_state.is_excluded)::text || ' found'

  UNION ALL
  SELECT 1500, 'C15 cleanup function owned by postgres and runs as owner',
         CASE WHEN (SELECT count(*) FROM cleanup_function) = 1
                   AND (SELECT cleanup_function.owner_name = 'postgres' AND cleanup_function.runs_as_owner FROM cleanup_function)
              THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT 'owner ' || cleanup_function.owner_name || ' runs as owner ' || cleanup_function.runs_as_owner::text
                   FROM cleanup_function LIMIT 1), 'missing')
           || ' count ' || (SELECT count(*) FROM cleanup_function)::text

  UNION ALL
  SELECT 1600, 'C16 the excluded view is pilot_cost_savings_summary',
         CASE WHEN ARRAY(SELECT dependent_view_state.view_name FROM dependent_view_state
                         WHERE dependent_view_state.is_excluded)
                   = ARRAY['pilot_cost_savings_summary']::text[]
              THEN 'PASS' ELSE 'FAIL' END,
         COALESCE(array_to_string(ARRAY(SELECT dependent_view_state.view_name FROM dependent_view_state
                                        WHERE dependent_view_state.is_excluded
                                        ORDER BY dependent_view_state.view_name COLLATE "C"), ' and '), 'none')

  UNION ALL
  SELECT 1700, 'INFO slice 2 view pilot_cost_savings_summary',
         'INFO',
         CASE WHEN NOT EXISTS (SELECT 1 FROM slice_two_view) THEN 'missing'
              ELSE (SELECT 'options ' || slice_two_view.view_options
                           || ' anon select ' || has_table_privilege('anon', slice_two_view.view_oid, 'SELECT')::text
                           || ' authenticated select ' || has_table_privilege('authenticated', slice_two_view.view_oid, 'SELECT')::text
                    FROM slice_two_view)
         END

  UNION ALL
  SELECT 1800, 'INFO checked at utc', 'INFO', (now() AT TIME ZONE 'UTC')::text
)
SELECT report.check_name, report.result, report.detail
FROM (
  SELECT 0 AS sort_order,
         'VERDICT' AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.result = 'FAIL') THEN 'FAIL' ELSE 'PASS' END AS result,
         (SELECT count(*) FROM checks WHERE checks.result = 'PASS') || ' pass '
           || (SELECT count(*) FROM checks WHERE checks.result = 'FAIL') || ' fail '
           || (SELECT count(*) FROM checks WHERE checks.result = 'INFO') || ' info' AS detail
  UNION ALL
  SELECT checks.sort_order, checks.check_name, checks.result, checks.detail FROM checks
) AS report
ORDER BY report.sort_order;
