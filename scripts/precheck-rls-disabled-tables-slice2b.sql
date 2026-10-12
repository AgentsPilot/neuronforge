SET default_transaction_read_only = on;

WITH target_table AS (
  SELECT pg_class.oid AS table_oid,
         pg_class.relkind AS table_relkind,
         pg_get_userbyid(pg_class.relowner) AS owner_name,
         pg_class.relrowsecurity AS rls_on,
         pg_class.relforcerowsecurity AS force_rls_on,
         pg_class.reltuples AS approx_rows,
         COALESCE(pg_class.relacl, acldefault('r', pg_class.relowner)) AS table_acl
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname = 'token_usage'
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
  SELECT listed.role_name, listed.role_order
  FROM (VALUES ('anon', 1), ('authenticated', 2), ('service_role', 3)) AS listed (role_name, role_order)
),
role_privileges AS (
  SELECT role_list.role_name,
         role_list.role_order,
         count(*) FILTER (WHERE has_table_privilege(role_list.role_name, target_table.table_oid, privilege_list.privilege_name)) AS held_count,
         COALESCE(
           string_agg(privilege_list.privilege_name, ' ' ORDER BY privilege_list.privilege_name COLLATE "C")
             FILTER (WHERE has_table_privilege(role_list.role_name, target_table.table_oid, privilege_list.privilege_name)),
           'none'
         ) AS held_list
  FROM target_table
  CROSS JOIN role_list
  CROSS JOIN privilege_list
  GROUP BY role_list.role_name, role_list.role_order
),
captured_policies AS (
  SELECT captured.policy_name, captured.policy_order, captured.policy_cmd, captured.qual_md5, captured.check_md5
  FROM (VALUES
    ('Users can insert their own token usage', 1, 'INSERT', 'none', '19300d155780585259ede73ac370586c'),
    ('Users can view their own token usage', 2, 'SELECT', '19300d155780585259ede73ac370586c', 'none'),
    ('token_usage_delete_policy', 3, 'DELETE', '19300d155780585259ede73ac370586c', 'none'),
    ('token_usage_insert_policy', 4, 'INSERT', 'none', '19300d155780585259ede73ac370586c'),
    ('token_usage_select_policy', 5, 'SELECT', '19300d155780585259ede73ac370586c', 'none'),
    ('token_usage_update_policy', 6, 'UPDATE', '19300d155780585259ede73ac370586c', 'none')
  ) AS captured (policy_name, policy_order, policy_cmd, qual_md5, check_md5)
),
live_policies AS (
  SELECT pg_policies.policyname::text AS policy_name,
         pg_policies.permissive,
         pg_policies.roles,
         pg_policies.cmd,
         pg_policies.qual,
         pg_policies.with_check,
         COALESCE(md5(pg_policies.qual), 'none') AS qual_md5,
         COALESCE(md5(pg_policies.with_check), 'none') AS check_md5
  FROM pg_policies
  WHERE pg_policies.schemaname = 'public'
    AND pg_policies.tablename = 'token_usage'
),
policy_match AS (
  SELECT captured_policies.policy_name,
         captured_policies.policy_order,
         live_policies.policy_name IS NOT NULL AS is_present,
         (live_policies.permissive = 'PERMISSIVE'
          AND live_policies.roles = ARRAY['public']::name[]
          AND live_policies.cmd = captured_policies.policy_cmd
          AND live_policies.qual_md5 = captured_policies.qual_md5
          AND live_policies.check_md5 = captured_policies.check_md5) AS is_match,
         live_policies.permissive,
         live_policies.roles,
         live_policies.cmd,
         live_policies.qual,
         live_policies.with_check,
         live_policies.qual_md5,
         live_policies.check_md5
  FROM captured_policies
  LEFT JOIN live_policies ON live_policies.policy_name = captured_policies.policy_name
),
column_acl_count AS (
  SELECT count(*) AS column_count
  FROM target_table
  JOIN pg_attribute ON pg_attribute.attrelid = target_table.table_oid
  WHERE pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
    AND pg_attribute.attacl IS NOT NULL
),
stop_reasons AS (
  SELECT 'table missing' AS reason WHERE NOT EXISTS (SELECT 1 FROM target_table)
  UNION ALL
  SELECT 'not a plain table' FROM target_table WHERE target_table.table_relkind <> 'r'
  UNION ALL
  SELECT 'owner not postgres' FROM target_table WHERE target_table.owner_name <> 'postgres'
  UNION ALL
  SELECT 'row security already on' FROM target_table WHERE target_table.rls_on
  UNION ALL
  SELECT 'row security forced' FROM target_table WHERE target_table.force_rls_on
  UNION ALL
  SELECT 'column privileges exist' FROM column_acl_count WHERE column_acl_count.column_count <> 0
  UNION ALL
  SELECT 'policy count is not 6' WHERE (SELECT count(*) FROM live_policies) <> 6
  UNION ALL
  SELECT 'policy differs from the pin ' || policy_match.policy_name FROM policy_match WHERE NOT COALESCE(policy_match.is_match, false)
),
report AS (
  SELECT 0 AS sort_order,
         'READ ME' AS item,
         'this session is now read only so run the migration in a NEW tab' AS detail

  UNION ALL
  SELECT 1,
         'PRECHECK STATUS',
         CASE WHEN EXISTS (SELECT 1 FROM stop_reasons)
              THEN 'STOP bring this output back to TL'
              ELSE 'CLEAN run the migration in a NEW tab' END

  UNION ALL
  SELECT 2 + (row_number() OVER (ORDER BY stop_reasons.reason COLLATE "C"))::int,
         'STOP REASON',
         stop_reasons.reason || ' stop here'
  FROM stop_reasons

  UNION ALL
  SELECT 100,
         'Q1 table token_usage',
         COALESCE(
           (SELECT 'relkind ' || target_table.table_relkind::text
                   || ' owner ' || target_table.owner_name
                   || ' rls ' || target_table.rls_on::text
                   || ' force rls ' || target_table.force_rls_on::text
                   || ' approx rows ' || target_table.approx_rows::bigint::text
            FROM target_table),
           'MISSING stop here'
         )

  UNION ALL
  SELECT 110 + role_privileges.role_order,
         'Q2 privileges ' || role_privileges.role_name,
         role_privileges.held_count::text || ' of 8 held ' || role_privileges.held_list
           || CASE WHEN role_privileges.role_name = 'service_role' THEN ' kept by the migration'
                   WHEN role_privileges.held_count = 8 THEN ' ALL matches the rollback'
                   ELSE ' differs from ALL so adjust the rollback' END
  FROM role_privileges

  UNION ALL
  SELECT 114,
         'Q2 privileges PUBLIC',
         COALESCE(
           (SELECT string_agg(acl_item.privilege_type, ' ' ORDER BY acl_item.privilege_type COLLATE "C")
            FROM target_table
            CROSS JOIN LATERAL aclexplode(target_table.table_acl) AS acl_item
            WHERE acl_item.grantee = 0),
           'none as expected'
         )

  UNION ALL
  SELECT 115,
         'Q3 grantors',
         COALESCE(
           (SELECT string_agg(distinct_grantors.grantor_name, ' ' ORDER BY distinct_grantors.grantor_name COLLATE "C")
            FROM (SELECT DISTINCT pg_get_userbyid(acl_item.grantor)::text AS grantor_name
                  FROM target_table
                  CROSS JOIN LATERAL aclexplode(target_table.table_acl) AS acl_item) AS distinct_grantors),
           'none'
         )

  UNION ALL
  SELECT 120,
         'Q4 columns with privileges',
         (SELECT column_acl_count.column_count FROM column_acl_count)::text
           || CASE WHEN (SELECT column_acl_count.column_count FROM column_acl_count) = 0 THEN ' ok' ELSE ' stop here' END

  UNION ALL
  SELECT 130,
         'Q5 policy count',
         (SELECT count(*) FROM live_policies)::text
           || CASE WHEN (SELECT count(*) FROM live_policies) = 6 THEN ' ok' ELSE ' stop here' END
  UNION ALL
  SELECT 130 + policy_match.policy_order,
         'Q5 policy ' || policy_match.policy_name,
         CASE WHEN NOT policy_match.is_present THEN 'MISSING stop here'
              ELSE 'permissive ' || policy_match.permissive
                   || ' roles ' || policy_match.roles::text
                   || ' cmd ' || policy_match.cmd
                   || ' qual ' || COALESCE(policy_match.qual, 'none')
                   || ' check ' || COALESCE(policy_match.with_check, 'none')
                   || ' qual md5 ' || policy_match.qual_md5
                   || ' check md5 ' || policy_match.check_md5
                   || CASE WHEN policy_match.is_match THEN ' matches the pin' ELSE ' differs from the pin stop here' END
         END
  FROM policy_match
  UNION ALL
  SELECT 137 + (row_number() OVER (ORDER BY live_policies.policy_name COLLATE "C"))::int,
         'Q5 unexpected policy ' || live_policies.policy_name,
         'not in the capture stop here'
  FROM live_policies
  WHERE live_policies.policy_name NOT IN (SELECT captured_policies.policy_name FROM captured_policies)

  UNION ALL
  SELECT 150,
         'Q6 triggers',
         COALESCE(
           (SELECT string_agg(pg_trigger.tgname || ' calls ' || pg_proc.proname || ' runs as owner ' || pg_proc.prosecdef::text,
                              ' and ' ORDER BY pg_trigger.tgname COLLATE "C")
            FROM target_table
            JOIN pg_trigger ON pg_trigger.tgrelid = target_table.table_oid
            JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
            WHERE NOT pg_trigger.tgisinternal),
           'none'
         )

  UNION ALL
  SELECT 160,
         'Q7 dependent views left for slice 1b',
         COALESCE(
           (SELECT string_agg(distinct_views.view_name || ' options ' || distinct_views.view_options
                                || ' anon select ' || has_table_privilege('anon', distinct_views.view_oid, 'SELECT')::text,
                              ' and ' ORDER BY distinct_views.view_name COLLATE "C")
            FROM (SELECT DISTINCT view_class.oid AS view_oid,
                                  view_class.relname::text AS view_name,
                                  COALESCE(array_to_string(view_class.reloptions, ' '), 'none') AS view_options
                  FROM target_table
                  JOIN pg_depend ON pg_depend.refobjid = target_table.table_oid
                  JOIN pg_rewrite ON pg_rewrite.oid = pg_depend.objid
                  JOIN pg_class AS view_class ON view_class.oid = pg_rewrite.ev_class
                  WHERE pg_depend.classid = 'pg_rewrite'::regclass
                    AND pg_depend.refclassid = 'pg_class'::regclass
                    AND pg_rewrite.ev_class <> target_table.table_oid) AS distinct_views),
           'none'
         )

  UNION ALL
  SELECT 170,
         'Q8 functions naming token_usage',
         COALESCE(
           (SELECT string_agg(pg_proc.proname || ' runs as owner ' || pg_proc.prosecdef::text
                                || ' anon execute ' || has_function_privilege('anon', pg_proc.oid, 'EXECUTE')::text
                                || ' authenticated execute ' || has_function_privilege('authenticated', pg_proc.oid, 'EXECUTE')::text,
                              ' and ' ORDER BY pg_proc.proname COLLATE "C")
            FROM pg_proc
            JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
            WHERE pg_namespace.nspname = 'public'
              AND strpos(pg_proc.prosrc, 'token_usage') > 0),
           'none'
         )

  UNION ALL
  SELECT 180,
         'Q9 other policies naming token_usage',
         COALESCE(
           (SELECT string_agg(pg_policies.tablename || ' ' || pg_policies.policyname, ' and ' ORDER BY pg_policies.tablename || ' ' || pg_policies.policyname COLLATE "C")
            FROM pg_policies
            WHERE pg_policies.schemaname = 'public'
              AND pg_policies.tablename <> 'token_usage'
              AND strpos(COALESCE(pg_policies.qual, '') || ' ' || COALESCE(pg_policies.with_check, ''), 'token_usage') > 0),
           'none ok'
         )

  UNION ALL
  SELECT 190,
         'Q10 foreign keys pointing at token_usage',
         COALESCE(
           (SELECT string_agg(referencing_class.relname || ' ' || pg_constraint.conname, ' and ' ORDER BY referencing_class.relname || ' ' || pg_constraint.conname COLLATE "C")
            FROM target_table
            JOIN pg_constraint ON pg_constraint.confrelid = target_table.table_oid
                              AND pg_constraint.contype = 'f'
            JOIN pg_class AS referencing_class ON referencing_class.oid = pg_constraint.conrelid),
           'none'
         )

  UNION ALL
  SELECT 200,
         'Q11 owned sequences and authenticated usage',
         COALESCE(
           (SELECT string_agg(sequence_class.relname || ' authenticated usage ' || has_sequence_privilege('authenticated', sequence_class.oid, 'USAGE')::text,
                              ' and ' ORDER BY sequence_class.relname COLLATE "C")
            FROM target_table
            JOIN pg_depend ON pg_depend.refobjid = target_table.table_oid
                          AND pg_depend.classid = 'pg_class'::regclass
                          AND pg_depend.refclassid = 'pg_class'::regclass
            JOIN pg_class AS sequence_class ON sequence_class.oid = pg_depend.objid
                                           AND sequence_class.relkind = 'S'),
           'none'
         )

  UNION ALL
  SELECT 210, 'Q12 rows total', (SELECT count(*) FROM public.token_usage)::text
  UNION ALL
  SELECT 211, 'Q12 rows with no user id', (SELECT count(*) FROM public.token_usage WHERE token_usage.user_id IS NULL)::text

  UNION ALL
  SELECT 990, 'Q13 server version num', current_setting('server_version_num')
  UNION ALL
  SELECT 999, 'checked at utc', (now() AT TIME ZONE 'UTC')::text
)
SELECT report.sort_order, report.item, report.detail
FROM report
ORDER BY report.sort_order, report.item;
