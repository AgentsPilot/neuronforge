SET default_transaction_read_only = on;

WITH secdef_fn AS (
  SELECT proc_row.oid AS fn_oid,
         namespace_row.nspname AS schema_name,
         proc_row.proname AS fn_name,
         pg_get_function_identity_arguments(proc_row.oid) AS identity_args,
         proc_row.prorettype = 'trigger'::regtype AS is_trigger,
         CASE WHEN proc_row.proretset THEN 'setof ' ELSE '' END
           || format_type(proc_row.prorettype, NULL) AS return_type,
         proc_row.pronargs AS arg_count,
         proc_row.pronargs - proc_row.pronargdefaults AS min_args,
         CASE proc_row.provolatile WHEN 'v' THEN 'volatile' WHEN 's' THEN 'stable' ELSE 'immutable' END AS volatility,
         (SELECT substr(config_item, 13)
          FROM unnest(proc_row.proconfig) AS config_item
          WHERE left(config_item, 11) = 'search_path'
          LIMIT 1) AS search_path_value,
         COALESCE(proc_row.proacl, acldefault('f', proc_row.proowner)) AS fn_acl,
         pg_get_userbyid(proc_row.proowner)::text AS owner_name
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace_row ON namespace_row.oid = proc_row.pronamespace
  WHERE proc_row.prosecdef
    AND namespace_row.nspname NOT IN ('pg_catalog', 'information_schema')
    AND left(namespace_row.nspname, 3) <> 'pg_'
),
public_fn AS (
  SELECT secdef_fn.*,
         has_function_privilege('public', secdef_fn.fn_oid, 'EXECUTE') AS exec_public,
         has_function_privilege('anon', secdef_fn.fn_oid, 'EXECUTE') AS exec_anon,
         has_function_privilege('authenticated', secdef_fn.fn_oid, 'EXECUTE') AS exec_auth,
         has_function_privilege('service_role', secdef_fn.fn_oid, 'EXECUTE') AS exec_service,
         EXISTS (SELECT 1 FROM aclexplode(secdef_fn.fn_acl) AS acl_item
                 WHERE acl_item.grantee = 0 AND acl_item.privilege_type = 'EXECUTE') AS public_acl_entry,
         (SELECT string_agg(CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl_item.grantee)::text END,
                            ' ')
          FROM aclexplode(secdef_fn.fn_acl) AS acl_item
          WHERE acl_item.privilege_type = 'EXECUTE') AS execute_grantees,
         (SELECT count(*) FROM pg_trigger AS trigger_row
          WHERE trigger_row.tgfoid = secdef_fn.fn_oid AND NOT trigger_row.tgisinternal) AS trigger_count
  FROM secdef_fn
  WHERE secdef_fn.schema_name = 'public'
),
other_schemas AS (
  SELECT secdef_fn.schema_name,
         count(*) AS fn_count,
         count(*) FILTER (WHERE has_function_privilege('anon', secdef_fn.fn_oid, 'EXECUTE')) AS anon_count
  FROM secdef_fn
  WHERE secdef_fn.schema_name <> 'public'
  GROUP BY secdef_fn.schema_name
),
report AS (
  SELECT 1 AS sort_order, 'summary' AS kind, 'total secdef in public' AS fn_name,
         (SELECT count(*) FROM public_fn)::text AS identity_args,
         NULL::text AS return_type, NULL::int AS nargs, NULL::int AS min_args, NULL::text AS volatility,
         NULL::text AS search_path, NULL::boolean AS x_public, NULL::boolean AS x_anon, NULL::boolean AS x_auth,
         NULL::boolean AS x_service, NULL::boolean AS public_acl, NULL::text AS execute_grantees,
         NULL::text AS owner_name, NULL::bigint AS triggers
  UNION ALL
  SELECT 2, 'summary', 'anon executable',
         (SELECT count(*) FROM public_fn WHERE public_fn.exec_anon)::text,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  UNION ALL
  SELECT 3, 'summary', 'anon executable non trigger',
         (SELECT count(*) FROM public_fn WHERE public_fn.exec_anon AND NOT public_fn.is_trigger)::text,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  UNION ALL
  SELECT 4, 'summary', 'anon executable non trigger zero args',
         (SELECT count(*) FROM public_fn WHERE public_fn.exec_anon AND NOT public_fn.is_trigger AND public_fn.arg_count = 0)::text,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  UNION ALL
  SELECT 5, 'summary', 'anon executable non trigger callable with no args',
         (SELECT count(*) FROM public_fn WHERE public_fn.exec_anon AND NOT public_fn.is_trigger AND public_fn.min_args = 0)::text,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  UNION ALL
  SELECT 6, 'summary', 'authenticated executable non trigger',
         (SELECT count(*) FROM public_fn WHERE public_fn.exec_auth AND NOT public_fn.is_trigger)::text,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  UNION ALL
  SELECT 7, 'summary', 'PUBLIC holds explicit execute entry',
         (SELECT count(*) FROM public_fn WHERE public_fn.public_acl_entry)::text,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  UNION ALL
  SELECT 8, 'summary', 'service_role cannot execute',
         (SELECT count(*) FROM public_fn WHERE NOT public_fn.exec_service)::text,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  UNION ALL
  SELECT 9, 'summary', 'missing pinned search_path',
         (SELECT count(*) FROM public_fn WHERE public_fn.search_path_value IS NULL)::text,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  UNION ALL
  SELECT 10, 'summary', 'secdef in other non system schemas',
         COALESCE((SELECT string_agg(other_schemas.schema_name || ' ' || other_schemas.fn_count::text
                                     || ' anon ' || other_schemas.anon_count::text, ' AND ' ORDER BY other_schemas.schema_name)
                   FROM other_schemas), 'none'),
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  UNION ALL
  SELECT 11, 'summary', 'authenticator role pgrst settings',
         COALESCE((SELECT string_agg(config_item, ' ')
                   FROM pg_roles AS role_row
                   CROSS JOIN LATERAL unnest(role_row.rolconfig) AS config_item
                   WHERE role_row.rolname = 'authenticator' AND left(config_item, 5) = 'pgrst'), 'none set on role'),
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  UNION ALL
  SELECT 12, 'summary', 'default privileges on new functions',
         COALESCE((SELECT string_agg(pg_get_userbyid(default_acl_row.defaclrole)::text || ' '
                                     || COALESCE(namespace_row.nspname, 'all schemas') || ' '
                                     || default_acl_row.defaclacl::text, ' AND ')
                   FROM pg_default_acl AS default_acl_row
                   LEFT JOIN pg_namespace AS namespace_row ON namespace_row.oid = default_acl_row.defaclnamespace
                   WHERE default_acl_row.defaclobjtype = 'f'
                     AND (namespace_row.nspname = 'public' OR default_acl_row.defaclnamespace = 0)), 'none'),
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  UNION ALL
  SELECT 13, 'summary', 'exec_sql or get_table_constraints in public any security',
         COALESCE((SELECT string_agg(proc_row.proname || ' secdef ' || proc_row.prosecdef::text
                                     || ' anon ' || has_function_privilege('anon', proc_row.oid, 'EXECUTE')::text, ' AND ')
                   FROM pg_proc AS proc_row
                   JOIN pg_namespace AS namespace_row ON namespace_row.oid = proc_row.pronamespace
                   WHERE namespace_row.nspname = 'public'
                     AND proc_row.proname IN ('exec_sql', 'get_table_constraints')), 'none'),
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  UNION ALL
  SELECT (100 + row_number() OVER (ORDER BY public_fn.fn_name, public_fn.identity_args))::int,
         CASE WHEN public_fn.is_trigger THEN 'trigger' ELSE 'fn' END,
         public_fn.fn_name,
         public_fn.identity_args,
         public_fn.return_type,
         public_fn.arg_count::int,
         public_fn.min_args::int,
         public_fn.volatility,
         public_fn.search_path_value,
         public_fn.exec_public,
         public_fn.exec_anon,
         public_fn.exec_auth,
         public_fn.exec_service,
         public_fn.public_acl_entry,
         public_fn.execute_grantees,
         public_fn.owner_name,
         public_fn.trigger_count
  FROM public_fn
)
SELECT report.sort_order, report.kind, report.fn_name, report.identity_args, report.return_type,
       report.nargs, report.min_args, report.volatility, report.search_path,
       report.x_public, report.x_anon, report.x_auth, report.x_service,
       report.public_acl, report.execute_grantees, report.owner_name, report.triggers
FROM report
ORDER BY report.sort_order;
