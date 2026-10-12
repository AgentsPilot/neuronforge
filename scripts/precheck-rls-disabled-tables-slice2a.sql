SET default_transaction_read_only = on;

WITH target_names AS (
  SELECT listed.table_name, listed.table_order
  FROM (VALUES
    ('agent_job_fallback', 1),
    ('agent_scheduler_state', 2),
    ('ais_normalization_ranges', 3),
    ('contact_messages', 4),
    ('memory_config', 5),
    ('message_replies', 6),
    ('pricing_config', 7),
    ('storage_plans', 8)
  ) AS listed (table_name, table_order)
),
target_tables AS (
  SELECT target_names.table_name,
         target_names.table_order,
         pg_class.oid AS table_oid,
         pg_class.relkind AS table_relkind,
         pg_get_userbyid(pg_class.relowner) AS owner_name,
         pg_class.relrowsecurity AS rls_on,
         pg_class.relforcerowsecurity AS force_rls_on,
         pg_class.reltuples AS approx_rows,
         COALESCE(pg_class.relacl, acldefault('r', pg_class.relowner)) AS table_acl
  FROM target_names
  LEFT JOIN pg_class ON pg_class.oid = (
    SELECT found_class.oid
    FROM pg_class AS found_class
    JOIN pg_namespace AS found_namespace ON found_namespace.oid = found_class.relnamespace
    WHERE found_namespace.nspname = 'public'
      AND found_class.relname = target_names.table_name
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
  SELECT listed.role_name, listed.role_order
  FROM (VALUES ('anon', 1), ('authenticated', 2), ('service_role', 3)) AS listed (role_name, role_order)
),
role_privileges AS (
  SELECT target_tables.table_name,
         target_tables.table_order,
         role_list.role_name,
         role_list.role_order,
         count(*) FILTER (WHERE has_table_privilege(role_list.role_name, target_tables.table_oid, privilege_list.privilege_name)) AS held_count,
         COALESCE(
           string_agg(privilege_list.privilege_name, ' ' ORDER BY privilege_list.privilege_name COLLATE "C")
             FILTER (WHERE has_table_privilege(role_list.role_name, target_tables.table_oid, privilege_list.privilege_name)),
           'none'
         ) AS held_list
  FROM target_tables
  CROSS JOIN role_list
  CROSS JOIN privilege_list
  WHERE target_tables.table_oid IS NOT NULL
  GROUP BY target_tables.table_name, target_tables.table_order, role_list.role_name, role_list.role_order
),
public_privileges AS (
  SELECT target_tables.table_name,
         COALESCE(
           (SELECT string_agg(acl_item.privilege_type, ' ' ORDER BY acl_item.privilege_type COLLATE "C")
            FROM aclexplode(target_tables.table_acl) AS acl_item
            WHERE acl_item.grantee = 0),
           'none'
         ) AS held_list
  FROM target_tables
  WHERE target_tables.table_oid IS NOT NULL
),
grantors AS (
  SELECT target_tables.table_name,
         COALESCE(
           (SELECT string_agg(distinct_grantors.grantor_name, ' ' ORDER BY distinct_grantors.grantor_name COLLATE "C")
            FROM (SELECT DISTINCT pg_get_userbyid(acl_item.grantor)::text AS grantor_name
                  FROM aclexplode(target_tables.table_acl) AS acl_item) AS distinct_grantors),
           'none'
         ) AS grantor_list
  FROM target_tables
  WHERE target_tables.table_oid IS NOT NULL
),
column_acl_counts AS (
  SELECT target_tables.table_name,
         (SELECT count(*) FROM pg_attribute
          WHERE pg_attribute.attrelid = target_tables.table_oid
            AND pg_attribute.attnum > 0
            AND NOT pg_attribute.attisdropped
            AND pg_attribute.attacl IS NOT NULL) AS column_acl_count
  FROM target_tables
  WHERE target_tables.table_oid IS NOT NULL
),
policy_counts AS (
  SELECT target_tables.table_name,
         (SELECT count(*) FROM pg_policies
          WHERE pg_policies.schemaname = 'public'
            AND pg_policies.tablename = target_tables.table_name) AS policy_count
  FROM target_tables
),
trigger_lists AS (
  SELECT target_tables.table_name,
         COALESCE(
           (SELECT string_agg(pg_trigger.tgname || ' calls ' || pg_proc.proname || ' runs as owner ' || pg_proc.prosecdef::text,
                              ' and ' ORDER BY pg_trigger.tgname COLLATE "C")
            FROM pg_trigger
            JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
            WHERE pg_trigger.tgrelid = target_tables.table_oid
              AND NOT pg_trigger.tgisinternal),
           'none'
         ) AS trigger_list
  FROM target_tables
  WHERE target_tables.table_oid IS NOT NULL
),
view_lists AS (
  SELECT target_tables.table_name,
         COALESCE(
           (SELECT string_agg(distinct_views.view_name, ' ' ORDER BY distinct_views.view_name COLLATE "C")
            FROM (SELECT DISTINCT view_class.relname::text AS view_name
                  FROM pg_depend
                  JOIN pg_rewrite ON pg_rewrite.oid = pg_depend.objid
                  JOIN pg_class AS view_class ON view_class.oid = pg_rewrite.ev_class
                  WHERE pg_depend.classid = 'pg_rewrite'::regclass
                    AND pg_depend.refclassid = 'pg_class'::regclass
                    AND pg_depend.refobjid = target_tables.table_oid
                    AND pg_rewrite.ev_class <> target_tables.table_oid) AS distinct_views),
           'none'
         ) AS view_list
  FROM target_tables
  WHERE target_tables.table_oid IS NOT NULL
),
function_lists AS (
  SELECT target_tables.table_name,
         COALESCE(
           (SELECT string_agg(pg_proc.proname || ' runs as owner ' || pg_proc.prosecdef::text
                                || ' anon execute ' || has_function_privilege('anon', pg_proc.oid, 'EXECUTE')::text
                                || ' authenticated execute ' || has_function_privilege('authenticated', pg_proc.oid, 'EXECUTE')::text,
                              ' and ' ORDER BY pg_proc.proname COLLATE "C")
            FROM pg_proc
            JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
            WHERE pg_namespace.nspname = 'public'
              AND strpos(pg_proc.prosrc, target_tables.table_name) > 0),
           'none'
         ) AS function_list
  FROM target_tables
),
foreign_policy_lists AS (
  SELECT target_tables.table_name,
         COALESCE(
           (SELECT string_agg(pg_policies.tablename || ' ' || pg_policies.policyname, ' and ' ORDER BY pg_policies.tablename || ' ' || pg_policies.policyname COLLATE "C")
            FROM pg_policies
            WHERE pg_policies.schemaname = 'public'
              AND pg_policies.tablename <> target_tables.table_name
              AND strpos(COALESCE(pg_policies.qual, '') || ' ' || COALESCE(pg_policies.with_check, ''), target_tables.table_name) > 0),
           'none'
         ) AS policy_list
  FROM target_tables
),
stop_reasons AS (
  SELECT target_tables.table_name, 'missing' AS reason FROM target_tables WHERE target_tables.table_oid IS NULL
  UNION ALL
  SELECT target_tables.table_name, 'not a plain table' FROM target_tables WHERE target_tables.table_oid IS NOT NULL AND target_tables.table_relkind <> 'r'
  UNION ALL
  SELECT target_tables.table_name, 'owner not postgres' FROM target_tables WHERE target_tables.table_oid IS NOT NULL AND target_tables.owner_name <> 'postgres'
  UNION ALL
  SELECT target_tables.table_name, 'row security already on' FROM target_tables WHERE target_tables.rls_on
  UNION ALL
  SELECT target_tables.table_name, 'row security forced' FROM target_tables WHERE target_tables.force_rls_on
  UNION ALL
  SELECT policy_counts.table_name, 'has a policy' FROM policy_counts WHERE policy_counts.policy_count <> 0
  UNION ALL
  SELECT column_acl_counts.table_name, 'has column privileges' FROM column_acl_counts WHERE column_acl_counts.column_acl_count <> 0
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
  SELECT 2 + (row_number() OVER (ORDER BY stop_reasons.table_name COLLATE "C", stop_reasons.reason COLLATE "C"))::int,
         'STOP REASON ' || stop_reasons.table_name,
         stop_reasons.reason || ' stop here'
  FROM stop_reasons

  UNION ALL
  SELECT 100 * target_tables.table_order,
         'Q1 table ' || target_tables.table_name,
         CASE WHEN target_tables.table_oid IS NULL THEN 'MISSING stop here'
              ELSE 'relkind ' || target_tables.table_relkind::text
                   || ' owner ' || target_tables.owner_name
                   || ' rls ' || target_tables.rls_on::text
                   || ' force rls ' || target_tables.force_rls_on::text
                   || ' approx rows ' || target_tables.approx_rows::bigint::text
                   || CASE WHEN target_tables.rls_on = false AND target_tables.force_rls_on = false AND target_tables.owner_name = 'postgres'
                           THEN ' ok' ELSE ' stop here' END
         END
  FROM target_tables

  UNION ALL
  SELECT 100 * role_privileges.table_order + 10 + role_privileges.role_order,
         'Q2 ' || role_privileges.table_name || ' privileges ' || role_privileges.role_name,
         role_privileges.held_count::text || ' of 8 held ' || role_privileges.held_list
           || CASE WHEN role_privileges.role_name = 'service_role' THEN ' kept by the migration'
                   WHEN role_privileges.held_count = 8 THEN ' ALL matches the rollback'
                   ELSE ' differs from ALL so adjust the rollback' END
  FROM role_privileges

  UNION ALL
  SELECT 100 * target_tables.table_order + 14,
         'Q2 ' || public_privileges.table_name || ' privileges PUBLIC',
         public_privileges.held_list
           || CASE WHEN public_privileges.held_list = 'none' THEN ' as expected' ELSE ' differs so adjust the rollback' END
  FROM public_privileges
  JOIN target_tables ON target_tables.table_name = public_privileges.table_name

  UNION ALL
  SELECT 100 * target_tables.table_order + 15,
         'Q3 ' || grantors.table_name || ' grantors',
         grantors.grantor_list
  FROM grantors
  JOIN target_tables ON target_tables.table_name = grantors.table_name

  UNION ALL
  SELECT 100 * target_tables.table_order + 20,
         'Q4 ' || column_acl_counts.table_name || ' columns with privileges',
         column_acl_counts.column_acl_count::text
           || CASE WHEN column_acl_counts.column_acl_count = 0 THEN ' ok' ELSE ' stop here' END
  FROM column_acl_counts
  JOIN target_tables ON target_tables.table_name = column_acl_counts.table_name

  UNION ALL
  SELECT 100 * target_tables.table_order + 30,
         'Q5 ' || policy_counts.table_name || ' policies',
         policy_counts.policy_count::text
           || CASE WHEN policy_counts.policy_count = 0 THEN ' ok' ELSE ' stop here' END
  FROM policy_counts
  JOIN target_tables ON target_tables.table_name = policy_counts.table_name

  UNION ALL
  SELECT 100 * target_tables.table_order + 40,
         'Q6 ' || trigger_lists.table_name || ' triggers',
         trigger_lists.trigger_list
  FROM trigger_lists
  JOIN target_tables ON target_tables.table_name = trigger_lists.table_name

  UNION ALL
  SELECT 100 * target_tables.table_order + 50,
         'Q7 ' || view_lists.table_name || ' dependent views',
         view_lists.view_list
           || CASE WHEN view_lists.view_list = 'none' THEN ' ok' ELSE ' not expected so bring back to TL' END
  FROM view_lists
  JOIN target_tables ON target_tables.table_name = view_lists.table_name

  UNION ALL
  SELECT 100 * target_tables.table_order + 60,
         'Q8 ' || function_lists.table_name || ' functions naming it',
         function_lists.function_list
  FROM function_lists
  JOIN target_tables ON target_tables.table_name = function_lists.table_name

  UNION ALL
  SELECT 100 * target_tables.table_order + 70,
         'Q9 ' || foreign_policy_lists.table_name || ' other policies naming it',
         foreign_policy_lists.policy_list
           || CASE WHEN foreign_policy_lists.policy_list = 'none' THEN ' ok' ELSE ' not expected so bring back to TL' END
  FROM foreign_policy_lists
  JOIN target_tables ON target_tables.table_name = foreign_policy_lists.table_name

  UNION ALL
  SELECT 990, 'Q10 server version num', current_setting('server_version_num')
  UNION ALL
  SELECT 999, 'checked at utc', (now() AT TIME ZONE 'UTC')::text
)
SELECT report.sort_order, report.item, report.detail
FROM report
ORDER BY report.sort_order, report.item;
