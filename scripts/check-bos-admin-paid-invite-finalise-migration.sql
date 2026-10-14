SET default_transaction_read_only = on;

WITH admin_paid_function AS (
  SELECT pg_proc.oid AS function_oid,
         pg_proc.prosecdef AS security_definer,
         array_to_string(pg_proc.proconfig, ' ') AS settings,
         array_to_string(pg_proc.proargnames, ' ') AS argument_names,
         pg_get_function_result(pg_proc.oid) AS result_shape,
         pg_language.lanname::text AS language_name,
         md5(replace(pg_proc.prosrc, chr(13), '')) AS body_md5,
         position('FOR UPDATE' IN pg_proc.prosrc) > 0
           AND position('invite_row' || chr(46) || 'revoked_at IS NULL' IN pg_proc.prosrc) > 0
           AND position('invite_row' || chr(46) || 'grant_id ' || chr(61) || ' p_tier' IN pg_proc.prosrc) > 0
           AND position('ON CONFLICT' IN upper(pg_proc.prosrc)) = 0 AS guarded_body,
         obj_description(pg_proc.oid, 'pg_proc') AS function_comment,
         COALESCE(pg_proc.proacl, acldefault('f', pg_proc.proowner)) AS function_acl,
         pg_proc.proowner AS owner_oid
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  JOIN pg_language ON pg_language.oid = pg_proc.prolang
  WHERE pg_namespace.nspname = 'public'
    AND pg_proc.proname = 'business_os_finalise_admin_paid_invite_redemption'
),
function_grants AS (
  SELECT COALESCE(string_agg(CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname::text END || ' ' || acl_item.privilege_type, ' ' ORDER BY grantee_role.rolname) FILTER (WHERE acl_item.grantee <> admin_paid_function.owner_oid), 'none') AS listing
  FROM admin_paid_function
  CROSS JOIN LATERAL aclexplode(admin_paid_function.function_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
),
live_finalise AS (
  SELECT pg_proc.proname::text AS function_name,
         md5(replace(pg_proc.prosrc, chr(13), '')) AS body_md5
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_proc.proname IN ('business_os_finalise_invite_redemption', 'business_os_finalise_friend_invite_redemption')
),
checks AS (
  SELECT 10 AS sort_order, 'C1 the admin paid finalise exists once as plpgsql SECURITY INVOKER with an empty search_path' AS check_name,
         CASE WHEN (SELECT count(*) FROM admin_paid_function) = 1
                   AND (SELECT count(*) FROM admin_paid_function
                        WHERE NOT admin_paid_function.security_definer
                          AND admin_paid_function.language_name = 'plpgsql'
                          AND admin_paid_function.settings = ('search_path' || chr(61) || chr(34) || chr(34))) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
         (SELECT count(*) FROM admin_paid_function) || ' found  ' || COALESCE((SELECT admin_paid_function.language_name || ' definer ' || admin_paid_function.security_definer::text || ' ' || COALESCE(admin_paid_function.settings, 'no settings') FROM admin_paid_function LIMIT 1), 'missing') AS detail
  UNION ALL
  SELECT 20, 'C2 it takes the four arguments and returns the two column table',
         CASE WHEN (SELECT count(*) FROM admin_paid_function
                    WHERE admin_paid_function.argument_names = 'p_invite_id p_account_id p_email p_tier result_outcome result_invite_id'
                      AND admin_paid_function.result_shape = 'TABLE' || chr(40) || 'result_outcome text' || chr(44) || ' result_invite_id uuid' || chr(41)) = 1 THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT admin_paid_function.argument_names FROM admin_paid_function LIMIT 1), 'missing')
  UNION ALL
  SELECT 30, 'C3 the body is the one in 20261029 and locks the invite on all eight filters with plain inserts',
         CASE WHEN (SELECT count(*) FROM admin_paid_function
                    WHERE admin_paid_function.body_md5 = '576c2e80149a372d7cc1dce490e0de4f'
                      AND admin_paid_function.guarded_body) = 1 THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT admin_paid_function.body_md5 FROM admin_paid_function LIMIT 1), 'missing')
  UNION ALL
  SELECT 40, 'C4 only service_role may execute the admin paid finalise',
         CASE WHEN (SELECT count(*) FROM admin_paid_function) = 1
                   AND (SELECT has_function_privilege('service_role', admin_paid_function.function_oid, 'EXECUTE') FROM admin_paid_function LIMIT 1)
                   AND NOT (SELECT has_function_privilege('anon', admin_paid_function.function_oid, 'EXECUTE') FROM admin_paid_function LIMIT 1)
                   AND NOT (SELECT has_function_privilege('authenticated', admin_paid_function.function_oid, 'EXECUTE') FROM admin_paid_function LIMIT 1)
                   AND function_grants.listing = 'service_role EXECUTE' THEN 'PASS' ELSE 'FAIL' END,
         function_grants.listing
  FROM function_grants
  UNION ALL
  SELECT 50, 'C5 the function comment is present and says the account is held until it pays',
         CASE WHEN (SELECT count(*) FROM admin_paid_function WHERE position('held until it pays' IN COALESCE(admin_paid_function.function_comment, '')) > 0) = 1 THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN (SELECT count(*) FROM admin_paid_function WHERE admin_paid_function.function_comment IS NOT NULL) = 1 THEN 'present' ELSE 'missing' END
  UNION ALL
  SELECT 60, 'C6 the champion finalise is unchanged from 20261014',
         CASE WHEN (SELECT count(*) FROM live_finalise WHERE live_finalise.function_name = 'business_os_finalise_invite_redemption') = 1
                   AND (SELECT live_finalise.body_md5 FROM live_finalise WHERE live_finalise.function_name = 'business_os_finalise_invite_redemption' LIMIT 1) = '61f1914570db05d988331f1c11d3280d' THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT live_finalise.body_md5 FROM live_finalise WHERE live_finalise.function_name = 'business_os_finalise_invite_redemption' LIMIT 1), 'missing')
  UNION ALL
  SELECT 70, 'C7 the friend finalise is unchanged from 20261024',
         CASE WHEN (SELECT count(*) FROM live_finalise WHERE live_finalise.function_name = 'business_os_finalise_friend_invite_redemption') = 1
                   AND (SELECT live_finalise.body_md5 FROM live_finalise WHERE live_finalise.function_name = 'business_os_finalise_friend_invite_redemption' LIMIT 1) = '55d59010921417011ec6c777064056fe' THEN 'PASS' ELSE 'FAIL' END,
         COALESCE((SELECT live_finalise.body_md5 FROM live_finalise WHERE live_finalise.function_name = 'business_os_finalise_friend_invite_redemption' LIMIT 1), 'missing')
  UNION ALL
  SELECT 80, 'C8 checked at utc',
         'INFO',
         (now() AT TIME ZONE 'UTC')::text
)
SELECT sort_order, check_name, status, detail
FROM (
  SELECT 0 AS sort_order, 'VERDICT' AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'FAIL') THEN 'FAIL' ELSE 'PASS' END AS status,
         (SELECT count(*) FROM checks WHERE checks.status = 'PASS') || ' pass '
           || (SELECT count(*) FROM checks WHERE checks.status = 'FAIL') || ' fail' AS detail
  UNION ALL
  SELECT checks.sort_order, checks.check_name, checks.status, checks.detail FROM checks
) AS report
ORDER BY report.sort_order;
