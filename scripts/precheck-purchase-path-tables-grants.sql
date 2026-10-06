SET default_transaction_read_only = on;

WITH watched_tables AS (
  SELECT watched.table_name, watched.table_order
  FROM unnest(ARRAY[
    'billing_events',
    'boost_pack_purchases',
    'subscription_invoices',
    'processed_webhook_events',
    'boost_packs'
  ]) WITH ORDINALITY AS watched (table_name, table_order)
),
table_state AS (
  SELECT watched_tables.table_name,
         watched_tables.table_order,
         pg_class.oid AS table_oid,
         pg_class.relrowsecurity AS rls_on,
         pg_class.relforcerowsecurity AS force_rls_on,
         COALESCE(pg_class.relacl, acldefault('r', pg_class.relowner)) AS table_acl
  FROM watched_tables
  LEFT JOIN pg_namespace ON pg_namespace.nspname = 'public'
  LEFT JOIN pg_class ON pg_class.relnamespace = pg_namespace.oid
                    AND pg_class.relname = watched_tables.table_name
                    AND pg_class.relkind = 'r'
),
table_grants AS (
  SELECT table_state.table_name,
         table_state.table_order,
         CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname::text END AS grantee_name,
         acl_item.privilege_type
  FROM table_state
  CROSS JOIN LATERAL aclexplode(table_state.table_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
  WHERE table_state.table_oid IS NOT NULL
),
column_grants AS (
  SELECT table_state.table_name,
         count(*) AS total
  FROM table_state
  JOIN pg_attribute ON pg_attribute.attrelid = table_state.table_oid
  CROSS JOIN LATERAL aclexplode(pg_attribute.attacl) AS acl_item
  JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
  WHERE pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
    AND pg_attribute.attacl IS NOT NULL
    AND grantee_role.rolname IN ('anon', 'authenticated')
  GROUP BY table_state.table_name
),
report AS (
  SELECT 0 AS sort_order,
         'READ ME' AS item,
         'this session is now read only so run the migration in a NEW tab' AS detail

  UNION ALL
  SELECT 100 + table_state.table_order,
         'Q1 ' || table_state.table_name,
         CASE WHEN table_state.table_oid IS NULL THEN 'MISSING stop here'
              ELSE 'exists rls ' || table_state.rls_on::text || ' force rls ' || table_state.force_rls_on::text
         END
  FROM table_state

  UNION ALL
  SELECT 200 + table_state.table_order * 10 + grantee_list.grantee_order,
         'Q2 ' || table_state.table_name || ' ' || grantee_list.grantee_name,
         COALESCE(
           (SELECT string_agg(table_grants.privilege_type, ' ' ORDER BY table_grants.privilege_type)
            FROM table_grants
            WHERE table_grants.table_name = table_state.table_name
              AND table_grants.grantee_name = grantee_list.grantee_name),
           'none'
         )
  FROM table_state
  CROSS JOIN (VALUES ('anon', 1), ('authenticated', 2), ('service_role', 3), ('PUBLIC', 4)) AS grantee_list (grantee_name, grantee_order)

  UNION ALL
  SELECT 300 + table_state.table_order,
         'Q3 column grants to anon or authenticated ' || table_state.table_name,
         COALESCE(column_grants.total, 0)::text || ' expected 0'
  FROM table_state
  LEFT JOIN column_grants ON column_grants.table_name = table_state.table_name

  UNION ALL
  SELECT 400 + table_state.table_order,
         'Q4 policy count ' || table_state.table_name,
         (SELECT count(*) FROM pg_policies
          WHERE pg_policies.schemaname = 'public'
            AND pg_policies.tablename = table_state.table_name)::text
  FROM table_state

  UNION ALL
  SELECT 450 + table_state.table_order,
         'Q4 policies ' || table_state.table_name,
         COALESCE(
           (SELECT string_agg(
                     pg_policies.policyname || ' ' || pg_policies.cmd || ' ' || pg_policies.permissive
                       || ' roles ' || pg_policies.roles::text
                       || ' using ' || COALESCE(pg_policies.qual, 'none')
                       || ' check ' || COALESCE(pg_policies.with_check, 'none'),
                     ' AND NEXT ' ORDER BY pg_policies.policyname)
            FROM pg_policies
            WHERE pg_policies.schemaname = 'public'
              AND pg_policies.tablename = table_state.table_name),
           'none'
         )
  FROM table_state

  UNION ALL
  SELECT 501, 'Q5 rows billing_events', (SELECT count(*) FROM public.billing_events)::text
  UNION ALL
  SELECT 502, 'Q5 rows boost_pack_purchases', (SELECT count(*) FROM public.boost_pack_purchases)::text
  UNION ALL
  SELECT 503, 'Q5 rows subscription_invoices', (SELECT count(*) FROM public.subscription_invoices)::text
  UNION ALL
  SELECT 504, 'Q5 rows processed_webhook_events', (SELECT count(*) FROM public.processed_webhook_events)::text
  UNION ALL
  SELECT 505, 'Q5 rows boost_packs', (SELECT count(*) FROM public.boost_packs)::text

  UNION ALL
  SELECT 600, 'Q6 boost packs active now', (SELECT count(*) FROM public.boost_packs WHERE boost_packs.is_active)::text
  UNION ALL
  SELECT 601, 'Q6 boost pack ' || boost_packs.pack_key,
         'id ' || boost_packs.id::text || ' active ' || COALESCE(boost_packs.is_active::text, 'null')
  FROM public.boost_packs

  UNION ALL
  SELECT 700, 'Q7 frozen accounts expected 0',
         (SELECT count(*) FROM public.user_subscriptions WHERE user_subscriptions.account_frozen)::text
  UNION ALL
  SELECT 701, 'Q7 frozen Business OS accounts expected 0 and a merge gate',
         (SELECT count(*)
          FROM public.user_subscriptions
          JOIN public.business_os_account_plans ON business_os_account_plans.user_id = user_subscriptions.user_id
          WHERE user_subscriptions.account_frozen)::text

  UNION ALL
  SELECT 900, 'checked at utc', (now() AT TIME ZONE 'UTC')::text
)
SELECT report.sort_order, report.item, report.detail
FROM report
ORDER BY report.sort_order, report.item;
