SET default_transaction_read_only = on;

WITH audit_table AS (
  SELECT pg_class.oid AS table_oid,
         pg_class.relrowsecurity AS rls_on
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname = 'audit_trail'
),
service_role_oid AS (
  SELECT pg_roles.oid AS role_oid
  FROM pg_roles
  WHERE pg_roles.rolname = 'service_role'
),
audit_policies AS (
  SELECT pg_policy.polname::text AS policy_name,
         pg_policy.polcmd::text AS policy_cmd,
         pg_policy.polroles AS policy_roles,
         pg_policy.polpermissive AS policy_permissive,
         COALESCE(pg_get_expr(pg_policy.polqual, pg_policy.polrelid), 'none') AS using_text,
         pg_get_expr(pg_policy.polwithcheck, pg_policy.polrelid) AS check_text,
         array_to_string(ARRAY(
           SELECT CASE WHEN role_item = 0 THEN 'PUBLIC' ELSE COALESCE(role_row.rolname::text, 'unknown') END
           FROM unnest(pg_policy.polroles) AS role_item
           LEFT JOIN pg_roles AS role_row ON role_row.oid = role_item
           ORDER BY 1
         ), ' ') AS roles_text
  FROM pg_policy
  JOIN audit_table ON audit_table.table_oid = pg_policy.polrelid
),
owner_summary AS (
  SELECT count(*) AS found,
         COALESCE(bool_and(audit_policies.policy_cmd = 'r'
                           AND audit_policies.policy_roles = ARRAY[0]::oid[]
                           AND audit_policies.check_text IS NULL
                           AND audit_policies.policy_permissive), false) AS shape_ok,
         COALESCE(max(audit_policies.policy_cmd), 'none') AS cmd_text,
         COALESCE(max(audit_policies.roles_text), 'none') AS roles_text,
         COALESCE(bool_and(audit_policies.policy_permissive), false) AS permissive,
         COALESCE(bool_and(audit_policies.check_text IS NULL), false) AS no_check,
         COALESCE(max(audit_policies.using_text), 'none') AS using_text
  FROM audit_policies
  WHERE audit_policies.policy_name = 'Users can view their own audit logs'
),
needles AS (
  SELECT needle_row.needle_name, needle_row.needle_text
  FROM (VALUES
    ('owner scope', 'auth' || chr(46) || 'uid' || chr(40) || chr(41) || ' ' || chr(61) || ' user_id'),
    ('null arm', 'entity_type IS NULL'),
    ('ai_action', chr(39) || 'ai_action' || chr(39)),
    ('business_os_account_plan', chr(39) || 'business_os_account_plan' || chr(39)),
    ('business_os_credit_lot', chr(39) || 'business_os_credit_lot' || chr(39)),
    ('business_os_credit_period', chr(39) || 'business_os_credit_period' || chr(39))
  ) AS needle_row(needle_name, needle_text)
),
missing_needles AS (
  SELECT count(*) AS total,
         COALESCE(string_agg('missing ' || needles.needle_name, ' and ' ORDER BY needles.needle_name), 'none missing') AS listing
  FROM needles
  CROSS JOIN owner_summary
  WHERE position(needles.needle_text IN owner_summary.using_text) = 0
),
service_summary AS (
  SELECT count(*) AS found,
         COALESCE(bool_and(audit_policies.policy_cmd = chr(42)
                           AND audit_policies.policy_roles = ARRAY[(SELECT service_role_oid.role_oid FROM service_role_oid)]::oid[]
                           AND audit_policies.policy_permissive), false) AS shape_ok,
         COALESCE(max(audit_policies.policy_cmd), 'none') AS cmd_text,
         COALESCE(max(audit_policies.roles_text), 'none') AS roles_text
  FROM audit_policies
  WHERE audit_policies.policy_name = 'service_role_bypass_rls'
),
policy_count AS (
  SELECT count(*) AS total,
         COALESCE(string_agg(audit_policies.policy_name, ' and ' ORDER BY audit_policies.policy_name)
                  FILTER (WHERE audit_policies.policy_name NOT IN ('Users can view their own audit logs', 'service_role_bypass_rls')), 'none') AS extra_names
  FROM audit_policies
),
hidden_counts AS (
  SELECT count(*) FILTER (WHERE audit_row.entity_type = 'ai_action') AS ai_action_rows,
         count(*) FILTER (WHERE audit_row.entity_type = 'business_os_account_plan') AS plan_rows,
         count(*) FILTER (WHERE audit_row.entity_type = 'business_os_credit_lot') AS lot_rows,
         count(*) FILTER (WHERE audit_row.entity_type = 'business_os_credit_period') AS period_rows,
         count(*) FILTER (WHERE audit_row.action = 'BOS_CREDIT_LOW_LINE_CROSSED') AS low_line_rows
  FROM public.audit_trail AS audit_row
  WHERE audit_row.entity_type IN ('ai_action', 'business_os_account_plan', 'business_os_credit_lot', 'business_os_credit_period')
     OR audit_row.action = 'BOS_CREDIT_LOW_LINE_CROSSED'
),
checks AS (
  SELECT 10 AS sort_order, 'C01 row level security is on for audit_trail' AS check_name,
         CASE WHEN (SELECT count(*) FROM audit_table) = 1 AND (SELECT bool_and(audit_table.rls_on) FROM audit_table) THEN 'PASS' ELSE 'FAIL' END AS status,
         (SELECT count(*) FROM audit_table) || ' tables found and rls ' || COALESCE((SELECT bool_and(audit_table.rls_on) FROM audit_table)::text, 'unknown') AS detail
  UNION ALL
  SELECT 20, 'C02 the owner policy is a permissive select for PUBLIC with no with check',
         CASE WHEN owner_summary.found = 1 AND owner_summary.shape_ok THEN 'PASS' ELSE 'FAIL' END,
         owner_summary.found || ' found  command ' || owner_summary.cmd_text || '  roles ' || owner_summary.roles_text
           || '  permissive ' || owner_summary.permissive::text || '  no with check ' || owner_summary.no_check::text
           || '  using ' || owner_summary.using_text
  FROM owner_summary
  UNION ALL
  SELECT 30, 'C03 the owner policy keeps the owner scope and the null arm and hides all four types',
         CASE WHEN owner_summary.found = 1 AND missing_needles.total = 0
               AND position('IS DISTINCT FROM' IN owner_summary.using_text) = 0 THEN 'PASS' ELSE 'FAIL' END,
         missing_needles.listing
           || CASE WHEN position('IS DISTINCT FROM' IN owner_summary.using_text) > 0 THEN ' and still the old IS DISTINCT FROM form' ELSE '' END
  FROM owner_summary
  CROSS JOIN missing_needles
  UNION ALL
  SELECT 40, 'C04 service_role_bypass_rls is unchanged for all commands and service_role only',
         CASE WHEN service_summary.found = 1 AND service_summary.shape_ok THEN 'PASS' ELSE 'FAIL' END,
         service_summary.found || ' found  command ' || service_summary.cmd_text || '  roles ' || service_summary.roles_text
  FROM service_summary
  UNION ALL
  SELECT 50, 'C05 exactly two policies on audit_trail',
         CASE WHEN policy_count.total = 2 AND policy_count.extra_names = 'none' THEN 'PASS' ELSE 'FAIL' END,
         policy_count.total || ' policies  other names ' || policy_count.extra_names
  FROM policy_count
  UNION ALL
  SELECT 60, 'C06 rows of each hidden type',
         'INFO',
         'ai_action ' || hidden_counts.ai_action_rows || ' and business_os_account_plan ' || hidden_counts.plan_rows
           || ' and business_os_credit_lot ' || hidden_counts.lot_rows || ' and business_os_credit_period ' || hidden_counts.period_rows
           || ' and BOS_CREDIT_LOW_LINE_CROSSED ' || hidden_counts.low_line_rows
  FROM hidden_counts
  UNION ALL
  SELECT 70, 'C07 checked at utc',
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
