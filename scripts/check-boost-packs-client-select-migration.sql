SET default_transaction_read_only = on;

WITH table_state AS (
  SELECT watched.table_name,
         pg_class.oid AS table_oid,
         COALESCE(pg_class.relrowsecurity, false) AS rls_on
  FROM (VALUES ('boost_packs')) AS watched (table_name)
  LEFT JOIN pg_namespace ON pg_namespace.nspname = 'public'
  LEFT JOIN pg_class ON pg_class.relnamespace = pg_namespace.oid
                    AND pg_class.relname = watched.table_name
                    AND pg_class.relkind = 'r'
),
expected_policy_counts AS (
  SELECT expected.table_name, expected.policy_count
  FROM (VALUES
    ('boost_packs', 2)
  ) AS expected (table_name, policy_count)
),
client_roles AS (
  SELECT client.role_name, client.role_order
  FROM (VALUES ('anon', 1), ('authenticated', 2)) AS client (role_name, role_order)
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
client_privileges AS (
  SELECT table_state.table_name,
         client_roles.role_name,
         client_roles.role_order,
         privilege_list.privilege_name,
         privilege_list.privilege_order,
         CASE WHEN table_state.table_oid IS NULL THEN NULL
              ELSE has_table_privilege(client_roles.role_name, table_state.table_oid, privilege_list.privilege_name)
         END AS is_held
  FROM table_state
  CROSS JOIN client_roles
  CROSS JOIN privilege_list
),
column_grants AS (
  SELECT table_state.table_name,
         count(*) FILTER (WHERE grantee_role.rolname IN ('anon', 'authenticated') OR acl_item.grantee = 0) AS total
  FROM table_state
  LEFT JOIN pg_attribute ON pg_attribute.attrelid = table_state.table_oid
                        AND pg_attribute.attnum > 0
                        AND NOT pg_attribute.attisdropped
                        AND pg_attribute.attacl IS NOT NULL
  LEFT JOIN LATERAL aclexplode(pg_attribute.attacl) AS acl_item ON true
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
  GROUP BY table_state.table_name
),
checks AS (
  SELECT 1000 AS sort_order,
         'C1 table exists ' || table_state.table_name AS check_name,
         CASE WHEN table_state.table_oid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result,
         CASE WHEN table_state.table_oid IS NOT NULL THEN 'present' ELSE 'missing' END AS detail
  FROM table_state

  UNION ALL
  SELECT 1001,
         'C2 rls unchanged ' || table_state.table_name,
         CASE WHEN table_state.rls_on THEN 'PASS' ELSE 'FAIL' END,
         'rls ' || table_state.rls_on::text || ' expected true'
  FROM table_state

  UNION ALL
  SELECT 1100 + client_privileges.role_order * 10 + client_privileges.privilege_order,
         'C3 ' || client_privileges.role_name || ' ' || client_privileges.privilege_name || ' ' || client_privileges.table_name,
         CASE
           WHEN client_privileges.is_held IS NULL THEN 'FAIL'
           WHEN client_privileges.is_held THEN 'FAIL'
           ELSE 'PASS'
         END,
         CASE
           WHEN client_privileges.is_held IS NULL THEN 'table missing'
           ELSE 'held ' || client_privileges.is_held::text || ' expected false'
         END
  FROM client_privileges

  UNION ALL
  SELECT 1300,
         'C4 no column grant to anon or authenticated or PUBLIC ' || table_state.table_name,
         CASE WHEN table_state.table_oid IS NOT NULL AND COALESCE(column_grants.total, 0) = 0 THEN 'PASS' ELSE 'FAIL' END,
         COALESCE(column_grants.total, 0)::text || ' found'
  FROM table_state
  LEFT JOIN column_grants ON column_grants.table_name = table_state.table_name

  UNION ALL
  SELECT 1400,
         'C5 policy count unchanged ' || table_state.table_name,
         CASE
           WHEN expected_policy_counts.policy_count < 0 THEN 'FAIL'
           WHEN (SELECT count(*) FROM pg_policies
                 WHERE pg_policies.schemaname = 'public'
                   AND pg_policies.tablename = table_state.table_name) = expected_policy_counts.policy_count
             THEN 'PASS'
           ELSE 'FAIL'
         END,
         CASE
           WHEN expected_policy_counts.policy_count < 0 THEN 'fill in the policy count from pre check Q4 first'
           ELSE (SELECT count(*) FROM pg_policies
                 WHERE pg_policies.schemaname = 'public'
                   AND pg_policies.tablename = table_state.table_name)::text
                || ' found ' || expected_policy_counts.policy_count::text || ' expected'
         END
  FROM table_state
  JOIN expected_policy_counts ON expected_policy_counts.table_name = table_state.table_name

  UNION ALL
  SELECT 9001,
         'C6 service_role keeps SELECT ' || table_state.table_name,
         CASE WHEN COALESCE(has_table_privilege('service_role', table_state.table_oid, 'SELECT'), false)
              THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN table_state.table_oid IS NULL THEN 'table missing'
              ELSE 'held ' || COALESCE(has_table_privilege('service_role', table_state.table_oid, 'SELECT'), false)::text
         END
  FROM table_state
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
