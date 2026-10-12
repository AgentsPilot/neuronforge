SET default_transaction_read_only = on;

WITH target_table AS (
  SELECT pg_class.oid AS table_oid,
         pg_class.relrowsecurity AS rls_on,
         pg_class.relforcerowsecurity AS force_rls_on,
         pg_class.relacl AS table_acl
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname = 'token_usage'
    AND pg_class.relkind = 'r'
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
  SELECT listed.role_name, listed.role_order, listed.check_code
  FROM (VALUES
    ('anon', 1, 'C5'),
    ('authenticated', 2, 'C6'),
    ('service_role', 3, 'C7')
  ) AS listed (role_name, role_order, check_code)
),
privilege_state AS (
  SELECT role_list.role_name,
         role_list.role_order,
         role_list.check_code,
         privilege_list.privilege_name,
         COALESCE(has_table_privilege(role_list.role_name, target_table.table_oid, privilege_list.privilege_name), false) AS is_held,
         CASE role_list.role_name
           WHEN 'anon' THEN false
           WHEN 'authenticated' THEN privilege_list.privilege_name IN ('SELECT', 'INSERT')
           ELSE true
         END AS is_expected
  FROM role_list
  CROSS JOIN privilege_list
  LEFT JOIN target_table ON true
),
privilege_checks AS (
  SELECT privilege_state.role_name,
         privilege_state.role_order,
         privilege_state.check_code,
         COALESCE(
           string_agg(privilege_state.privilege_name || CASE WHEN privilege_state.is_held THEN ' held' ELSE ' missing' END,
                      ' ' ORDER BY privilege_state.privilege_name COLLATE "C")
             FILTER (WHERE privilege_state.is_held <> privilege_state.is_expected),
           'none'
         ) AS mismatch_list
  FROM privilege_state
  GROUP BY privilege_state.role_name, privilege_state.role_order, privilege_state.check_code
),
live_policies AS (
  SELECT pg_policies.policyname::text AS policy_name,
         pg_policies.permissive,
         pg_policies.roles,
         pg_policies.cmd,
         pg_policies.qual,
         pg_policies.with_check
  FROM pg_policies
  WHERE pg_policies.schemaname = 'public'
    AND pg_policies.tablename = 'token_usage'
),
checks AS (
  SELECT 1 AS sort_order,
         'C1 row security on and not forced' AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM target_table WHERE target_table.rls_on AND NOT target_table.force_rls_on) THEN 'PASS' ELSE 'FAIL' END AS result,
         COALESCE((SELECT 'rls ' || target_table.rls_on::text || ' force ' || target_table.force_rls_on::text FROM target_table), 'table missing') AS detail

  UNION ALL
  SELECT 2,
         'C2 exactly two policies',
         CASE WHEN (SELECT count(*) FROM live_policies) = 2 THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT string_agg(live_policies.policy_name, ' and ' ORDER BY live_policies.policy_name COLLATE "C") FROM live_policies), 'no policies')

  UNION ALL
  SELECT 3,
         'C3 owner select policy for authenticated',
         CASE WHEN EXISTS (
                SELECT 1 FROM live_policies
                WHERE live_policies.policy_name = 'token_usage_owner_select'
                  AND live_policies.permissive = 'PERMISSIVE'
                  AND live_policies.roles = ARRAY['authenticated']::name[]
                  AND live_policies.cmd = 'SELECT'
                  AND md5(live_policies.qual) = 'ff452c766f1dd1d84c376129b36406c1'
                  AND live_policies.with_check IS NULL)
              THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT live_policies.qual FROM live_policies WHERE live_policies.policy_name = 'token_usage_owner_select'), 'missing')

  UNION ALL
  SELECT 4,
         'C4 owner insert policy for authenticated',
         CASE WHEN EXISTS (
                SELECT 1 FROM live_policies
                WHERE live_policies.policy_name = 'token_usage_owner_insert'
                  AND live_policies.permissive = 'PERMISSIVE'
                  AND live_policies.roles = ARRAY['authenticated']::name[]
                  AND live_policies.cmd = 'INSERT'
                  AND live_policies.qual IS NULL
                  AND md5(live_policies.with_check) = 'ff452c766f1dd1d84c376129b36406c1')
              THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT live_policies.with_check FROM live_policies WHERE live_policies.policy_name = 'token_usage_owner_insert'), 'missing')

  UNION ALL
  SELECT 4 + privilege_checks.role_order,
         privilege_checks.check_code || ' ' || privilege_checks.role_name || ' privileges as planned',
         CASE WHEN privilege_checks.mismatch_list = 'none' THEN 'PASS' ELSE 'FAIL' END,
         'mismatches ' || privilege_checks.mismatch_list
  FROM privilege_checks

  UNION ALL
  SELECT 8,
         'C8 PUBLIC holds nothing',
         CASE WHEN EXISTS (SELECT 1 FROM target_table)
                   AND NOT EXISTS (
                     SELECT 1 FROM target_table
                     CROSS JOIN LATERAL aclexplode(target_table.table_acl) AS acl_item
                     WHERE acl_item.grantee = 0)
              THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT target_table.table_acl::text FROM target_table), 'table missing')

  UNION ALL
  SELECT 9,
         'C9 no column privileges',
         CASE WHEN EXISTS (SELECT 1 FROM target_table)
                   AND NOT EXISTS (
                     SELECT 1 FROM target_table
                     JOIN pg_attribute ON pg_attribute.attrelid = target_table.table_oid
                     WHERE pg_attribute.attnum > 0
                       AND NOT pg_attribute.attisdropped
                       AND pg_attribute.attacl IS NOT NULL)
              THEN 'PASS' ELSE 'FAIL' END,
         'columns with an acl must be 0'

  UNION ALL
  SELECT 10,
         'C10 postgres keeps DELETE',
         CASE WHEN COALESCE((SELECT has_table_privilege('postgres', target_table.table_oid, 'DELETE') FROM target_table), false) THEN 'PASS' ELSE 'FAIL' END,
         'owner path for cleanup and purge'

  UNION ALL
  SELECT 11,
         'C11 the six legacy policies are gone',
         CASE WHEN NOT EXISTS (
                SELECT 1 FROM live_policies
                WHERE live_policies.policy_name IN (
                  'Users can insert their own token usage',
                  'Users can view their own token usage',
                  'token_usage_delete_policy',
                  'token_usage_insert_policy',
                  'token_usage_select_policy',
                  'token_usage_update_policy'))
              THEN 'PASS' ELSE 'FAIL' END,
         'dropped by name'

  UNION ALL
  SELECT 901,
         'INFO views still open to anon until slice 1b',
         'INFO',
         COALESCE(
           (SELECT string_agg(open_views.view_name || ' anon select ' || has_table_privilege('anon', open_views.view_oid, 'SELECT')::text,
                              ' and ' ORDER BY open_views.view_name COLLATE "C")
            FROM (SELECT pg_class.oid AS view_oid, pg_class.relname::text AS view_name
                  FROM pg_class
                  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
                  WHERE pg_namespace.nspname = 'public'
                    AND pg_class.relname IN ('daily_token_usage', 'monthly_token_usage', 'agent_executions_with_details')) AS open_views),
           'none found')
)
SELECT 0 AS sort_order,
       'VERDICT' AS check_name,
       CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.result = 'FAIL') THEN 'FAIL' ELSE 'PASS' END AS result,
       (SELECT count(*) FROM checks WHERE checks.result = 'PASS')::text || ' pass '
         || (SELECT count(*) FROM checks WHERE checks.result = 'FAIL')::text || ' fail' AS detail
UNION ALL
SELECT checks.sort_order, checks.check_name, checks.result, checks.detail
FROM checks
ORDER BY 1, 2;
