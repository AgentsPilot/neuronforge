SET default_transaction_read_only = on;

WITH watched AS (
  SELECT watched_row.table_name, watched_row.table_order, watched_row.is_owner_table, watched_row.planned_list
  FROM (VALUES
    ('agent_configurations', 1, true, 'INSERT SELECT UPDATE'),
    ('agent_executions', 2, true, 'INSERT SELECT UPDATE'),
    ('agent_logs', 3, true, 'INSERT SELECT UPDATE'),
    ('agent_stats', 4, true, 'INSERT SELECT UPDATE'),
    ('shared_agents', 5, false, 'none'),
    ('shared_agent_imports', 6, false, 'none')
  ) AS watched_row (table_name, table_order, is_owner_table, planned_list)
),
table_state AS (
  SELECT watched.table_name,
         watched.table_order,
         watched.is_owner_table,
         watched.planned_list,
         pg_class.oid AS table_oid,
         pg_catalog.pg_get_userbyid(pg_class.relowner)::text AS owner_name,
         pg_class.relrowsecurity AS rls_on,
         pg_class.relforcerowsecurity AS rls_forced
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
         'authenticated'
  FROM table_state
  CROSS JOIN watched_privilege
  WHERE table_state.table_oid IS NOT NULL
    AND pg_catalog.has_table_privilege('authenticated', table_state.table_oid, watched_privilege.privilege_name)

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
),
planned_policy AS (
  SELECT table_state.table_name,
         table_state.table_name || policy_row.name_suffix AS policy_name,
         policy_row.command_name,
         policy_row.needs_qual,
         policy_row.needs_check
  FROM table_state
  CROSS JOIN (VALUES
    ('_owner_select', 'SELECT', true, false),
    ('_owner_insert', 'INSERT', false, true),
    ('_owner_update', 'UPDATE', true, true)
  ) AS policy_row (name_suffix, command_name, needs_qual, needs_check)
  WHERE table_state.is_owner_table
),
actual_policy AS (
  SELECT pg_policies.tablename::text AS table_name,
         pg_policies.policyname::text AS policy_name,
         pg_policies.cmd AS command_name,
         pg_policies.permissive,
         array_to_string(pg_policies.roles, ' ') AS role_list,
         pg_policies.qual,
         pg_policies.with_check
  FROM pg_catalog.pg_policies
  JOIN watched ON watched.table_name = pg_policies.tablename
  WHERE pg_policies.schemaname = 'public'
),
policy_match AS (
  SELECT actual_policy.table_name,
         actual_policy.policy_name,
         (planned_policy.policy_name IS NOT NULL
          AND actual_policy.permissive = 'PERMISSIVE'
          AND actual_policy.role_list = 'authenticated'
          AND (planned_policy.needs_qual = (actual_policy.qual IS NOT NULL))
          AND (planned_policy.needs_check = (actual_policy.with_check IS NOT NULL))
          AND (NOT planned_policy.needs_qual OR strpos(actual_policy.qual, 'uid') > 0)
          AND (NOT planned_policy.needs_check OR (strpos(actual_policy.with_check, 'uid') > 0
                                                  AND strpos(actual_policy.with_check, 'owned_agent') > 0
                                                  AND strpos(actual_policy.with_check, 'agents') > 0))) AS is_planned,
         actual_policy.policy_name || ' ' || actual_policy.command_name
           || ' qual ' || COALESCE(md5(actual_policy.qual), 'none')
           || ' check ' || COALESCE(md5(actual_policy.with_check), 'none') AS policy_label
  FROM actual_policy
  LEFT JOIN planned_policy
    ON planned_policy.table_name = actual_policy.table_name
   AND planned_policy.policy_name = actual_policy.policy_name
   AND planned_policy.command_name = actual_policy.command_name
),
held_summary AS (
  SELECT table_state.table_name,
         table_state.table_order,
         table_state.is_owner_table,
         table_state.planned_list,
         table_state.table_oid,
         table_state.owner_name,
         table_state.rls_on,
         table_state.rls_forced,
         (SELECT string_agg(held.held_label, ' ' ORDER BY held.held_label COLLATE "C")
          FROM held WHERE held.table_name = table_state.table_name AND held.held_kind = 'closed') AS closed_list,
         COALESCE((SELECT string_agg(held.held_label, ' ' ORDER BY held.held_label COLLATE "C")
                   FROM held WHERE held.table_name = table_state.table_name AND held.held_kind = 'authenticated'), 'none') AS authenticated_list,
         (SELECT string_agg(held.held_label, ' ' ORDER BY held.held_label COLLATE "C")
          FROM held WHERE held.table_name = table_state.table_name AND held.held_kind = 'service_role missing') AS service_missing_list,
         (SELECT string_agg(held.held_label, ' ' ORDER BY held.held_label COLLATE "C")
          FROM held WHERE held.table_name = table_state.table_name AND held.held_kind = 'column') AS column_list,
         (SELECT count(*)
          FROM pg_catalog.pg_attribute
          WHERE pg_attribute.attrelid = table_state.table_oid
            AND pg_attribute.attnum > 0
            AND NOT pg_attribute.attisdropped
            AND pg_attribute.attacl IS NOT NULL) AS column_acl_total,
         (SELECT count(*) FROM policy_match WHERE policy_match.table_name = table_state.table_name) AS policy_total,
         (SELECT count(*) FROM policy_match WHERE policy_match.table_name = table_state.table_name AND policy_match.is_planned) AS planned_total,
         COALESCE((SELECT string_agg(policy_match.policy_label, ' and ' ORDER BY policy_match.policy_label COLLATE "C")
                   FROM policy_match WHERE policy_match.table_name = table_state.table_name), 'no policy') AS policy_list
  FROM table_state
),
pin_state AS (
  SELECT 'agent_configurations' AS pin_table,
         count(*) FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id) AS mismatch_total,
         md5(string_agg(pin_row.id::text, chr(44) ORDER BY pin_row.id::text COLLATE "C")
               FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id)) AS mismatch_md5,
         count(*) FILTER (WHERE pin_row.agent_id IS NULL) AS null_agent_total,
         count(*) FILTER (WHERE pin_row.agent_id IS NOT NULL AND pin_agent.id IS NULL) AS agent_missing_total,
         count(*) FILTER (WHERE pin_row.user_id IS NULL) AS null_user_total
  FROM public.agent_configurations AS pin_row
  LEFT JOIN public.agents AS pin_agent ON pin_agent.id = pin_row.agent_id
  UNION ALL
  SELECT 'agent_executions',
         count(*) FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id),
         md5(string_agg(pin_row.id::text, chr(44) ORDER BY pin_row.id::text COLLATE "C")
               FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id)),
         count(*) FILTER (WHERE pin_row.agent_id IS NULL),
         count(*) FILTER (WHERE pin_row.agent_id IS NOT NULL AND pin_agent.id IS NULL),
         count(*) FILTER (WHERE pin_row.user_id IS NULL)
  FROM public.agent_executions AS pin_row
  LEFT JOIN public.agents AS pin_agent ON pin_agent.id = pin_row.agent_id
  UNION ALL
  SELECT 'agent_logs',
         count(*) FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id),
         md5(string_agg(pin_row.id::text, chr(44) ORDER BY pin_row.id::text COLLATE "C")
               FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id)),
         count(*) FILTER (WHERE pin_row.agent_id IS NULL),
         count(*) FILTER (WHERE pin_row.agent_id IS NOT NULL AND pin_agent.id IS NULL),
         count(*) FILTER (WHERE pin_row.user_id IS NULL)
  FROM public.agent_logs AS pin_row
  LEFT JOIN public.agents AS pin_agent ON pin_agent.id = pin_row.agent_id
  UNION ALL
  SELECT 'agent_stats',
         count(*) FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id),
         md5(string_agg(pin_row.agent_id::text, chr(44) ORDER BY pin_row.agent_id::text COLLATE "C")
               FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id)),
         count(*) FILTER (WHERE pin_row.agent_id IS NULL),
         count(*) FILTER (WHERE pin_row.agent_id IS NOT NULL AND pin_agent.id IS NULL),
         count(*) FILTER (WHERE pin_row.user_id IS NULL)
  FROM public.agent_stats AS pin_row
  LEFT JOIN public.agents AS pin_agent ON pin_agent.id = pin_row.agent_id
  UNION ALL
  SELECT 'shared_agents',
         count(*) FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id),
         md5(string_agg(pin_row.id::text, chr(44) ORDER BY pin_row.id::text COLLATE "C")
               FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.user_id)),
         count(*) FILTER (WHERE pin_row.original_agent_id IS NULL),
         count(*) FILTER (WHERE pin_row.original_agent_id IS NOT NULL AND pin_agent.id IS NULL),
         count(*) FILTER (WHERE pin_row.user_id IS NULL)
  FROM public.shared_agents AS pin_row
  LEFT JOIN public.agents AS pin_agent ON pin_agent.id = pin_row.original_agent_id
  UNION ALL
  SELECT 'shared_agent_imports',
         count(*) FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.imported_by_user_id),
         md5(string_agg(pin_row.id::text, chr(44) ORDER BY pin_row.id::text COLLATE "C")
               FILTER (WHERE pin_agent.id IS NOT NULL AND pin_agent.user_id IS DISTINCT FROM pin_row.imported_by_user_id)),
         count(*) FILTER (WHERE pin_row.created_agent_id IS NULL),
         count(*) FILTER (WHERE pin_row.created_agent_id IS NOT NULL AND pin_agent.id IS NULL),
         count(*) FILTER (WHERE pin_row.imported_by_user_id IS NULL)
  FROM public.shared_agent_imports AS pin_row
  LEFT JOIN public.agents AS pin_agent ON pin_agent.id = pin_row.created_agent_id
),
pin_summary AS (
  SELECT count(*) AS table_total,
         count(*) FILTER (
           WHERE pin_state.mismatch_total = CASE pin_state.pin_table
                                              WHEN 'agent_configurations' THEN 3
                                              WHEN 'agent_executions' THEN 11
                                              ELSE 0
                                            END
             AND pin_state.mismatch_md5 IS NOT DISTINCT FROM CASE pin_state.pin_table
                                                               WHEN 'agent_configurations' THEN 'b31a2dae58f839b033bbc32195c7ccb8'
                                                               WHEN 'agent_executions' THEN '23439f4752cdf8364e0eeb43a04fc2ba'
                                                             END
             AND pin_state.null_agent_total = 0
             AND pin_state.agent_missing_total = 0
             AND pin_state.null_user_total = 0) AS matching_total,
         string_agg(pin_state.pin_table || ' ' || pin_state.mismatch_total::text, ' ' ORDER BY pin_state.pin_table COLLATE "C") AS mismatch_list
  FROM pin_state
),
boundary_policy AS (
  SELECT pg_policies.tablename::text AS table_name,
         pg_policies.policyname::text AS policy_name,
         pg_policies.cmd,
         array_to_string(pg_policies.roles, ' ') AS role_list,
         COALESCE(md5(pg_policies.qual), 'none') AS qual_md5,
         COALESCE(md5(pg_policies.with_check), 'none') AS check_md5
  FROM pg_catalog.pg_policies
  WHERE pg_policies.schemaname = 'public'
    AND pg_policies.tablename IN ('agents', 'execution_routing_decisions')
),
boundary_summary AS (
  SELECT (SELECT count(*) FROM boundary_policy
          WHERE boundary_policy.table_name = 'execution_routing_decisions'
            AND boundary_policy.policy_name = 'Users can view their execution routing decisions'
            AND boundary_policy.cmd = 'SELECT'
            AND boundary_policy.role_list = 'public'
            AND boundary_policy.qual_md5 = '97a65517eb8b8a5ca555fdd3dd99efcc'
            AND boundary_policy.check_md5 = 'none') AS routing_match_total,
         (SELECT count(*) FROM boundary_policy WHERE boundary_policy.table_name = 'agents') AS agents_policy_total,
         (SELECT count(*) FROM boundary_policy
          WHERE boundary_policy.table_name = 'agents'
            AND boundary_policy.role_list = 'public'
            AND boundary_policy.qual_md5 = '19300d155780585259ede73ac370586c'
            AND ((boundary_policy.policy_name = 'Allow read access to own agents' AND boundary_policy.cmd = 'SELECT' AND boundary_policy.check_md5 = 'none')
              OR (boundary_policy.policy_name = 'Allow user access to own agents' AND boundary_policy.cmd = 'ALL' AND boundary_policy.check_md5 = '19300d155780585259ede73ac370586c')
              OR (boundary_policy.policy_name = 'Users can view their own agents' AND boundary_policy.cmd = 'SELECT' AND boundary_policy.check_md5 = 'none'))) AS agents_match_total
),
view_state AS (
  SELECT pg_class.oid AS view_oid,
         EXISTS (
           SELECT 1
           FROM pg_catalog.pg_options_to_table(pg_class.reloptions) AS view_option
           WHERE view_option.option_name = 'security_invoker'
             AND view_option.option_value IN ('true', 'on', '1')
         ) AS is_caller_rights
  FROM pg_catalog.pg_class
  JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname = 'agent_executions_with_details'
    AND pg_class.relkind = 'v'
),
import_trigger AS (
  SELECT pg_trigger.tgenabled::text AS enabled_code,
         pg_proc.prosecdef AS runs_as_owner,
         pg_proc.proname::text AS function_name
  FROM pg_catalog.pg_trigger
  JOIN pg_catalog.pg_proc ON pg_proc.oid = pg_trigger.tgfoid
  JOIN table_state ON table_state.table_oid = pg_trigger.tgrelid
  WHERE table_state.table_name = 'shared_agent_imports'
    AND pg_trigger.tgname = 'trigger_increment_shared_agent_import_count'
),
owned_sequence AS (
  SELECT count(*) AS sequence_total
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
         'C3 row security on ' || held_summary.table_name,
         CASE WHEN held_summary.rls_on IS TRUE THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN held_summary.table_oid IS NULL THEN 'table missing'
              WHEN held_summary.rls_on THEN 'on'
              ELSE 'off' END
  FROM held_summary

  UNION ALL
  SELECT held_summary.table_order * 100 + 4,
         'C4 row security not forced ' || held_summary.table_name,
         CASE WHEN held_summary.rls_forced IS FALSE THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN held_summary.table_oid IS NULL THEN 'table missing'
              WHEN held_summary.rls_forced THEN 'forced'
              ELSE 'not forced' END
  FROM held_summary

  UNION ALL
  SELECT held_summary.table_order * 100 + 5,
         'C5 anon and public hold no table privilege ' || held_summary.table_name,
         CASE WHEN held_summary.table_oid IS NOT NULL AND held_summary.closed_list IS NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN held_summary.table_oid IS NULL THEN 'table missing'
              ELSE COALESCE('held ' || held_summary.closed_list, 'none held') END
  FROM held_summary

  UNION ALL
  SELECT held_summary.table_order * 100 + 6,
         'C6 anon and public hold no column privilege ' || held_summary.table_name,
         CASE WHEN held_summary.table_oid IS NOT NULL AND held_summary.column_list IS NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN held_summary.table_oid IS NULL THEN 'table missing'
              ELSE COALESCE('held ' || held_summary.column_list, 'none held') END
  FROM held_summary

  UNION ALL
  SELECT held_summary.table_order * 100 + 7,
         'C7 authenticated holds exactly the planned set ' || held_summary.table_name,
         CASE WHEN held_summary.table_oid IS NOT NULL AND held_summary.authenticated_list = held_summary.planned_list THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN held_summary.table_oid IS NULL THEN 'table missing'
              ELSE 'holds ' || held_summary.authenticated_list || ' planned ' || held_summary.planned_list END
  FROM held_summary

  UNION ALL
  SELECT held_summary.table_order * 100 + 8,
         'C8 service_role keeps SELECT INSERT UPDATE DELETE ' || held_summary.table_name,
         CASE WHEN held_summary.table_oid IS NOT NULL AND held_summary.service_missing_list IS NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN held_summary.table_oid IS NULL THEN 'table missing'
              ELSE COALESCE('missing ' || held_summary.service_missing_list, 'all four held') END
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
         'C10 exact policy set ' || held_summary.table_name,
         CASE WHEN held_summary.table_oid IS NOT NULL
                   AND held_summary.policy_total = CASE WHEN held_summary.is_owner_table THEN 3 ELSE 0 END
                   AND held_summary.planned_total = held_summary.policy_total
              THEN 'PASS' ELSE 'FAIL' END,
         held_summary.planned_total::text || ' of ' || held_summary.policy_total::text || ' as planned '
           || held_summary.policy_list
  FROM held_summary

  UNION ALL
  SELECT 1001,
         'B1 owner mismatch set equals the pin',
         CASE WHEN pin_summary.table_total = 6 AND pin_summary.matching_total = 6 THEN 'PASS' ELSE 'FAIL' END,
         pin_summary.matching_total::text || ' of ' || pin_summary.table_total::text || ' tables match ' || pin_summary.mismatch_list
  FROM pin_summary

  UNION ALL
  SELECT 1002,
         'B2 routing decisions policy unchanged',
         CASE WHEN boundary_summary.routing_match_total = 1 THEN 'PASS' ELSE 'FAIL' END,
         boundary_summary.routing_match_total::text || ' matching policy'
  FROM boundary_summary

  UNION ALL
  SELECT 1003,
         'B3 agents policies unchanged',
         CASE WHEN boundary_summary.agents_policy_total = 3 AND boundary_summary.agents_match_total = 3 THEN 'PASS' ELSE 'FAIL' END,
         boundary_summary.agents_policy_total::text || ' total ' || boundary_summary.agents_match_total::text || ' match the capture'
  FROM boundary_summary

  UNION ALL
  SELECT 1004,
         'B4 view agent_executions_with_details caller rights and no client grant',
         CASE WHEN EXISTS (
                SELECT 1 FROM view_state
                WHERE view_state.is_caller_rights
                  AND NOT pg_catalog.has_table_privilege('public', view_state.view_oid, 'SELECT')
                  AND NOT pg_catalog.has_table_privilege('anon', view_state.view_oid, 'SELECT')
                  AND NOT pg_catalog.has_table_privilege('authenticated', view_state.view_oid, 'SELECT'))
              THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN NOT EXISTS (SELECT 1 FROM view_state) THEN 'view missing' ELSE 'checked' END

  UNION ALL
  SELECT 1005,
         'B5 import counter trigger untouched',
         CASE WHEN EXISTS (
                SELECT 1 FROM import_trigger
                WHERE import_trigger.enabled_code = 'O'
                  AND NOT import_trigger.runs_as_owner
                  AND import_trigger.function_name = 'increment_shared_agent_import_count')
              THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT 'enabled ' || import_trigger.enabled_code
                          || CASE WHEN import_trigger.runs_as_owner THEN ' runs as owner' ELSE ' runs as caller' END
                   FROM import_trigger), 'trigger missing')

  UNION ALL
  SELECT 1006,
         'B6 no owned sequence on the six tables',
         CASE WHEN owned_sequence.sequence_total = 0 THEN 'PASS' ELSE 'FAIL' END,
         owned_sequence.sequence_total::text || ' owned sequences'
  FROM owned_sequence
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
