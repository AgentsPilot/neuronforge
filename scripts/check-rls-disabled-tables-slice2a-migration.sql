SET default_transaction_read_only = on;

WITH target_names AS (
  SELECT listed.table_name, listed.table_order, listed.is_read_table
  FROM (VALUES
    ('agent_job_fallback', 1, false),
    ('agent_scheduler_state', 2, false),
    ('ais_normalization_ranges', 3, true),
    ('contact_messages', 4, false),
    ('memory_config', 5, false),
    ('message_replies', 6, false),
    ('pricing_config', 7, false),
    ('storage_plans', 8, false)
  ) AS listed (table_name, table_order, is_read_table)
),
target_tables AS (
  SELECT target_names.table_name,
         target_names.table_order,
         target_names.is_read_table,
         pg_class.oid AS table_oid,
         pg_class.relrowsecurity AS rls_on,
         pg_class.relforcerowsecurity AS force_rls_on,
         pg_class.relacl AS table_acl
  FROM target_names
  LEFT JOIN pg_class ON pg_class.oid = (
    SELECT found_class.oid
    FROM pg_class AS found_class
    JOIN pg_namespace AS found_namespace ON found_namespace.oid = found_class.relnamespace
    WHERE found_namespace.nspname = 'public'
      AND found_class.relname = target_names.table_name
      AND found_class.relkind = 'r'
  )
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
    ('anon', 1, 'C3'),
    ('authenticated', 2, 'C4'),
    ('service_role', 3, 'C5')
  ) AS listed (role_name, role_order, check_code)
),
privilege_state AS (
  SELECT target_tables.table_name,
         target_tables.table_order,
         role_list.role_name,
         role_list.role_order,
         role_list.check_code,
         privilege_list.privilege_name,
         COALESCE(has_table_privilege(role_list.role_name, target_tables.table_oid, privilege_list.privilege_name), false) AS is_held,
         CASE role_list.role_name
           WHEN 'anon' THEN false
           WHEN 'authenticated' THEN (target_tables.is_read_table AND privilege_list.privilege_name = 'SELECT')
           ELSE true
         END AS is_expected
  FROM target_tables
  CROSS JOIN role_list
  CROSS JOIN privilege_list
),
privilege_checks AS (
  SELECT privilege_state.table_name,
         privilege_state.table_order,
         privilege_state.role_name,
         privilege_state.role_order,
         privilege_state.check_code,
         COALESCE(
           string_agg(privilege_state.privilege_name || CASE WHEN privilege_state.is_held THEN ' held' ELSE ' missing' END,
                      ' ' ORDER BY privilege_state.privilege_name COLLATE "C")
             FILTER (WHERE privilege_state.is_held <> privilege_state.is_expected),
           'none'
         ) AS mismatch_list
  FROM privilege_state
  GROUP BY privilege_state.table_name, privilege_state.table_order, privilege_state.role_name,
           privilege_state.role_order, privilege_state.check_code
),
checks AS (
  SELECT 100 * target_tables.table_order + 1 AS sort_order,
         'C1 ' || target_tables.table_name || ' row security on and not forced' AS check_name,
         CASE WHEN target_tables.rls_on AND NOT target_tables.force_rls_on THEN 'PASS' ELSE 'FAIL' END AS result,
         'rls ' || COALESCE(target_tables.rls_on::text, 'missing') || ' force ' || COALESCE(target_tables.force_rls_on::text, 'missing') AS detail
  FROM target_tables

  UNION ALL
  SELECT 100 * target_tables.table_order + 2,
         'C2 ' || target_tables.table_name || ' policy set',
         CASE
           WHEN target_tables.is_read_table
                AND (SELECT count(*) FROM pg_policies
                     WHERE pg_policies.schemaname = 'public'
                       AND pg_policies.tablename = target_tables.table_name) = 1
                AND EXISTS (
                  SELECT 1 FROM pg_policies
                  WHERE pg_policies.schemaname = 'public'
                    AND pg_policies.tablename = target_tables.table_name
                    AND pg_policies.policyname = 'ais_normalization_ranges_authenticated_select'
                    AND pg_policies.permissive = 'PERMISSIVE'
                    AND pg_policies.roles = ARRAY['authenticated']::name[]
                    AND pg_policies.cmd = 'SELECT'
                    AND md5(pg_policies.qual) = 'b326b5062b2f0e69046810717534cb09'
                    AND pg_policies.with_check IS NULL)
             THEN 'PASS'
           WHEN NOT target_tables.is_read_table
                AND (SELECT count(*) FROM pg_policies
                     WHERE pg_policies.schemaname = 'public'
                       AND pg_policies.tablename = target_tables.table_name) = 0
             THEN 'PASS'
           ELSE 'FAIL'
         END,
         COALESCE(
           (SELECT string_agg(pg_policies.policyname || ' ' || pg_policies.cmd || ' roles ' || pg_policies.roles::text,
                              ' and ' ORDER BY pg_policies.policyname COLLATE "C")
            FROM pg_policies
            WHERE pg_policies.schemaname = 'public'
              AND pg_policies.tablename = target_tables.table_name),
           'no policies'
         )
  FROM target_tables

  UNION ALL
  SELECT 100 * privilege_checks.table_order + 2 + privilege_checks.role_order,
         privilege_checks.check_code || ' ' || privilege_checks.table_name || ' ' || privilege_checks.role_name || ' privileges as planned',
         CASE WHEN privilege_checks.mismatch_list = 'none' THEN 'PASS' ELSE 'FAIL' END,
         'mismatches ' || privilege_checks.mismatch_list
  FROM privilege_checks

  UNION ALL
  SELECT 100 * target_tables.table_order + 6,
         'C6 ' || target_tables.table_name || ' PUBLIC holds nothing',
         CASE WHEN target_tables.table_oid IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(target_tables.table_acl) AS acl_item WHERE acl_item.grantee = 0)
              THEN 'PASS' ELSE 'FAIL' END,
         COALESCE(target_tables.table_acl::text, 'default acl')
  FROM target_tables

  UNION ALL
  SELECT 100 * target_tables.table_order + 7,
         'C7 ' || target_tables.table_name || ' no column privileges',
         CASE WHEN target_tables.table_oid IS NOT NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM pg_attribute
                     WHERE pg_attribute.attrelid = target_tables.table_oid
                       AND pg_attribute.attnum > 0
                       AND NOT pg_attribute.attisdropped
                       AND pg_attribute.attacl IS NOT NULL)
              THEN 'PASS' ELSE 'FAIL' END,
         'columns with an acl ' || (SELECT count(*) FROM pg_attribute
                                    WHERE pg_attribute.attrelid = target_tables.table_oid
                                      AND pg_attribute.attnum > 0
                                      AND NOT pg_attribute.attisdropped
                                      AND pg_attribute.attacl IS NOT NULL)::text
  FROM target_tables

  UNION ALL
  SELECT 100 * target_tables.table_order + 8,
         'C8 ' || target_tables.table_name || ' postgres keeps DELETE',
         CASE WHEN COALESCE(has_table_privilege('postgres', target_tables.table_oid, 'DELETE'), false) THEN 'PASS' ELSE 'FAIL' END,
         'owner path for cleanup and purge'
  FROM target_tables

  UNION ALL
  SELECT 901,
         'INFO get_active_ais_ranges authenticated execute',
         'INFO',
         COALESCE(
           (SELECT string_agg(has_function_privilege('authenticated', pg_proc.oid, 'EXECUTE')::text, ' ' ORDER BY pg_proc.oid::text COLLATE "C")
            FROM pg_proc
            JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
            WHERE pg_namespace.nspname = 'public'
              AND pg_proc.proname = 'get_active_ais_ranges'),
           'function missing')
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
