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
         pg_catalog.pg_get_userbyid(pg_class.relowner)::text AS owner_name,
         pg_class.relrowsecurity AS rls_on
  FROM watched
  LEFT JOIN pg_catalog.pg_namespace ON pg_namespace.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class
    ON pg_class.relnamespace = pg_namespace.oid
   AND pg_class.relname = watched.table_name
   AND pg_class.relkind = 'r'
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
column_privilege AS (
  SELECT column_row.privilege_name
  FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) AS column_row (privilege_name)
),
sequence_privilege AS (
  SELECT sequence_row.privilege_name
  FROM (VALUES ('SELECT'), ('UPDATE'), ('USAGE')) AS sequence_row (privilege_name)
),
closed_role AS (
  SELECT closed_row.role_name
  FROM (VALUES ('public'), ('anon')) AS closed_row (role_name)
),
held AS (
  SELECT table_state.table_name,
         closed_role.role_name || ' ' || watched_privilege.privilege_name AS held_label,
         'closed' AS held_kind
  FROM table_state
  CROSS JOIN closed_role
  CROSS JOIN watched_privilege
  WHERE table_state.table_oid IS NOT NULL
    AND pg_catalog.has_table_privilege(closed_role.role_name, table_state.table_oid, watched_privilege.privilege_name)

  UNION ALL
  SELECT table_state.table_name,
         watched_privilege.privilege_name,
         'authenticated removed'
  FROM table_state
  CROSS JOIN watched_privilege
  WHERE table_state.table_oid IS NOT NULL
    AND NOT watched_privilege.is_signed_in_privilege
    AND pg_catalog.has_table_privilege('authenticated', table_state.table_oid, watched_privilege.privilege_name)

  UNION ALL
  SELECT table_state.table_name,
         watched_privilege.privilege_name,
         'authenticated kept missing'
  FROM table_state
  CROSS JOIN watched_privilege
  WHERE table_state.table_oid IS NOT NULL
    AND watched_privilege.is_signed_in_privilege
    AND NOT pg_catalog.has_table_privilege('authenticated', table_state.table_oid, watched_privilege.privilege_name)

  UNION ALL
  SELECT table_state.table_name,
         watched_privilege.privilege_name,
         'service_role missing'
  FROM table_state
  CROSS JOIN watched_privilege
  WHERE table_state.table_oid IS NOT NULL
    AND watched_privilege.is_signed_in_privilege
    AND NOT pg_catalog.has_table_privilege('service_role', table_state.table_oid, watched_privilege.privilege_name)

  UNION ALL
  SELECT table_state.table_name,
         closed_role.role_name || ' column ' || column_privilege.privilege_name,
         'column'
  FROM table_state
  CROSS JOIN closed_role
  CROSS JOIN column_privilege
  WHERE table_state.table_oid IS NOT NULL
    AND pg_catalog.has_any_column_privilege(closed_role.role_name, table_state.table_oid, column_privilege.privilege_name)

  UNION ALL
  SELECT table_state.table_name,
         sequence_class.relname || ' ' || closed_role.role_name || ' ' || sequence_privilege.privilege_name,
         'sequence'
  FROM table_state
  JOIN pg_catalog.pg_depend
    ON pg_depend.refobjid = table_state.table_oid
   AND pg_depend.classid = 'pg_class'::regclass
   AND pg_depend.refclassid = 'pg_class'::regclass
   AND pg_depend.deptype IN ('a', 'i')
  JOIN pg_catalog.pg_class AS sequence_class
    ON sequence_class.oid = pg_depend.objid
   AND sequence_class.relkind = 'S'
  CROSS JOIN closed_role
  CROSS JOIN sequence_privilege
  WHERE pg_catalog.has_sequence_privilege(closed_role.role_name, sequence_class.oid, sequence_privilege.privilege_name)
),
held_summary AS (
  SELECT table_state.table_name,
         table_state.table_order,
         table_state.table_oid,
         table_state.owner_name,
         table_state.rls_on,
         (SELECT string_agg(held.held_label, ' ' ORDER BY held.held_label COLLATE "C")
          FROM held WHERE held.table_name = table_state.table_name AND held.held_kind = 'closed') AS closed_list,
         (SELECT string_agg(held.held_label, ' ' ORDER BY held.held_label COLLATE "C")
          FROM held WHERE held.table_name = table_state.table_name AND held.held_kind = 'authenticated removed') AS removed_list,
         (SELECT string_agg(held.held_label, ' ' ORDER BY held.held_label COLLATE "C")
          FROM held WHERE held.table_name = table_state.table_name AND held.held_kind = 'authenticated kept missing') AS kept_missing_list,
         (SELECT string_agg(held.held_label, ' ' ORDER BY held.held_label COLLATE "C")
          FROM held WHERE held.table_name = table_state.table_name AND held.held_kind = 'service_role missing') AS service_missing_list,
         (SELECT string_agg(held.held_label, ' ' ORDER BY held.held_label COLLATE "C")
          FROM held WHERE held.table_name = table_state.table_name AND held.held_kind = 'column') AS column_list,
         (SELECT string_agg(held.held_label, ' ' ORDER BY held.held_label COLLATE "C")
          FROM held WHERE held.table_name = table_state.table_name AND held.held_kind = 'sequence') AS sequence_list,
         (SELECT count(*)
          FROM pg_catalog.pg_attribute
          WHERE pg_attribute.attrelid = table_state.table_oid
            AND pg_attribute.attnum > 0
            AND NOT pg_attribute.attisdropped
            AND pg_attribute.attacl IS NOT NULL) AS column_acl_total
  FROM table_state
),
checks AS (
  SELECT held_summary.table_order * 100 + 1 AS sort_order,
         'C1 exists ' || held_summary.table_name AS check_name,
         CASE WHEN held_summary.table_oid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result,
         CASE WHEN held_summary.table_oid IS NOT NULL THEN 'present' ELSE 'missing' END AS detail
  FROM held_summary

  UNION ALL
  SELECT held_summary.table_order * 100 + 2,
         'C2 owner postgres ' || held_summary.table_name,
         CASE WHEN held_summary.owner_name = 'postgres' THEN 'PASS' ELSE 'FAIL' END,
         COALESCE(held_summary.owner_name, 'missing')
  FROM held_summary

  UNION ALL
  SELECT held_summary.table_order * 100 + 3,
         'C3 row security still off ' || held_summary.table_name,
         CASE WHEN held_summary.rls_on IS FALSE THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN held_summary.table_oid IS NULL THEN 'table missing'
              WHEN held_summary.rls_on THEN 'on so full slice 2c has run and this checker no longer applies'
              ELSE 'off as the stopgap leaves it' END
  FROM held_summary

  UNION ALL
  SELECT held_summary.table_order * 100 + 4,
         'C4 anon and public hold no table privilege ' || held_summary.table_name,
         CASE WHEN held_summary.table_oid IS NOT NULL AND held_summary.closed_list IS NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN held_summary.table_oid IS NULL THEN 'table missing'
              ELSE COALESCE('held ' || held_summary.closed_list, 'none held') END
  FROM held_summary

  UNION ALL
  SELECT held_summary.table_order * 100 + 5,
         'C5 authenticated keeps SELECT INSERT UPDATE DELETE ' || held_summary.table_name,
         CASE WHEN held_summary.table_oid IS NOT NULL AND held_summary.kept_missing_list IS NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN held_summary.table_oid IS NULL THEN 'table missing'
              ELSE COALESCE('missing ' || held_summary.kept_missing_list, 'all four held') END
  FROM held_summary

  UNION ALL
  SELECT held_summary.table_order * 100 + 6,
         'C6 authenticated holds no TRUNCATE REFERENCES TRIGGER MAINTAIN ' || held_summary.table_name,
         CASE WHEN held_summary.table_oid IS NOT NULL AND held_summary.removed_list IS NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN held_summary.table_oid IS NULL THEN 'table missing'
              ELSE COALESCE('held ' || held_summary.removed_list, 'none held') END
  FROM held_summary

  UNION ALL
  SELECT held_summary.table_order * 100 + 7,
         'C7 service_role keeps SELECT INSERT UPDATE DELETE ' || held_summary.table_name,
         CASE WHEN held_summary.table_oid IS NOT NULL AND held_summary.service_missing_list IS NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN held_summary.table_oid IS NULL THEN 'table missing'
              ELSE COALESCE('missing ' || held_summary.service_missing_list, 'all four held') END
  FROM held_summary

  UNION ALL
  SELECT held_summary.table_order * 100 + 8,
         'C8 anon and public hold no column privilege ' || held_summary.table_name,
         CASE WHEN held_summary.table_oid IS NOT NULL AND held_summary.column_list IS NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN held_summary.table_oid IS NULL THEN 'table missing'
              ELSE COALESCE('held ' || held_summary.column_list, 'none held') END
  FROM held_summary

  UNION ALL
  SELECT held_summary.table_order * 100 + 9,
         'C9 no column acl ' || held_summary.table_name,
         CASE WHEN held_summary.table_oid IS NOT NULL AND held_summary.column_acl_total = 0 THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN held_summary.table_oid IS NULL THEN 'table missing'
              ELSE held_summary.column_acl_total::text || ' columns carry an acl expected 0' END
  FROM held_summary

  UNION ALL
  SELECT held_summary.table_order * 100 + 10,
         'C10 anon and public hold no owned sequence privilege ' || held_summary.table_name,
         CASE WHEN held_summary.table_oid IS NOT NULL AND held_summary.sequence_list IS NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN held_summary.table_oid IS NULL THEN 'table missing'
              ELSE COALESCE('held ' || held_summary.sequence_list, 'none held') END
  FROM held_summary
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
