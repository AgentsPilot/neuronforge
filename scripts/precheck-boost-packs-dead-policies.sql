SET default_transaction_read_only = on;

WITH table_state AS (
  SELECT watched.table_name,
         pg_class.oid AS table_oid,
         pg_class.relrowsecurity AS rls_on,
         pg_class.relforcerowsecurity AS force_rls_on,
         COALESCE(pg_class.relacl, acldefault('r', pg_class.relowner)) AS table_acl
  FROM (VALUES ('boost_packs')) AS watched (table_name)
  LEFT JOIN pg_namespace ON pg_namespace.nspname = 'public'
  LEFT JOIN pg_class ON pg_class.relnamespace = pg_namespace.oid
                    AND pg_class.relname = watched.table_name
                    AND pg_class.relkind = 'r'
),
table_grants AS (
  SELECT CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname::text END AS grantee_name,
         acl_item.privilege_type
  FROM table_state
  CROSS JOIN LATERAL aclexplode(table_state.table_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
  WHERE table_state.table_oid IS NOT NULL
),
expected_policies AS (
  SELECT expected.policy_name, expected.policy_order
  FROM (VALUES
    ('Boost packs are publicly readable', 1),
    ('Service role can manage boost packs', 2)
  ) AS expected (policy_name, policy_order)
),
report AS (
  SELECT 0 AS sort_order,
         'READ ME' AS item,
         'this session is now read only so run the migration in a NEW tab' AS detail

  UNION ALL
  SELECT 100,
         'Q1 boost_packs',
         CASE WHEN table_state.table_oid IS NULL THEN 'MISSING stop here'
              ELSE 'exists rls ' || table_state.rls_on::text || ' force rls ' || table_state.force_rls_on::text
         END
  FROM table_state

  UNION ALL
  SELECT 200 + grantee_list.grantee_order,
         'Q2 boost_packs ' || grantee_list.grantee_name,
         COALESCE(
           (SELECT string_agg(table_grants.privilege_type, ' ' ORDER BY table_grants.privilege_type)
            FROM table_grants
            WHERE table_grants.grantee_name = grantee_list.grantee_name),
           'none'
         )
  FROM (VALUES ('anon', 1), ('authenticated', 2), ('service_role', 3), ('PUBLIC', 4), ('postgres', 5)) AS grantee_list (grantee_name, grantee_order)

  UNION ALL
  SELECT 400,
         'Q4 policy count boost_packs expected 2',
         (SELECT count(*) FROM pg_policies
          WHERE pg_policies.schemaname = 'public'
            AND pg_policies.tablename = 'boost_packs')::text

  UNION ALL
  SELECT 410 + expected_policies.policy_order,
         'Q4 policy present ' || expected_policies.policy_name,
         CASE WHEN EXISTS (SELECT 1 FROM pg_policies
                           WHERE pg_policies.schemaname = 'public'
                             AND pg_policies.tablename = 'boost_packs'
                             AND pg_policies.policyname = expected_policies.policy_name)
              THEN 'yes' ELSE 'NO stop here' END
  FROM expected_policies

  UNION ALL
  SELECT 450,
         'Q4 policies boost_packs',
         COALESCE(
           (SELECT string_agg(
                     pg_policies.policyname || ' ' || pg_policies.cmd || ' ' || pg_policies.permissive
                       || ' roles ' || pg_policies.roles::text
                       || ' using ' || COALESCE(pg_policies.qual, 'none')
                       || ' check ' || COALESCE(pg_policies.with_check, 'none'),
                     ' AND NEXT ' ORDER BY pg_policies.policyname)
            FROM pg_policies
            WHERE pg_policies.schemaname = 'public'
              AND pg_policies.tablename = 'boost_packs'),
           'none'
         )

  UNION ALL
  SELECT 500, 'Q5 rows boost_packs', (SELECT count(*) FROM public.boost_packs)::text

  UNION ALL
  SELECT 600, 'Q6 boost packs active now', (SELECT count(*) FROM public.boost_packs WHERE boost_packs.is_active)::text

  UNION ALL
  SELECT 700, 'Q7 dependent views count boost_packs',
         (SELECT count(DISTINCT pg_rewrite.ev_class)
          FROM table_state
          JOIN pg_depend ON pg_depend.refobjid = table_state.table_oid
                        AND pg_depend.classid = 'pg_rewrite'::regclass
          JOIN pg_rewrite ON pg_rewrite.oid = pg_depend.objid
          WHERE pg_rewrite.ev_class <> table_state.table_oid)::text

  UNION ALL
  SELECT DISTINCT 701, 'Q7 dependent view ' || view_namespace.nspname || ' ' || view_class.relname,
         'kind ' || view_class.relkind::text
  FROM table_state
  JOIN pg_depend ON pg_depend.refobjid = table_state.table_oid
                AND pg_depend.classid = 'pg_rewrite'::regclass
  JOIN pg_rewrite ON pg_rewrite.oid = pg_depend.objid
  JOIN pg_class AS view_class ON view_class.oid = pg_rewrite.ev_class
  JOIN pg_namespace AS view_namespace ON view_namespace.oid = view_class.relnamespace
  WHERE pg_rewrite.ev_class <> table_state.table_oid

  UNION ALL
  SELECT 750, 'Q7 functions naming boost_packs count',
         (SELECT count(*)
          FROM pg_proc
          JOIN pg_namespace AS proc_namespace ON proc_namespace.oid = pg_proc.pronamespace
          WHERE left(proc_namespace.nspname, 3) <> 'pg_'
            AND proc_namespace.nspname <> 'information_schema'
            AND strpos(lower(pg_proc.prosrc), 'boost_packs') > 0)::text

  UNION ALL
  SELECT 751, 'Q7 function ' || proc_namespace.nspname || ' ' || pg_proc.proname,
         'security definer ' || pg_proc.prosecdef::text
  FROM pg_proc
  JOIN pg_namespace AS proc_namespace ON proc_namespace.oid = pg_proc.pronamespace
  WHERE left(proc_namespace.nspname, 3) <> 'pg_'
    AND proc_namespace.nspname <> 'information_schema'
    AND strpos(lower(pg_proc.prosrc), 'boost_packs') > 0

  UNION ALL
  SELECT 900, 'checked at utc', (now() AT TIME ZONE 'UTC')::text
)
SELECT report.sort_order, report.item, report.detail
FROM report
ORDER BY report.sort_order, report.item;
