SET default_transaction_read_only = on;

WITH lockdown_table AS (
  SELECT pg_catalog.to_regclass('public.plugin_connections') AS table_oid
),
table_privilege AS (
  SELECT privilege_row.privilege_name
  FROM (VALUES
    ('SELECT'),
    ('INSERT'),
    ('UPDATE'),
    ('DELETE'),
    ('TRUNCATE'),
    ('REFERENCES'),
    ('TRIGGER')
  ) AS privilege_row (privilege_name)
),
column_privilege AS (
  SELECT privilege_row.privilege_name
  FROM (VALUES
    ('SELECT'),
    ('INSERT'),
    ('UPDATE'),
    ('REFERENCES')
  ) AS privilege_row (privilege_name)
),
closed_role AS (
  SELECT role_row.role_name, role_row.role_order
  FROM (VALUES
    ('anon', 1),
    ('authenticated', 2),
    ('public', 3)
  ) AS role_row (role_name, role_order)
),
token_column AS (
  SELECT column_row.column_name, column_row.column_order
  FROM (VALUES
    ('access_token', 1),
    ('refresh_token', 2),
    ('expires_at', 3),
    ('last_refreshed_at', 4),
    ('settings', 5),
    ('profile_data', 6)
  ) AS column_row (column_name, column_order)
),
granted_column AS (
  SELECT column_row.column_name, column_row.column_order, column_row.is_updatable
  FROM (VALUES
    ('id', 1, false),
    ('user_id', 2, false),
    ('plugin_key', 3, false),
    ('plugin_name', 4, false),
    ('username', 5, false),
    ('email', 6, false),
    ('scope', 7, false),
    ('status', 8, true),
    ('connected_at', 9, false),
    ('created_at', 10, false),
    ('updated_at', 11, false),
    ('last_used', 12, false),
    ('disconnected_at', 13, true)
  ) AS column_row (column_name, column_order, is_updatable)
),
table_state AS (
  SELECT closed_role.role_name,
         closed_role.role_order,
         CASE WHEN lockdown_table.table_oid IS NULL THEN NULL
              ELSE (SELECT string_agg(table_privilege.privilege_name, ' ' ORDER BY table_privilege.privilege_name COLLATE "C")
                    FROM table_privilege
                    WHERE pg_catalog.has_table_privilege(closed_role.role_name, lockdown_table.table_oid, table_privilege.privilege_name))
         END AS held_list
  FROM closed_role
  CROSS JOIN lockdown_table
),
token_state AS (
  SELECT closed_role.role_name,
         closed_role.role_order,
         token_column.column_name,
         token_column.column_order,
         CASE WHEN lockdown_table.table_oid IS NULL THEN NULL
              ELSE (SELECT string_agg(column_privilege.privilege_name, ' ' ORDER BY column_privilege.privilege_name COLLATE "C")
                    FROM column_privilege
                    WHERE pg_catalog.has_column_privilege(closed_role.role_name, lockdown_table.table_oid, token_column.column_name, column_privilege.privilege_name))
         END AS held_list
  FROM closed_role
  CROSS JOIN token_column
  CROSS JOIN lockdown_table
  WHERE closed_role.role_name <> 'public'
),
granted_state AS (
  SELECT granted_column.column_name,
         granted_column.column_order,
         granted_column.is_updatable,
         CASE WHEN lockdown_table.table_oid IS NULL THEN NULL
              ELSE pg_catalog.has_column_privilege('authenticated', lockdown_table.table_oid, granted_column.column_name, 'SELECT')
         END AS can_select,
         CASE WHEN lockdown_table.table_oid IS NULL THEN NULL
              ELSE pg_catalog.has_column_privilege('authenticated', lockdown_table.table_oid, granted_column.column_name, 'UPDATE')
         END AS can_update
  FROM granted_column
  CROSS JOIN lockdown_table
),
any_column_state AS (
  SELECT closed_role.role_name,
         closed_role.role_order,
         CASE WHEN lockdown_table.table_oid IS NULL THEN NULL
              ELSE (SELECT string_agg(column_privilege.privilege_name, ' ' ORDER BY column_privilege.privilege_name COLLATE "C")
                    FROM column_privilege
                    WHERE (closed_role.role_name <> 'authenticated' OR column_privilege.privilege_name IN ('INSERT', 'REFERENCES'))
                      AND pg_catalog.has_any_column_privilege(closed_role.role_name, lockdown_table.table_oid, column_privilege.privilege_name))
         END AS held_list
  FROM closed_role
  CROSS JOIN lockdown_table
),
service_state AS (
  SELECT CASE WHEN lockdown_table.table_oid IS NULL THEN NULL
              ELSE (SELECT string_agg(table_privilege.privilege_name, ' ' ORDER BY table_privilege.privilege_name COLLATE "C")
                    FROM table_privilege
                    WHERE table_privilege.privilege_name IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
                      AND NOT pg_catalog.has_table_privilege('service_role', lockdown_table.table_oid, table_privilege.privilege_name))
         END AS missing_list,
         lockdown_table.table_oid
  FROM lockdown_table
),
checks AS (
  SELECT 100 AS sort_order,
         'C1 table exists plugin_connections' AS check_name,
         CASE WHEN lockdown_table.table_oid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result,
         CASE WHEN lockdown_table.table_oid IS NOT NULL THEN 'present' ELSE 'missing' END AS detail
  FROM lockdown_table

  UNION ALL
  SELECT 200 + table_state.role_order,
         'C2 ' || table_state.role_name || ' holds no table privilege',
         CASE WHEN lockdown_table.table_oid IS NOT NULL AND table_state.held_list IS NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN lockdown_table.table_oid IS NULL THEN 'table missing'
              WHEN table_state.held_list IS NULL THEN 'none held'
              ELSE 'held ' || table_state.held_list END
  FROM table_state
  CROSS JOIN lockdown_table

  UNION ALL
  SELECT 300 + token_state.role_order * 10 + token_state.column_order,
         'C3 ' || token_state.role_name || ' holds nothing on ' || token_state.column_name,
         CASE WHEN lockdown_table.table_oid IS NOT NULL AND token_state.held_list IS NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN lockdown_table.table_oid IS NULL THEN 'table missing'
              WHEN token_state.held_list IS NULL THEN 'none held'
              ELSE 'held ' || token_state.held_list END
  FROM token_state
  CROSS JOIN lockdown_table

  UNION ALL
  SELECT 400 + granted_state.column_order,
         'C4 authenticated selects ' || granted_state.column_name,
         CASE WHEN granted_state.can_select IS TRUE THEN 'PASS' ELSE 'FAIL' END,
         COALESCE('held ' || granted_state.can_select::text || ' expected true', 'table missing')
  FROM granted_state

  UNION ALL
  SELECT 500 + granted_state.column_order,
         'C5 authenticated update ' || granted_state.column_name || ' is ' || granted_state.is_updatable::text,
         CASE WHEN granted_state.can_update IS NOT NULL AND granted_state.can_update = granted_state.is_updatable THEN 'PASS' ELSE 'FAIL' END,
         COALESCE('held ' || granted_state.can_update::text || ' expected ' || granted_state.is_updatable::text, 'table missing')
  FROM granted_state

  UNION ALL
  SELECT 600 + any_column_state.role_order,
         'C6 ' || any_column_state.role_name || ' holds no column privilege beyond the grant',
         CASE WHEN lockdown_table.table_oid IS NOT NULL AND any_column_state.held_list IS NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN lockdown_table.table_oid IS NULL THEN 'table missing'
              WHEN any_column_state.held_list IS NULL THEN 'none held'
              ELSE 'held ' || any_column_state.held_list END
  FROM any_column_state
  CROSS JOIN lockdown_table

  UNION ALL
  SELECT 700,
         'C7 service_role keeps select insert update delete',
         CASE WHEN service_state.table_oid IS NOT NULL AND service_state.missing_list IS NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN service_state.table_oid IS NULL THEN 'table missing'
              WHEN service_state.missing_list IS NULL THEN 'all held'
              ELSE 'missing ' || service_state.missing_list END
  FROM service_state
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
