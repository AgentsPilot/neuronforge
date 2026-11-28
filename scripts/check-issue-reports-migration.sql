-- 20261137 checker, ship drill step 6 (docs/workplans/BUSINESS_OS_ISSUE_REPORTING_SLICE_1_1_WORKPLAN.md section 4.4). Read-only, one SELECT
-- Run after 20261137 and before 20261138. It returns 16 rows. Rows 1 to 15 must say ok. Any FAIL row: stop, paste the
-- output back to TL and roll 20261137 back in the same sitting
-- Row 16 is information only, never a gate. ok means the table holds no row yet
-- Run it once BEFORE the paste too. Every row must read FAIL then, which proves this checker can fail
-- Catalog evidence only. Every lookup uses to_regclass or to_regprocedure, so nothing raises on the pre-apply state
WITH
rel AS (
  SELECT pg_catalog.to_regclass('public.issue_reports') AS oid
),
expected_columns (name, type_name, not_null) AS (
  VALUES
    ('id', 'uuid', true),
    ('user_id', 'uuid', true),
    ('reference', 'text', true),
    ('message', 'text', true),
    ('category_hint', 'text', false),
    ('page', 'text', true),
    ('area', 'text', false),
    ('environment', 'text', true),
    ('status', 'text', true),
    ('closed_reason', 'text', false),
    ('context', 'jsonb', false),
    ('screenshot_path', 'text', false),
    ('problem_id', 'uuid', false),
    ('created_at', 'timestamp with time zone', true),
    ('updated_at', 'timestamp with time zone', true)
),
live_columns AS (
  SELECT att.attname::text AS name, pg_catalog.format_type(att.atttypid, att.atttypmod) AS type_name, att.attnotnull AS not_null
  FROM pg_catalog.pg_attribute AS att
  WHERE att.attrelid = (SELECT rel.oid FROM rel) AND att.attnum > 0 AND NOT att.attisdropped
),
live_defaults AS (
  SELECT att.attname::text AS name, pg_catalog.pg_get_expr(def.adbin, def.adrelid) AS expr
  FROM pg_catalog.pg_attrdef AS def
  JOIN pg_catalog.pg_attribute AS att ON att.attrelid = def.adrelid AND att.attnum = def.adnum
  WHERE def.adrelid = (SELECT rel.oid FROM rel)
),
checks AS (
  SELECT 1 AS ord, 'public.issue_reports exists' AS check_name, (SELECT rel.oid FROM rel) IS NOT NULL AS passed
  UNION ALL
  SELECT 2, 'exactly the 15 columns of the workplan, each with its type and nullability',
    (SELECT count(*) FROM live_columns) = 15
    AND (SELECT count(*) FROM live_columns AS lc JOIN expected_columns AS ec
          ON ec.name = lc.name AND ec.type_name = lc.type_name AND ec.not_null = lc.not_null) = 15
  UNION ALL
  SELECT 3, 'defaults: id gen_random_uuid(), status submitted, created_at and updated_at now(), and no other default',
    (SELECT count(*) FROM live_defaults) = 4
    AND EXISTS (SELECT 1 FROM live_defaults AS d WHERE d.name = 'id' AND d.expr = 'gen_random_uuid()')
    AND EXISTS (SELECT 1 FROM live_defaults AS d WHERE d.name = 'status' AND d.expr = '''submitted''::text')
    AND EXISTS (SELECT 1 FROM live_defaults AS d WHERE d.name = 'created_at' AND d.expr = 'now()')
    AND EXISTS (SELECT 1 FROM live_defaults AS d WHERE d.name = 'updated_at' AND d.expr = 'now()')
  UNION ALL
  SELECT 4, 'row level security is on',
    coalesce((SELECT cls.relrowsecurity FROM pg_catalog.pg_class AS cls WHERE cls.oid = (SELECT rel.oid FROM rel)), false)
  UNION ALL
  SELECT 5, 'exactly one policy on the table',
    (SELECT rel.oid FROM rel) IS NOT NULL
    AND (SELECT count(*) FROM pg_catalog.pg_policy AS pol WHERE pol.polrelid = (SELECT rel.oid FROM rel)) = 1
  UNION ALL
  SELECT 6, 'the policy is a permissive SELECT for authenticated only (read from polroles), on user_id and auth.uid(), with no WITH CHECK',
    EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS pol
      WHERE pol.polrelid = (SELECT rel.oid FROM rel)
        AND pol.polcmd = 'r'
        AND pol.polpermissive
        AND pol.polroles = ARRAY[(SELECT r.oid FROM pg_catalog.pg_roles AS r WHERE r.rolname = 'authenticated')]::oid[]
        AND pol.polwithcheck IS NULL
        AND position('user_id' in pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)) > 0
        AND position('auth.uid()' in pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)) > 0)
  UNION ALL
  SELECT 7, 'PUBLIC holds no privilege on the table',
    (SELECT rel.oid FROM rel) IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class AS cls CROSS JOIN LATERAL pg_catalog.aclexplode(cls.relacl) AS acl
      WHERE cls.oid = (SELECT rel.oid FROM rel) AND acl.grantee = 0)
  UNION ALL
  SELECT 8, 'anon holds no privilege on the table',
    (SELECT rel.oid FROM rel) IS NOT NULL
    AND NOT pg_catalog.has_table_privilege('anon', (SELECT rel.oid FROM rel), 'SELECT')
    AND NOT pg_catalog.has_table_privilege('anon', (SELECT rel.oid FROM rel), 'INSERT')
    AND NOT pg_catalog.has_table_privilege('anon', (SELECT rel.oid FROM rel), 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('anon', (SELECT rel.oid FROM rel), 'DELETE')
    AND NOT pg_catalog.has_table_privilege('anon', (SELECT rel.oid FROM rel), 'TRUNCATE')
    AND NOT pg_catalog.has_table_privilege('anon', (SELECT rel.oid FROM rel), 'REFERENCES')
    AND NOT pg_catalog.has_table_privilege('anon', (SELECT rel.oid FROM rel), 'TRIGGER')
    AND NOT pg_catalog.has_any_column_privilege('anon', (SELECT rel.oid FROM rel), 'SELECT')
    AND NOT pg_catalog.has_any_column_privilege('anon', (SELECT rel.oid FROM rel), 'INSERT')
    AND NOT pg_catalog.has_any_column_privilege('anon', (SELECT rel.oid FROM rel), 'UPDATE')
    AND NOT pg_catalog.has_any_column_privilege('anon', (SELECT rel.oid FROM rel), 'REFERENCES')
  UNION ALL
  SELECT 9, 'authenticated holds SELECT only',
    (SELECT rel.oid FROM rel) IS NOT NULL
    AND pg_catalog.has_table_privilege('authenticated', (SELECT rel.oid FROM rel), 'SELECT')
    AND NOT pg_catalog.has_table_privilege('authenticated', (SELECT rel.oid FROM rel), 'INSERT')
    AND NOT pg_catalog.has_table_privilege('authenticated', (SELECT rel.oid FROM rel), 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('authenticated', (SELECT rel.oid FROM rel), 'DELETE')
    AND NOT pg_catalog.has_table_privilege('authenticated', (SELECT rel.oid FROM rel), 'TRUNCATE')
    AND NOT pg_catalog.has_table_privilege('authenticated', (SELECT rel.oid FROM rel), 'REFERENCES')
    AND NOT pg_catalog.has_table_privilege('authenticated', (SELECT rel.oid FROM rel), 'TRIGGER')
    AND NOT pg_catalog.has_any_column_privilege('authenticated', (SELECT rel.oid FROM rel), 'INSERT')
    AND NOT pg_catalog.has_any_column_privilege('authenticated', (SELECT rel.oid FROM rel), 'UPDATE')
    AND NOT pg_catalog.has_any_column_privilege('authenticated', (SELECT rel.oid FROM rel), 'REFERENCES')
  UNION ALL
  SELECT 10, 'service_role holds SELECT, INSERT, UPDATE and DELETE, and not TRUNCATE, REFERENCES or TRIGGER',
    (SELECT rel.oid FROM rel) IS NOT NULL
    AND pg_catalog.has_table_privilege('service_role', (SELECT rel.oid FROM rel), 'SELECT')
    AND pg_catalog.has_table_privilege('service_role', (SELECT rel.oid FROM rel), 'INSERT')
    AND pg_catalog.has_table_privilege('service_role', (SELECT rel.oid FROM rel), 'UPDATE')
    AND pg_catalog.has_table_privilege('service_role', (SELECT rel.oid FROM rel), 'DELETE')
    AND NOT pg_catalog.has_table_privilege('service_role', (SELECT rel.oid FROM rel), 'TRUNCATE')
    AND NOT pg_catalog.has_table_privilege('service_role', (SELECT rel.oid FROM rel), 'REFERENCES')
    AND NOT pg_catalog.has_table_privilege('service_role', (SELECT rel.oid FROM rel), 'TRIGGER')
  UNION ALL
  SELECT 11, 'one foreign key, user_id to auth.users on delete cascade (so problem_id has none), and none pointing at the table',
    (SELECT count(*) FROM pg_catalog.pg_constraint AS con
      WHERE con.contype = 'f' AND con.conrelid = (SELECT rel.oid FROM rel)) = 1
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con
      JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
      WHERE con.contype = 'f' AND con.conrelid = (SELECT rel.oid FROM rel)
        AND con.confrelid = pg_catalog.to_regclass('auth.users') AND con.confdeltype = 'c'
        AND pg_catalog.array_length(con.conkey, 1) = 1 AND att.attname = 'user_id')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con
      WHERE con.contype = 'f' AND con.confrelid = (SELECT rel.oid FROM rel))
  UNION ALL
  SELECT 12, 'reference is unique under issue_reports_reference_key',
    EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con
      JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
      WHERE con.contype = 'u' AND con.conrelid = (SELECT rel.oid FROM rel)
        AND con.conname = 'issue_reports_reference_key'
        AND pg_catalog.array_length(con.conkey, 1) = 1 AND att.attname = 'reference')
  UNION ALL
  SELECT 13, 'exactly the eleven named CHECK constraints and no other',
    (SELECT count(*) FROM pg_catalog.pg_constraint AS con
      WHERE con.conrelid = (SELECT rel.oid FROM rel) AND con.contype = 'c') = 11
    AND (SELECT count(*) FROM pg_catalog.pg_constraint AS con
      WHERE con.conrelid = (SELECT rel.oid FROM rel) AND con.contype = 'c'
        AND con.conname IN (
          'issue_reports_reference_format', 'issue_reports_message_length',
          'issue_reports_category_hint_check', 'issue_reports_page_shape',
          'issue_reports_area_shape', 'issue_reports_environment_shape',
          'issue_reports_status_check', 'issue_reports_closed_reason_check',
          'issue_reports_closed_shape', 'issue_reports_context_shape',
          'issue_reports_screenshot_path_shape')) = 11
  UNION ALL
  SELECT 14, 'the index issue_reports_user_created is on (user_id, created_at DESC)',
    EXISTS (SELECT 1 FROM pg_catalog.pg_indexes AS idx
      WHERE idx.schemaname = 'public' AND idx.tablename = 'issue_reports'
        AND idx.indexname = 'issue_reports_user_created'
        AND idx.indexdef LIKE '%(user_id, created_at DESC)')
  UNION ALL
  SELECT 15, 'the table has no trigger',
    (SELECT rel.oid FROM rel) IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS trg WHERE trg.tgrelid = (SELECT rel.oid FROM rel) AND NOT trg.tgisinternal)
  UNION ALL
  SELECT 16, 'information only, never a gate. ok means the table holds no row yet (expected right after the apply)',
    CASE WHEN (SELECT rel.oid FROM rel) IS NULL THEN false
      ELSE (pg_catalog.xpath('/row/n/text()', pg_catalog.query_to_xml('SELECT count(*) AS n FROM public.issue_reports', false, true, '')))[1]::text = '0'
    END
)
SELECT checks.ord, checks.check_name, CASE WHEN checks.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM checks
ORDER BY checks.ord;
