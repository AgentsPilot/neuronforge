SET default_transaction_read_only = on;

WITH watched_tables AS (
  SELECT watched.table_name, watched.table_order, watched.client_reads_kept
  FROM (VALUES
    ('billing_events', 1, false),
    ('boost_pack_purchases', 2, false),
    ('subscription_invoices', 3, false),
    ('processed_webhook_events', 4, false),
    ('boost_packs', 5, true)
  ) AS watched (table_name, table_order, client_reads_kept)
),
expected_policy_counts AS (
  SELECT expected.table_name, expected.policy_count
  FROM (VALUES
    ('billing_events', 2),
    ('boost_pack_purchases', 2),
    ('subscription_invoices', 1),
    ('processed_webhook_events', 0),
    ('boost_packs', 2)
  ) AS expected (table_name, policy_count)
),
table_state AS (
  SELECT watched_tables.table_name,
         watched_tables.table_order,
         watched_tables.client_reads_kept,
         pg_class.oid AS table_oid,
         COALESCE(pg_class.relrowsecurity, false) AS rls_on
  FROM watched_tables
  LEFT JOIN pg_namespace ON pg_namespace.nspname = 'public'
  LEFT JOIN pg_class ON pg_class.relnamespace = pg_namespace.oid
                    AND pg_class.relname = watched_tables.table_name
                    AND pg_class.relkind = 'r'
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
    ('TRIGGER', 7)
  ) AS privilege (privilege_name, privilege_order)
),
client_privileges AS (
  SELECT table_state.table_name,
         table_state.table_order,
         table_state.client_reads_kept,
         table_state.table_oid,
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
service_role_needs AS (
  SELECT needed.table_name, needed.privilege_name, needed.need_order
  FROM (VALUES
    ('processed_webhook_events', 'SELECT', 1),
    ('processed_webhook_events', 'INSERT', 2),
    ('processed_webhook_events', 'UPDATE', 3),
    ('billing_events', 'INSERT', 4),
    ('boost_pack_purchases', 'INSERT', 5),
    ('boost_packs', 'SELECT', 6)
  ) AS needed (table_name, privilege_name, need_order)
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
  SELECT table_state.table_order * 1000 AS sort_order,
         'C1 table exists ' || table_state.table_name AS check_name,
         CASE WHEN table_state.table_oid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result,
         CASE WHEN table_state.table_oid IS NOT NULL THEN 'present' ELSE 'missing' END AS detail
  FROM table_state

  UNION ALL
  SELECT table_state.table_order * 1000 + 1,
         'C2 rls still on ' || table_state.table_name,
         CASE WHEN table_state.rls_on THEN 'PASS' ELSE 'FAIL' END,
         'rls ' || table_state.rls_on::text
  FROM table_state

  UNION ALL
  SELECT client_privileges.table_order * 1000 + 100 + client_privileges.role_order * 10 + client_privileges.privilege_order,
         'C3 ' || client_privileges.role_name || ' ' || client_privileges.privilege_name || ' ' || client_privileges.table_name,
         CASE
           WHEN client_privileges.is_held IS NULL THEN 'FAIL'
           WHEN client_privileges.client_reads_kept AND client_privileges.privilege_name = 'SELECT'
             THEN CASE WHEN client_privileges.is_held THEN 'PASS' ELSE 'FAIL' END
           ELSE CASE WHEN client_privileges.is_held THEN 'FAIL' ELSE 'PASS' END
         END,
         CASE
           WHEN client_privileges.is_held IS NULL THEN 'table missing'
           WHEN client_privileges.client_reads_kept AND client_privileges.privilege_name = 'SELECT'
             THEN 'held ' || client_privileges.is_held::text || ' expected true'
           ELSE 'held ' || client_privileges.is_held::text || ' expected false'
         END
  FROM client_privileges

  UNION ALL
  SELECT table_state.table_order * 1000 + 300,
         'C4 no column grant to anon or authenticated or PUBLIC ' || table_state.table_name,
         CASE WHEN table_state.table_oid IS NOT NULL AND COALESCE(column_grants.total, 0) = 0 THEN 'PASS' ELSE 'FAIL' END,
         COALESCE(column_grants.total, 0)::text || ' found'
  FROM table_state
  LEFT JOIN column_grants ON column_grants.table_name = table_state.table_name

  UNION ALL
  SELECT table_state.table_order * 1000 + 400,
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
  SELECT 9000 + service_role_needs.need_order,
         'C6 service_role keeps ' || service_role_needs.privilege_name || ' ' || service_role_needs.table_name,
         CASE WHEN COALESCE(has_table_privilege('service_role', table_state.table_oid, service_role_needs.privilege_name), false)
              THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN table_state.table_oid IS NULL THEN 'table missing'
              ELSE 'held ' || COALESCE(has_table_privilege('service_role', table_state.table_oid, service_role_needs.privilege_name), false)::text
         END
  FROM service_role_needs
  LEFT JOIN table_state ON table_state.table_name = service_role_needs.table_name
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
