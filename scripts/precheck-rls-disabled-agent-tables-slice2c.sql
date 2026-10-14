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
         count(*) FILTER (WHERE role_held.is_held) AS held_total,
         count(*) FILTER (WHERE role_held.is_held AND role_held.is_signed_in_privilege) AS signed_in_held_total,
         count(*) FILTER (WHERE role_held.is_held AND NOT role_held.is_signed_in_privilege) AS extra_held_total,
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
table_policy AS (
  SELECT table_state.table_name,
         pg_policy.polname::text AS policy_name
  FROM table_state
  JOIN pg_catalog.pg_policy ON pg_policy.polrelid = table_state.table_oid
),
trigger_on_table AS (
  SELECT table_state.table_name,
         table_state.table_order,
         pg_trigger.tgname::text AS trigger_name,
         pg_trigger.tgenabled::text AS enabled_code,
         pg_trigger.tgfoid::regprocedure::text AS trigger_function,
         pg_proc.prosecdef AS runs_as_owner,
         md5(pg_proc.prosrc) AS body_md5
  FROM table_state
  JOIN pg_catalog.pg_trigger ON pg_trigger.tgrelid = table_state.table_oid AND NOT pg_trigger.tgisinternal
  JOIN pg_catalog.pg_proc ON pg_proc.oid = pg_trigger.tgfoid
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
pin_expected AS (
  SELECT pin_state.pin_table,
         pin_state.mismatch_total,
         pin_state.mismatch_md5,
         pin_state.null_agent_total,
         pin_state.agent_missing_total,
         pin_state.null_user_total,
         CASE pin_state.pin_table
           WHEN 'agent_configurations' THEN 3
           WHEN 'agent_executions' THEN 11
           ELSE 0
         END AS expected_total,
         CASE pin_state.pin_table
           WHEN 'agent_configurations' THEN 'b31a2dae58f839b033bbc32195c7ccb8'
           WHEN 'agent_executions' THEN '23439f4752cdf8364e0eeb43a04fc2ba'
         END AS expected_md5
  FROM pin_state
),
stats_mismatch AS (
  SELECT replace(mismatch_row.agent_id::text, chr(45), '') AS agent_hex,
         replace(mismatch_row.user_id::text, chr(45), '') AS old_user_hex,
         replace(mismatch_agent.user_id::text, chr(45), '') AS new_owner_hex,
         md5(mismatch_row.agent_id::text) = '2a4cf06b64f83d1f077506323dad7d7d' AS is_pinned_agent
  FROM public.agent_stats AS mismatch_row
  JOIN public.agents AS mismatch_agent ON mismatch_agent.id = mismatch_row.agent_id
  WHERE mismatch_agent.user_id IS DISTINCT FROM mismatch_row.user_id
),
row_total AS (
  SELECT 'agent_configurations' AS table_name, (SELECT count(*) FROM public.agent_configurations) AS row_count
  UNION ALL SELECT 'agent_executions', (SELECT count(*) FROM public.agent_executions)
  UNION ALL SELECT 'agent_logs', (SELECT count(*) FROM public.agent_logs)
  UNION ALL SELECT 'agent_stats', (SELECT count(*) FROM public.agent_stats)
  UNION ALL SELECT 'shared_agents', (SELECT count(*) FROM public.shared_agents)
  UNION ALL SELECT 'shared_agent_imports', (SELECT count(*) FROM public.shared_agent_imports)
),
function_body AS (
  SELECT pg_proc.oid::regprocedure::text AS function_name,
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
         function_body.runs_as_owner
  FROM watched
  JOIN function_body ON strpos(function_body.body_text, watched.table_name) > 0
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
report AS (
  SELECT 1 AS sort_order,
         'Q0 server version' AS item,
         pg_catalog.current_setting('server_version_num')
           || CASE WHEN pg_catalog.current_setting('server_version_num')::int >= 170000 THEN ' ok' ELSE ' below 17 so MAINTAIN is unknown stop here' END AS detail

  UNION ALL
  SELECT 2,
         'Q0 running role',
         current_user::text
           || CASE WHEN pg_catalog.pg_has_role(current_user, 'postgres', 'MEMBER') THEN ' ok' ELSE ' is not postgres so the migration cannot alter the tables stop here' END

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
              ELSE 'off and not forced ok' END
  FROM table_state

  UNION ALL
  SELECT role_summary.table_order * 1000 + 10 + role_summary.role_order,
         'Q4 privileges ' || role_summary.role_name || ' ' || role_summary.table_name,
         role_summary.held_list
           || CASE
                WHEN role_summary.role_name IN ('public', 'anon') AND role_summary.held_total = 0
                  THEN ' as the stopgap left it ok'
                WHEN role_summary.role_name IN ('public', 'anon')
                  THEN ' differs from the stopgap so the migration would refuse stop here'
                WHEN role_summary.role_name = 'authenticated' AND role_summary.signed_in_held_total = 4 AND role_summary.extra_held_total = 0
                  THEN ' exactly the four the rollback restores ok'
                WHEN role_summary.role_name = 'authenticated'
                  THEN ' differs from the four so the migration would refuse stop here'
                WHEN role_summary.signed_in_held_total = 4
                  THEN ' untouched by the migration ok'
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
         'Q7 owned sequences ' || table_state.table_name,
         (SELECT count(*) FROM owned_sequence WHERE owned_sequence.table_name = table_state.table_name)::text
           || CASE WHEN EXISTS (SELECT 1 FROM owned_sequence WHERE owned_sequence.table_name = table_state.table_name)
                   THEN ' so the migration would refuse stop here' ELSE ' ok' END
  FROM table_state

  UNION ALL
  SELECT table_state.table_order * 1000 + 50,
         'Q8 policies ' || table_state.table_name,
         (SELECT count(*) FROM table_policy WHERE table_policy.table_name = table_state.table_name)::text
           || CASE WHEN EXISTS (SELECT 1 FROM table_policy WHERE table_policy.table_name = table_state.table_name)
                   THEN ' so the migration would refuse stop here' ELSE ' ok' END
  FROM table_state

  UNION ALL
  SELECT trigger_on_table.table_order * 1000 + 60,
         'Q9 trigger ' || trigger_on_table.table_name,
         trigger_on_table.trigger_name || ' enabled ' || trigger_on_table.enabled_code
           || ' calls ' || trigger_on_table.trigger_function
           || CASE WHEN trigger_on_table.runs_as_owner THEN ' runs as owner' ELSE ' runs as caller' END
           || ' body md5 ' || trigger_on_table.body_md5 || ' information only'
  FROM trigger_on_table

  UNION ALL
  SELECT 7000,
         'Q11 routing decisions policy',
         boundary_summary.routing_match_total::text
           || CASE WHEN boundary_summary.routing_match_total = 1
                   THEN ' matches the capture ok' ELSE ' differs from the capture so the migration would refuse stop here' END
  FROM boundary_summary

  UNION ALL
  SELECT 7100,
         'Q12 agents policies',
         boundary_summary.agents_policy_total::text || ' total ' || boundary_summary.agents_match_total::text || ' match the capture'
           || CASE WHEN boundary_summary.agents_policy_total = 3 AND boundary_summary.agents_match_total = 3
                   THEN ' ok' ELSE ' so the migration would refuse stop here' END
  FROM boundary_summary

  UNION ALL
  SELECT 7200 + watched.table_order,
         'Q13 owner mismatch pin ' || pin_expected.pin_table,
         pin_expected.mismatch_total::text || ' rows md5 ' || COALESCE(pin_expected.mismatch_md5, 'none')
           || ' null agent ' || pin_expected.null_agent_total::text
           || ' agent missing ' || pin_expected.agent_missing_total::text
           || ' null user ' || pin_expected.null_user_total::text
           || CASE
                WHEN pin_expected.pin_table = 'agent_stats' AND pin_expected.mismatch_total = 1
                     AND pin_expected.mismatch_md5 = '2a4cf06b64f83d1f077506323dad7d7d'
                  THEN ' the D0a row is still there so run D0b first stop here'
                WHEN pin_expected.mismatch_total <> pin_expected.expected_total
                     OR pin_expected.mismatch_md5 IS DISTINCT FROM pin_expected.expected_md5
                  THEN ' differs from the pin so the migration would refuse stop here'
                WHEN pin_expected.null_agent_total <> 0 OR pin_expected.agent_missing_total <> 0 OR pin_expected.null_user_total <> 0
                  THEN ' a row has no agent or no user so the migration would refuse stop here'
                ELSE ' equals the pin ok'
              END
  FROM pin_expected
  JOIN watched ON watched.table_name = pin_expected.pin_table

  UNION ALL
  SELECT 7300,
         'Q13 D0b fill values',
         COALESCE(
           (SELECT string_agg('agent ' || stats_mismatch.agent_hex || ' old user ' || stats_mismatch.old_user_hex
                                || ' new owner ' || stats_mismatch.new_owner_hex
                                || CASE WHEN stats_mismatch.is_pinned_agent THEN ' is the D0a agent' ELSE ' is NOT the D0a agent' END,
                              ' and ' ORDER BY stats_mismatch.agent_hex COLLATE "C")
            FROM stats_mismatch),
           'none so D0b has run or there is nothing to reassign')

  UNION ALL
  SELECT 7400 + function_mention.table_order,
         'Q14 function mention ' || function_mention.table_name,
         function_mention.function_name
           || CASE WHEN function_mention.runs_as_owner THEN ' runs as owner' ELSE ' runs as caller' END
           || ' information only'
  FROM function_mention

  UNION ALL
  SELECT 7500 + policy_mention.table_order,
         'Q14 policy mention ' || policy_mention.table_name,
         policy_mention.policy_name || ' information only'
  FROM policy_mention

  UNION ALL
  SELECT 7600,
         'Q15 view agent_executions_with_details',
         CASE WHEN NOT EXISTS (SELECT 1 FROM view_state) THEN 'missing so the migration would refuse stop here'
              WHEN NOT (SELECT view_state.is_caller_rights FROM view_state) THEN 'not caller rights so the migration would refuse stop here'
              WHEN (SELECT pg_catalog.has_table_privilege('public', view_state.view_oid, 'SELECT')
                        OR pg_catalog.has_table_privilege('anon', view_state.view_oid, 'SELECT')
                        OR pg_catalog.has_table_privilege('authenticated', view_state.view_oid, 'SELECT')
                    FROM view_state)
                THEN 'a client role can read it so the migration would refuse stop here'
              ELSE 'caller rights and no client grant ok' END

  UNION ALL
  SELECT 7700 + watched.table_order,
         'Q16 row count ' || row_total.table_name,
         row_total.row_count::text || ' rows information only'
  FROM row_total
  JOIN watched ON watched.table_name = row_total.table_name
)
SELECT final_report.sort_order, final_report.item, final_report.detail
FROM (
  SELECT 0 AS sort_order,
         'PRECHECK STATUS' AS item,
         CASE
           WHEN (SELECT count(*) FROM report WHERE strpos(report.detail, 'stop here') > 0) > 0
             THEN 'STOP ' || (SELECT count(*) FROM report WHERE strpos(report.detail, 'stop here') > 0)::text
               || ' rows need review'
           ELSE 'CLEAN run the migration in a NEW tab'
         END AS detail
  UNION ALL
  SELECT report.sort_order, report.item, report.detail FROM report
) AS final_report
ORDER BY final_report.sort_order, final_report.item;
