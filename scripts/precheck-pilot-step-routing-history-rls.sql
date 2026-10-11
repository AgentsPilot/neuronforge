SET default_transaction_read_only = on;

WITH RECURSIVE target_table AS (
  SELECT pg_class.oid AS table_oid,
         pg_class.relkind AS table_relkind,
         pg_get_userbyid(pg_class.relowner) AS owner_name,
         pg_class.relrowsecurity AS rls_on,
         pg_class.relforcerowsecurity AS force_rls_on,
         COALESCE(pg_class.relacl, acldefault('r', pg_class.relowner)) AS table_acl
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname = 'pilot_step_routing_history'
),
pricing_table AS (
  SELECT pg_class.oid AS pricing_oid
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname = 'ai_model_pricing'
),
view_walk (view_oid, depth) AS (
  SELECT pg_rewrite.ev_class, 1
  FROM target_table
  JOIN pg_depend ON pg_depend.refclassid = 'pg_class'::regclass
                AND pg_depend.refobjid = target_table.table_oid
                AND pg_depend.classid = 'pg_rewrite'::regclass
  JOIN pg_rewrite ON pg_rewrite.oid = pg_depend.objid
  WHERE pg_rewrite.ev_class <> target_table.table_oid

  UNION

  SELECT pg_rewrite.ev_class, view_walk.depth + 1
  FROM view_walk
  JOIN pg_depend ON pg_depend.refclassid = 'pg_class'::regclass
                AND pg_depend.refobjid = view_walk.view_oid
                AND pg_depend.classid = 'pg_rewrite'::regclass
  JOIN pg_rewrite ON pg_rewrite.oid = pg_depend.objid
  WHERE pg_rewrite.ev_class <> view_walk.view_oid
    AND view_walk.depth < 10
),
dependent_views AS (
  SELECT view_walk.view_oid,
         min(view_walk.depth) AS depth
  FROM view_walk
  GROUP BY view_walk.view_oid
),
dependent_view_state AS (
  SELECT dependent_views.view_oid,
         dependent_views.depth,
         pg_namespace.nspname AS schema_name,
         pg_class.relname AS view_name,
         pg_class.relkind AS view_relkind,
         pg_get_userbyid(pg_class.relowner) AS owner_name,
         pg_class.relispopulated AS is_populated,
         COALESCE(array_to_string(pg_class.reloptions, ' '), 'none') AS view_options,
         COALESCE(pg_class.relacl, acldefault('r', pg_class.relowner))::text AS view_acl,
         EXISTS (
           SELECT 1
           FROM pg_rewrite AS own_rule
           JOIN pg_depend AS own_dependency ON own_dependency.classid = 'pg_rewrite'::regclass
                                           AND own_dependency.objid = own_rule.oid
                                           AND own_dependency.refclassid = 'pg_class'::regclass
           JOIN pricing_table ON pricing_table.pricing_oid = own_dependency.refobjid
           WHERE own_rule.ev_class = dependent_views.view_oid
         ) AS reads_pricing_directly
  FROM dependent_views
  JOIN pg_class ON pg_class.oid = dependent_views.view_oid
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
),
table_grants AS (
  SELECT CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname::text END AS grantee_name,
         acl_item.privilege_type,
         acl_item.is_grantable
  FROM target_table
  CROSS JOIN LATERAL aclexplode(target_table.table_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
),
grantee_names AS (
  SELECT listed.grantee_name, listed.grantee_order
  FROM (VALUES ('PUBLIC', 1), ('postgres', 2), ('anon', 3), ('authenticated', 4), ('service_role', 5)) AS listed (grantee_name, grantee_order)
  UNION
  SELECT table_grants.grantee_name, 9
  FROM table_grants
  WHERE table_grants.grantee_name NOT IN ('PUBLIC', 'postgres', 'anon', 'authenticated', 'service_role')
),
column_grants AS (
  SELECT pg_attribute.attname::text AS column_name,
         CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname::text END AS grantee_name,
         string_agg(acl_item.privilege_type, ' ' ORDER BY acl_item.privilege_type) AS privileges
  FROM target_table
  JOIN pg_attribute ON pg_attribute.attrelid = target_table.table_oid
  CROSS JOIN LATERAL aclexplode(pg_attribute.attacl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
  WHERE pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
    AND pg_attribute.attacl IS NOT NULL
  GROUP BY pg_attribute.attname, acl_item.grantee, grantee_role.rolname
),
table_policies AS (
  SELECT pg_policies.policyname,
         pg_policies.permissive,
         pg_policies.roles::text AS role_list,
         pg_policies.cmd,
         pg_policies.qual,
         pg_policies.with_check
  FROM pg_policies
  WHERE pg_policies.schemaname = 'public'
    AND pg_policies.tablename = 'pilot_step_routing_history'
),
table_foreign_keys AS (
  SELECT pg_constraint.conname::text AS constraint_name,
         pg_get_constraintdef(pg_constraint.oid) AS constraint_definition,
         CASE pg_constraint.confdeltype
           WHEN 'a' THEN 'no action'
           WHEN 'r' THEN 'restrict'
           WHEN 'c' THEN 'cascade'
           WHEN 'n' THEN 'set null'
           WHEN 'd' THEN 'set default'
           ELSE 'unknown'
         END AS on_delete
  FROM target_table
  JOIN pg_constraint ON pg_constraint.conrelid = target_table.table_oid
  WHERE pg_constraint.contype = 'f'
),
public_functions AS (
  SELECT pg_proc.oid AS function_oid,
         pg_namespace.nspname AS schema_name,
         pg_proc.proname::text AS function_name,
         pg_get_function_identity_arguments(pg_proc.oid) AS identity_arguments,
         pg_get_userbyid(pg_proc.proowner) AS owner_name,
         pg_proc.prosecdef AS runs_as_owner,
         pg_proc.proacl,
         pg_proc.prosrc
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname NOT IN ('pg_catalog', 'information_schema')
),
report AS (
  SELECT 0 AS sort_order,
         'READ ME' AS item,
         'this session is now read only so run the migration in a NEW tab' AS detail

  UNION ALL
  SELECT 100,
         'Q1 table pilot_step_routing_history',
         COALESCE(
           (SELECT 'exists relkind ' || target_table.table_relkind::text
                   || ' owner ' || target_table.owner_name
                   || ' rls ' || target_table.rls_on::text
                   || ' force rls ' || target_table.force_rls_on::text
            FROM target_table),
           'MISSING stop here'
         )

  UNION ALL
  SELECT 200,
         'Q2 table acl raw',
         COALESCE((SELECT target_table.table_acl::text FROM target_table), 'table missing')

  UNION ALL
  SELECT 300 + grantee_names.grantee_order * 10
           + (row_number() OVER (PARTITION BY grantee_names.grantee_order ORDER BY grantee_names.grantee_name))::int,
         'Q3 table grants ' || grantee_names.grantee_name,
         COALESCE(
           (SELECT string_agg(table_grants.privilege_type
                                || CASE WHEN table_grants.is_grantable THEN ' grantable' ELSE '' END,
                              ' ' ORDER BY table_grants.privilege_type)
            FROM table_grants
            WHERE table_grants.grantee_name = grantee_names.grantee_name),
           'none'
         )
  FROM grantee_names

  UNION ALL
  SELECT 400,
         'Q4 column privileges count',
         (SELECT count(*) FROM column_grants)::text || ' rows'
  UNION ALL
  SELECT 400 + (row_number() OVER (ORDER BY column_grants.column_name, column_grants.grantee_name))::int,
         'Q4 column privilege ' || column_grants.column_name || ' ' || column_grants.grantee_name,
         column_grants.privileges
  FROM column_grants

  UNION ALL
  SELECT 500,
         'Q5 policy count',
         (SELECT count(*) FROM table_policies)::text
  UNION ALL
  SELECT 500 + (row_number() OVER (ORDER BY table_policies.policyname))::int,
         'Q5 policy ' || table_policies.policyname,
         'permissive ' || table_policies.permissive
           || ' roles ' || table_policies.role_list
           || ' cmd ' || table_policies.cmd
           || ' qual ' || COALESCE(table_policies.qual, 'none')
           || ' check ' || COALESCE(table_policies.with_check, 'none')
           || ' qual md5 ' || COALESCE(md5(table_policies.qual), 'none')
           || ' check md5 ' || COALESCE(md5(table_policies.with_check), 'none')
  FROM table_policies

  UNION ALL
  SELECT 600,
         'Q6 foreign key count',
         (SELECT count(*) FROM table_foreign_keys)::text
  UNION ALL
  SELECT 600 + (row_number() OVER (ORDER BY table_foreign_keys.constraint_name))::int,
         'Q6 foreign key ' || table_foreign_keys.constraint_name,
         'ondelete ' || table_foreign_keys.on_delete || ' definition ' || table_foreign_keys.constraint_definition
  FROM table_foreign_keys

  UNION ALL
  SELECT 700,
         'Q7 dependent view count',
         (SELECT count(*) FROM dependent_view_state)::text
  UNION ALL
  SELECT 700 + (row_number() OVER (ORDER BY dependent_view_state.depth, dependent_view_state.schema_name, dependent_view_state.view_name))::int,
         'Q7 view ' || dependent_view_state.schema_name || ' ' || dependent_view_state.view_name,
         'depth ' || dependent_view_state.depth::text
           || ' relkind ' || dependent_view_state.view_relkind::text
           || ' owner ' || dependent_view_state.owner_name
           || ' populated ' || CASE WHEN dependent_view_state.view_relkind = 'm'
                                    THEN dependent_view_state.is_populated::text
                                    ELSE 'not a matview' END
           || ' options ' || dependent_view_state.view_options
           || ' reads ai_model_pricing directly ' || dependent_view_state.reads_pricing_directly::text
           || ' anon select ' || has_table_privilege('anon', dependent_view_state.view_oid, 'SELECT')::text
           || ' authenticated select ' || has_table_privilege('authenticated', dependent_view_state.view_oid, 'SELECT')::text
           || ' acl ' || dependent_view_state.view_acl
  FROM dependent_view_state
  UNION ALL
  SELECT 790,
         'Q7 depth 1 views reading ai_model_pricing directly expected 1',
         (SELECT count(*) FROM dependent_view_state
          WHERE dependent_view_state.depth = 1
            AND dependent_view_state.reads_pricing_directly)::text
  UNION ALL
  SELECT 791,
         'Q7 ai_model_pricing table found',
         (SELECT count(*) FROM pricing_table)::text

  UNION ALL
  SELECT 800,
         'Q8 cleanup function count',
         (SELECT count(*) FROM public_functions
          WHERE public_functions.schema_name = 'public'
            AND public_functions.function_name = 'operator_test_account_cleanup')::text
  UNION ALL
  SELECT 800 + (row_number() OVER (ORDER BY public_functions.identity_arguments))::int,
         'Q8 cleanup function ' || public_functions.function_name,
         'owner ' || public_functions.owner_name
           || ' runs as owner ' || public_functions.runs_as_owner::text
           || ' args ' || public_functions.identity_arguments
           || ' acl ' || COALESCE(public_functions.proacl::text, 'default')
  FROM public_functions
  WHERE public_functions.schema_name = 'public'
    AND public_functions.function_name = 'operator_test_account_cleanup'

  UNION ALL
  SELECT 820,
         'Q8 is_platform_admin count',
         (SELECT count(*) FROM public_functions
          WHERE public_functions.schema_name = 'public'
            AND public_functions.function_name = 'is_platform_admin')::text
  UNION ALL
  SELECT 820 + (row_number() OVER (ORDER BY public_functions.identity_arguments))::int,
         'Q8 is_platform_admin',
         'args ' || public_functions.identity_arguments
           || ' authenticated execute ' || has_function_privilege('authenticated', public_functions.function_oid, 'EXECUTE')::text
           || ' service_role execute ' || has_function_privilege('service_role', public_functions.function_oid, 'EXECUTE')::text
           || ' anon execute ' || has_function_privilege('anon', public_functions.function_oid, 'EXECUTE')::text
  FROM public_functions
  WHERE public_functions.schema_name = 'public'
    AND public_functions.function_name = 'is_platform_admin'

  UNION ALL
  SELECT 850,
         'Q8 functions naming the table count',
         (SELECT count(*) FROM public_functions
          WHERE strpos(lower(public_functions.prosrc), 'pilot_step_routing_history') > 0)::text
  UNION ALL
  SELECT 850 + (row_number() OVER (ORDER BY public_functions.schema_name, public_functions.function_name, public_functions.identity_arguments))::int,
         'Q8 function naming the table ' || public_functions.schema_name || ' ' || public_functions.function_name,
         'owner ' || public_functions.owner_name
           || ' runs as owner ' || public_functions.runs_as_owner::text
           || ' anon execute ' || has_function_privilege('anon', public_functions.function_oid, 'EXECUTE')::text
           || ' authenticated execute ' || has_function_privilege('authenticated', public_functions.function_oid, 'EXECUTE')::text
           || ' args ' || public_functions.identity_arguments
  FROM public_functions
  WHERE strpos(lower(public_functions.prosrc), 'pilot_step_routing_history') > 0

  UNION ALL
  SELECT 900, 'Q9 rows total',
         (SELECT count(*) FROM public.pilot_step_routing_history)::text
  UNION ALL
  SELECT 901, 'Q9 rows with a user id',
         (SELECT count(*) FROM public.pilot_step_routing_history
          WHERE pilot_step_routing_history.user_id IS NOT NULL)::text
  UNION ALL
  SELECT 902, 'Q9 rows created after 2025 11 12',
         (SELECT count(*) FROM public.pilot_step_routing_history
          WHERE pilot_step_routing_history.created_at > make_date(2025, 11, 12))::text

  UNION ALL
  SELECT 950, 'Q10 server version num', current_setting('server_version_num')
  UNION ALL
  SELECT 999, 'checked at utc', (now() AT TIME ZONE 'UTC')::text
)
SELECT report.sort_order, report.item, report.detail
FROM report
ORDER BY report.sort_order, report.item;
