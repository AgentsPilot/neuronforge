SET default_transaction_read_only = on;

WITH watched AS (
  SELECT watched_row.table_name, watched_row.table_order
  FROM (VALUES
    ('agent_configurations', 1),
    ('agent_executions', 2),
    ('agent_logs', 3),
    ('agent_stats', 4),
    ('shared_agents', 5),
    ('shared_agent_imports', 6)
  ) AS watched_row (table_name, table_order)
),
table_state AS (
  SELECT watched.table_name,
         watched.table_order,
         pg_class.oid AS table_oid,
         pg_class.relkind::text AS kind_code,
         pg_catalog.pg_get_userbyid(pg_class.relowner)::text AS owner_name,
         pg_class.relrowsecurity AS rls_on,
         pg_class.relforcerowsecurity AS rls_forced
  FROM watched
  LEFT JOIN pg_catalog.pg_namespace ON pg_namespace.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class
    ON pg_class.relnamespace = pg_namespace.oid
   AND pg_class.relname = watched.table_name
),
watched_role AS (
  SELECT role_row.role_name, role_row.role_order
  FROM (VALUES
    ('public', 1),
    ('anon', 2),
    ('authenticated', 3),
    ('service_role', 4)
  ) AS role_row (role_name, role_order)
),
watched_privilege AS (
  SELECT privilege_row.privilege_name, privilege_row.is_signed_in_privilege
  FROM (VALUES
    ('SELECT', 0, true),
    ('INSERT', 0, true),
    ('UPDATE', 0, true),
    ('DELETE', 0, true),
    ('TRUNCATE', 0, false),
    ('REFERENCES', 0, false),
    ('TRIGGER', 0, false),
    ('MAINTAIN', 170000, false)
  ) AS privilege_row (privilege_name, min_version, is_signed_in_privilege)
  WHERE pg_catalog.current_setting('server_version_num')::int >= privilege_row.min_version
),
role_held AS (
  SELECT table_state.table_name,
         table_state.table_order,
         watched_role.role_name,
         watched_role.role_order,
         watched_privilege.privilege_name,
         watched_privilege.is_signed_in_privilege,
         pg_catalog.has_table_privilege(watched_role.role_name, table_state.table_oid, watched_privilege.privilege_name) AS is_held
  FROM table_state
  CROSS JOIN watched_role
  CROSS JOIN watched_privilege
  WHERE table_state.table_oid IS NOT NULL
),
role_summary AS (
  SELECT role_held.table_name,
         role_held.table_order,
         role_held.role_name,
         role_held.role_order,
         count(*) AS privilege_total,
         count(*) FILTER (WHERE role_held.is_held) AS held_total,
         count(*) FILTER (WHERE role_held.is_held AND role_held.is_signed_in_privilege) AS signed_in_held_total,
         COALESCE(string_agg(role_held.privilege_name, ' ' ORDER BY role_held.privilege_name COLLATE "C")
                    FILTER (WHERE role_held.is_held), 'none') AS held_list
  FROM role_held
  GROUP BY role_held.table_name, role_held.table_order, role_held.role_name, role_held.role_order
),
acl_entry AS (
  SELECT table_state.table_name,
         table_state.table_order,
         CASE WHEN acl_row.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl_row.grantee)::text END AS grantee_name,
         pg_catalog.pg_get_userbyid(acl_row.grantor)::text AS grantor_name,
         acl_row.privilege_type
  FROM table_state
  JOIN pg_catalog.pg_class ON pg_class.oid = table_state.table_oid
  CROSS JOIN LATERAL pg_catalog.aclexplode(pg_class.relacl) AS acl_row
),
grantor_summary AS (
  SELECT acl_entry.table_name,
         acl_entry.table_order,
         acl_entry.grantee_name,
         acl_entry.grantor_name,
         string_agg(acl_entry.privilege_type, ' ' ORDER BY acl_entry.privilege_type COLLATE "C") AS privilege_list
  FROM acl_entry
  WHERE acl_entry.grantee_name IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
  GROUP BY acl_entry.table_name, acl_entry.table_order, acl_entry.grantee_name, acl_entry.grantor_name
),
column_acl AS (
  SELECT table_state.table_name,
         table_state.table_order,
         (SELECT count(*)
          FROM pg_catalog.pg_attribute
          WHERE pg_attribute.attrelid = table_state.table_oid
            AND pg_attribute.attnum > 0
            AND NOT pg_attribute.attisdropped
            AND pg_attribute.attacl IS NOT NULL) AS column_acl_total
  FROM table_state
  WHERE table_state.table_oid IS NOT NULL
),
owned_sequence AS (
  SELECT table_state.table_name,
         table_state.table_order,
         sequence_class.oid AS sequence_oid,
         sequence_class.oid::regclass::text AS sequence_label
  FROM table_state
  JOIN pg_catalog.pg_depend
    ON pg_depend.refobjid = table_state.table_oid
   AND pg_depend.classid = 'pg_class'::regclass
   AND pg_depend.refclassid = 'pg_class'::regclass
   AND pg_depend.deptype IN ('a', 'i')
  JOIN pg_catalog.pg_class AS sequence_class
    ON sequence_class.oid = pg_depend.objid
   AND sequence_class.relkind = 'S'
),
sequence_privilege AS (
  SELECT sequence_row.privilege_name
  FROM (VALUES ('SELECT'), ('UPDATE'), ('USAGE')) AS sequence_row (privilege_name)
),
sequence_held AS (
  SELECT owned_sequence.table_name,
         owned_sequence.table_order,
         owned_sequence.sequence_label,
         watched_role.role_name,
         sequence_privilege.privilege_name,
         pg_catalog.has_sequence_privilege(watched_role.role_name, owned_sequence.sequence_oid, sequence_privilege.privilege_name) AS is_held
  FROM owned_sequence
  CROSS JOIN sequence_privilege
  JOIN watched_role ON watched_role.role_name IN ('public', 'anon')
),
sequence_summary AS (
  SELECT sequence_held.table_name,
         sequence_held.table_order,
         sequence_held.sequence_label,
         count(*) FILTER (WHERE sequence_held.role_name = 'anon' AND sequence_held.is_held) AS anon_held_total,
         count(*) FILTER (WHERE sequence_held.role_name = 'public' AND sequence_held.is_held) AS public_held_total,
         COALESCE(string_agg(sequence_held.privilege_name, ' ' ORDER BY sequence_held.privilege_name COLLATE "C")
                    FILTER (WHERE sequence_held.role_name = 'anon' AND sequence_held.is_held), 'none') AS anon_held_list
  FROM sequence_held
  GROUP BY sequence_held.table_name, sequence_held.table_order, sequence_held.sequence_label
),
function_body AS (
  SELECT pg_proc.oid AS function_oid,
         pg_proc.oid::regprocedure::text AS function_name,
         pg_proc.prosecdef AS runs_as_owner,
         COALESCE(pg_proc.prosrc, '') || ' ' || COALESCE(pg_catalog.pg_get_function_sqlbody(pg_proc.oid), '') AS body_text
  FROM pg_catalog.pg_proc
  JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname NOT IN ('pg_catalog', 'information_schema')
),
function_mention AS (
  SELECT watched.table_name,
         watched.table_order,
         function_body.function_name,
         function_body.runs_as_owner,
         strpos(upper(function_body.body_text), 'TRUNCATE') > 0 AS has_truncate,
         strpos(replace(replace(upper(function_body.body_text), 'LOCK_TIMEOUT', ''), 'LOCKED', ''), 'LOCK') > 0 AS has_lock
  FROM watched
  JOIN function_body ON strpos(function_body.body_text, watched.table_name) > 0
),
trigger_on_table AS (
  SELECT table_state.table_name,
         table_state.table_order,
         pg_trigger.tgname::text AS trigger_name,
         pg_trigger.tgfoid::regprocedure::text AS trigger_function,
         pg_proc.prosecdef AS runs_as_owner
  FROM table_state
  JOIN pg_catalog.pg_trigger ON pg_trigger.tgrelid = table_state.table_oid AND NOT pg_trigger.tgisinternal
  JOIN pg_catalog.pg_proc ON pg_proc.oid = pg_trigger.tgfoid
),
policy_mention AS (
  SELECT watched.table_name,
         watched.table_order,
         pg_policies.schemaname || ' ' || pg_policies.tablename || ' ' || pg_policies.policyname AS policy_name
  FROM watched
  JOIN pg_catalog.pg_policies
    ON strpos(COALESCE(pg_policies.qual, ''), watched.table_name) > 0
    OR strpos(COALESCE(pg_policies.with_check, ''), watched.table_name) > 0
),
report AS (
  SELECT 1 AS sort_order,
         'Q0 server version' AS item,
         pg_catalog.current_setting('server_version_num')
           || CASE WHEN pg_catalog.current_setting('server_version_num')::int >= 170000 THEN ' ok' ELSE ' below 17 so MAINTAIN is unknown stop here' END AS detail

  UNION ALL
  SELECT table_state.table_order * 1000 + 1,
         'Q1 exists ' || table_state.table_name,
         CASE WHEN table_state.table_oid IS NULL THEN 'missing stop here'
              WHEN table_state.kind_code <> 'r' THEN 'not a plain table kind ' || table_state.kind_code || ' stop here'
              ELSE 'present plain table' END
  FROM table_state

  UNION ALL
  SELECT table_state.table_order * 1000 + 2,
         'Q2 owner ' || table_state.table_name,
         COALESCE(table_state.owner_name, 'missing')
           || CASE WHEN table_state.owner_name = 'postgres' THEN ' ok' ELSE ' expected postgres stop here' END
  FROM table_state

  UNION ALL
  SELECT table_state.table_order * 1000 + 3,
         'Q3 row security ' || table_state.table_name,
         CASE WHEN table_state.table_oid IS NULL THEN 'missing stop here'
              WHEN table_state.rls_on THEN 'on so the migration would refuse stop here'
              WHEN table_state.rls_forced THEN 'forced so the migration would refuse stop here'
              ELSE 'off ok' END
  FROM table_state

  UNION ALL
  SELECT role_summary.table_order * 1000 + 10 + role_summary.role_order,
         'Q4 privileges ' || role_summary.role_name || ' ' || role_summary.table_name,
         role_summary.held_total::text || ' of ' || role_summary.privilege_total::text || ' held ' || role_summary.held_list
           || CASE
                WHEN role_summary.role_name = 'anon' AND role_summary.held_total = role_summary.privilege_total
                  THEN ' ALL matches the rollback'
                WHEN role_summary.role_name = 'anon'
                  THEN ' differs from ALL so adjust the rollback to this list'
                WHEN role_summary.role_name = 'authenticated' AND role_summary.signed_in_held_total < 4
                  THEN ' lacks a signed in privilege so the migration would refuse stop here'
                WHEN role_summary.role_name = 'authenticated' AND role_summary.held_total = role_summary.privilege_total
                  THEN ' ALL matches the rollback'
                WHEN role_summary.role_name = 'authenticated'
                  THEN ' differs from ALL so adjust the rollback to this list'
                WHEN role_summary.role_name = 'public' AND role_summary.held_total = 0 THEN ' none as expected'
                WHEN role_summary.role_name = 'public' THEN ' unexpected so adjust the rollback to this list'
                WHEN role_summary.role_name = 'service_role' AND role_summary.signed_in_held_total = 4 THEN ' untouched by the migration'
                ELSE ' service_role lacks a server privilege stop here'
              END
  FROM role_summary

  UNION ALL
  SELECT grantor_summary.table_order * 1000 + 20,
         'Q5 grant ' || grantor_summary.grantee_name || ' ' || grantor_summary.table_name,
         'by ' || grantor_summary.grantor_name || ' ' || grantor_summary.privilege_list
           || CASE WHEN grantor_summary.grantor_name = 'postgres' THEN ''
                   ELSE ' OTHER GRANTOR stop here' END
  FROM grantor_summary

  UNION ALL
  SELECT column_acl.table_order * 1000 + 30,
         'Q6 column privileges ' || column_acl.table_name,
         column_acl.column_acl_total::text
           || CASE WHEN column_acl.column_acl_total = 0 THEN ' ok'
                   ELSE ' so the migration would refuse stop here' END
  FROM column_acl

  UNION ALL
  SELECT table_state.table_order * 1000 + 40,
         'Q7 owned sequences count ' || table_state.table_name,
         (SELECT count(*) FROM owned_sequence WHERE owned_sequence.table_name = table_state.table_name)::text
           || ' information only'
  FROM table_state

  UNION ALL
  SELECT sequence_summary.table_order * 1000 + 41,
         'Q7 owned sequence ' || sequence_summary.table_name,
         sequence_summary.sequence_label || ' anon holds ' || sequence_summary.anon_held_list
           || ' public holds ' || sequence_summary.public_held_total::text
           || CASE WHEN sequence_summary.anon_held_total = 3 THEN ' ALL matches the rollback'
                   ELSE ' differs from ALL so adjust the rollback to this list' END
  FROM sequence_summary

  UNION ALL
  SELECT table_state.table_order * 1000 + 50,
         'Q8 function mentions count ' || table_state.table_name,
         (SELECT count(*) FROM function_mention WHERE function_mention.table_name = table_state.table_name)::text
           || ' listed below'
  FROM table_state

  UNION ALL
  SELECT function_mention.table_order * 1000 + 51,
         'Q8 function mention ' || function_mention.table_name,
         function_mention.function_name
           || CASE WHEN function_mention.runs_as_owner THEN ' runs as owner' ELSE ' runs as caller' END
           || CASE
                WHEN NOT function_mention.runs_as_owner AND function_mention.has_truncate
                  THEN ' TRUNCATE in a caller rights body stop here'
                WHEN NOT function_mention.runs_as_owner AND function_mention.has_lock
                  THEN ' LOCK in a caller rights body stop here'
                WHEN function_mention.has_truncate OR function_mention.has_lock
                  THEN ' TRUNCATE or LOCK runs as owner so unaffected ok'
                ELSE ' ok'
              END
  FROM function_mention

  UNION ALL
  SELECT trigger_on_table.table_order * 1000 + 60,
         'Q9 trigger ' || trigger_on_table.table_name,
         trigger_on_table.trigger_name || ' calls ' || trigger_on_table.trigger_function
           || CASE WHEN trigger_on_table.runs_as_owner THEN ' runs as owner' ELSE ' runs as caller' END
           || ' information only'
  FROM trigger_on_table

  UNION ALL
  SELECT policy_mention.table_order * 1000 + 70,
         'Q10 policy mention ' || policy_mention.table_name,
         policy_mention.policy_name || ' information only'
  FROM policy_mention
)
SELECT final_report.sort_order, final_report.item, final_report.detail
FROM (
  SELECT 0 AS sort_order,
         'PRECHECK STATUS' AS item,
         CASE
           WHEN (SELECT count(*) FROM report WHERE strpos(report.detail, 'stop here') > 0) > 0
             THEN 'STOP ' || (SELECT count(*) FROM report WHERE strpos(report.detail, 'stop here') > 0)::text
               || ' rows need review'
           WHEN (SELECT count(*) FROM report WHERE strpos(report.detail, 'adjust the rollback') > 0) > 0
             THEN 'CLEAN but adjust the rollback grants to the Q4 and Q7 lists then run the migration in a NEW tab'
           ELSE 'CLEAN run the migration in a NEW tab'
         END AS detail
  UNION ALL
  SELECT report.sort_order, report.item, report.detail FROM report
) AS final_report
ORDER BY final_report.sort_order, final_report.item;
