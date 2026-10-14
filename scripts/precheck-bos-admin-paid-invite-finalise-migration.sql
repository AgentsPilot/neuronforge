SET default_transaction_read_only = on;

WITH needed_columns AS (
  SELECT needed.table_name, needed.column_name
  FROM (VALUES
    ('business_os_invites', 'id'),
    ('business_os_invites', 'claimed_account_id'),
    ('business_os_invites', 'email'),
    ('business_os_invites', 'issuer_kind'),
    ('business_os_invites', 'grant_kind'),
    ('business_os_invites', 'grant_id'),
    ('business_os_invites', 'redeemed_at'),
    ('business_os_invites', 'redeemed_account_id'),
    ('business_os_invites', 'revoked_at'),
    ('business_os_invites', 'updated_at'),
    ('business_os_account_plans', 'user_id'),
    ('business_os_account_plans', 'tier'),
    ('business_os_account_plans', 'cohort'),
    ('business_os_account_plans', 'origin'),
    ('business_os_account_plans', 'period_anchor'),
    ('business_os_account_plans', 'updated_at'),
    ('business_os_account_lineage', 'account_id'),
    ('business_os_account_lineage', 'invite_id'),
    ('business_os_account_lineage', 'source'),
    ('business_os_account_lineage', 'parent_account_id'),
    ('business_os_account_lineage', 'root_account_id'),
    ('business_os_account_lineage', 'level'),
    ('business_os_account_lineage', 'first_paid_at')
  ) AS needed (table_name, column_name)
),
missing_columns AS (
  SELECT COALESCE(string_agg(needed_columns.table_name || ' ' || needed_columns.column_name, ' ' ORDER BY needed_columns.table_name, needed_columns.column_name), 'none') AS listing,
         count(*) AS total
  FROM needed_columns
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    JOIN pg_class ON pg_class.oid = pg_attribute.attrelid
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_class.relname = needed_columns.table_name
      AND pg_attribute.attname = needed_columns.column_name
      AND pg_attribute.attnum > 0
      AND NOT pg_attribute.attisdropped
  )
),
new_function AS (
  SELECT pg_proc.oid AS function_oid
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_proc.proname = 'business_os_finalise_admin_paid_invite_redemption'
),
live_finalise AS (
  SELECT pg_proc.proname::text AS function_name,
         md5(replace(pg_proc.prosrc, chr(13), '')) AS body_md5
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_proc.proname IN ('business_os_finalise_invite_redemption', 'business_os_finalise_friend_invite_redemption')
),
named_tables AS (
  SELECT pg_class.relname::text AS table_name, pg_class.oid AS table_oid
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname IN ('business_os_invites', 'business_os_account_plans', 'business_os_account_lineage')
),
service_reach AS (
  SELECT COALESCE((SELECT has_table_privilege('service_role', named_tables.table_oid, 'SELECT') AND has_table_privilege('service_role', named_tables.table_oid, 'UPDATE')
                   FROM named_tables WHERE named_tables.table_name = 'business_os_invites'), false) AS invites_ok,
         COALESCE((SELECT has_table_privilege('service_role', named_tables.table_oid, 'INSERT')
                   FROM named_tables WHERE named_tables.table_name = 'business_os_account_plans'), false) AS plans_ok,
         COALESCE((SELECT has_table_privilege('service_role', named_tables.table_oid, 'SELECT') AND has_table_privilege('service_role', named_tables.table_oid, 'INSERT')
                   FROM named_tables WHERE named_tables.table_name = 'business_os_account_lineage'), false) AS lineage_ok
),
checks AS (
  SELECT 10 AS sort_order, 'P1 the invites plans and lineage tables have every column the new function names' AS check_name,
         CASE WHEN missing_columns.total = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
         'missing ' || missing_columns.listing AS detail
  FROM missing_columns
  UNION ALL
  SELECT 20, 'P2 the admin paid finalise function does not exist yet so 20261029 is not applied',
         CASE WHEN (SELECT count(*) FROM new_function) = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM new_function) || ' found'
  UNION ALL
  SELECT 30, 'P3 the champion finalise exists once with the 20261014 body',
         CASE WHEN (SELECT count(*) FROM live_finalise WHERE live_finalise.function_name = 'business_os_finalise_invite_redemption') = 1
                   AND (SELECT live_finalise.body_md5 FROM live_finalise WHERE live_finalise.function_name = 'business_os_finalise_invite_redemption' LIMIT 1) = '61f1914570db05d988331f1c11d3280d' THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT live_finalise.body_md5 FROM live_finalise WHERE live_finalise.function_name = 'business_os_finalise_invite_redemption' LIMIT 1), 'missing')
  UNION ALL
  SELECT 40, 'P4 the friend finalise exists once with the 20261024 body',
         CASE WHEN (SELECT count(*) FROM live_finalise WHERE live_finalise.function_name = 'business_os_finalise_friend_invite_redemption') = 1
                   AND (SELECT live_finalise.body_md5 FROM live_finalise WHERE live_finalise.function_name = 'business_os_finalise_friend_invite_redemption' LIMIT 1) = '55d59010921417011ec6c777064056fe' THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT live_finalise.body_md5 FROM live_finalise WHERE live_finalise.function_name = 'business_os_finalise_friend_invite_redemption' LIMIT 1), 'missing')
  UNION ALL
  SELECT 50, 'P5 service_role may read and update invites and insert plan and lineage rows',
         CASE WHEN service_reach.invites_ok AND service_reach.plans_ok AND service_reach.lineage_ok THEN 'PASS' ELSE 'FAIL' END,
         'invites ' || service_reach.invites_ok::text || '  plans ' || service_reach.plans_ok::text || '  lineage ' || service_reach.lineage_ok::text
  FROM service_reach
  UNION ALL
  SELECT 60, 'P6 admin tier invites already redeemed expected 0',
         CASE WHEN (SELECT count(*) FROM public.business_os_invites AS invite_row
                    WHERE invite_row.issuer_kind = 'admin' AND invite_row.grant_kind = 'tier' AND invite_row.redeemed_at IS NOT NULL) = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM public.business_os_invites AS invite_row
          WHERE invite_row.issuer_kind = 'admin' AND invite_row.grant_kind = 'tier' AND invite_row.redeemed_at IS NOT NULL) || ' invites'
  UNION ALL
  SELECT 70, 'P7 admin invite lineage rows whose invite is a tier grant expected 0',
         CASE WHEN (SELECT count(*) FROM public.business_os_account_lineage AS lineage_row
                    JOIN public.business_os_invites AS invite_row ON invite_row.id = lineage_row.invite_id
                    WHERE lineage_row.source = 'admin_invite' AND invite_row.grant_kind = 'tier') = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM public.business_os_account_lineage AS lineage_row
          JOIN public.business_os_invites AS invite_row ON invite_row.id = lineage_row.invite_id
          WHERE lineage_row.source = 'admin_invite' AND invite_row.grant_kind = 'tier') || ' rows'
  UNION ALL
  SELECT 80, 'P8 pending admin tier invites not redeemed and not revoked',
         'INFO',
         (SELECT count(*) FROM public.business_os_invites AS invite_row
          WHERE invite_row.issuer_kind = 'admin' AND invite_row.grant_kind = 'tier' AND invite_row.redeemed_at IS NULL AND invite_row.revoked_at IS NULL) || ' invites  demo links to revoke'
  UNION ALL
  SELECT 90, 'P9 server version',
         'INFO',
         current_setting('server_version')
  UNION ALL
  SELECT 91, 'P9 checked at utc',
         'INFO',
         (now() AT TIME ZONE 'UTC')::text
)
SELECT sort_order, check_name, status, detail
FROM (
  SELECT 0 AS sort_order, 'VERDICT' AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'FAIL') THEN 'FAIL' ELSE 'PASS' END AS status,
         (SELECT count(*) FROM checks WHERE checks.status = 'PASS') || ' pass '
           || (SELECT count(*) FROM checks WHERE checks.status = 'FAIL') || ' fail  '
           || CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'FAIL') THEN 'do not run the migration' ELSE 'run the migration in a NEW tab' END AS detail
  UNION ALL
  SELECT checks.sort_order, checks.check_name, checks.status, checks.detail FROM checks
) AS report
ORDER BY report.sort_order;
