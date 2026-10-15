SET default_transaction_read_only = on;

SELECT columns.column_name, columns.data_type, columns.is_nullable
FROM information_schema.columns
WHERE columns.table_schema = 'public' AND columns.table_name = 'plugin_connections'
ORDER BY columns.ordinal_position;

SELECT role_table_grants.grantee, role_table_grants.privilege_type
FROM information_schema.role_table_grants
WHERE role_table_grants.table_schema = 'public' AND role_table_grants.table_name = 'plugin_connections'
ORDER BY role_table_grants.grantee, role_table_grants.privilege_type;

SELECT column_privileges.grantee, column_privileges.column_name, column_privileges.privilege_type
FROM information_schema.column_privileges
WHERE column_privileges.table_schema = 'public' AND column_privileges.table_name = 'plugin_connections'
  AND column_privileges.grantee IN ('anon', 'authenticated', 'PUBLIC')
ORDER BY column_privileges.grantee, column_privileges.column_name, column_privileges.privilege_type;
