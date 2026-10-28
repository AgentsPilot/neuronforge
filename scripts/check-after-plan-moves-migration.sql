-- 20261098 checker, step 3 of the PROD apply (docs/workplans/BUSINESS_OS_D3_1_FREE_COHORT_AFTER_CANCEL_WORKPLAN.md section 3). Read-only
-- Run after 20261098. Rows 1 to 8 must say ok. Any FAIL row: stop, paste the output back to TL and roll 20261098 back
-- in the same sitting
-- Row 9 is information only, never a gate: how many accounts have had a free period after a cancel so far
WITH
plans AS (
  SELECT pg_catalog.to_regclass('public.business_os_account_plans') AS rel
),
checks AS (
  SELECT 1 AS ord, 'after_plan_moves is integer, NOT NULL, default 0' AS check_name,
    EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
      JOIN pg_catalog.pg_attrdef AS def ON def.adrelid = att.attrelid AND def.adnum = att.attnum
      WHERE att.attrelid = (SELECT plans.rel FROM plans) AND att.attname = 'after_plan_moves' AND NOT att.attisdropped
        AND att.atttypid = 'integer'::regtype AND att.attnotnull
        AND pg_catalog.pg_get_expr(def.adbin, def.adrelid) = '0') AS passed
  UNION ALL
  SELECT 2, 'after_plan_last_subscription_id is text, nullable, no default',
    EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
      WHERE att.attrelid = (SELECT plans.rel FROM plans) AND att.attname = 'after_plan_last_subscription_id' AND NOT att.attisdropped
        AND att.atttypid = 'text'::regtype AND NOT att.attnotnull AND NOT att.atthasdef)
  UNION ALL
  SELECT 3, 'the count CHECK holds after_plan_moves >= 0',
    EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con
      WHERE con.conrelid = (SELECT plans.rel FROM plans) AND con.contype = 'c'
        AND con.conname = 'business_os_account_plans_after_plan_moves_check'
        AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%after_plan_moves >= 0%')
  UNION ALL
  SELECT 4, 'the shape CHECK holds the subscription prefix and the 255 length',
    EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con
      WHERE con.conrelid = (SELECT plans.rel FROM plans) AND con.contype = 'c'
        AND con.conname = 'business_os_account_plans_after_plan_subscription_shape'
        AND position('left"(after_plan_last_subscription_id, 4)' in pg_catalog.pg_get_constraintdef(con.oid)) > 0  -- left is printed quoted, as "left"( (QA B-1, 2026-10-27)
        AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%<= 255%')
  UNION ALL
  SELECT 5, 'the pair CHECK ties a count of 0 to no subscription id',
    EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con
      WHERE con.conrelid = (SELECT plans.rel FROM plans) AND con.contype = 'c'
        AND con.conname = 'business_os_account_plans_after_plan_pair'
        AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%after_plan_moves = 0%'
        AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%after_plan_last_subscription_id IS NULL%')
  UNION ALL
  SELECT 6, 'no foreign key names either new column',
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con
      JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
      WHERE con.contype = 'f' AND con.conrelid = (SELECT plans.rel FROM plans)
        AND att.attname IN ('after_plan_moves', 'after_plan_last_subscription_id'))
  UNION ALL
  SELECT 7, 'anon and authenticated still hold no privilege on the plan table',
    NOT pg_catalog.has_any_column_privilege('anon', 'public.business_os_account_plans', 'SELECT')
    AND NOT pg_catalog.has_any_column_privilege('authenticated', 'public.business_os_account_plans', 'SELECT')
    AND NOT pg_catalog.has_any_column_privilege('anon', 'public.business_os_account_plans', 'UPDATE')
    AND NOT pg_catalog.has_any_column_privilege('authenticated', 'public.business_os_account_plans', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('anon', 'public.business_os_account_plans', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.business_os_account_plans', 'INSERT')
  UNION ALL
  SELECT 8, 'row level security is still on, and service_role may read and change the new columns',
    coalesce((SELECT cls.relrowsecurity FROM pg_catalog.pg_class AS cls WHERE cls.oid = (SELECT plans.rel FROM plans)), false)
    AND pg_catalog.has_column_privilege('service_role', 'public.business_os_account_plans', 'after_plan_moves', 'SELECT')
    AND pg_catalog.has_column_privilege('service_role', 'public.business_os_account_plans', 'after_plan_moves', 'UPDATE')
    AND pg_catalog.has_column_privilege('service_role', 'public.business_os_account_plans', 'after_plan_last_subscription_id', 'SELECT')
    AND pg_catalog.has_column_privilege('service_role', 'public.business_os_account_plans', 'after_plan_last_subscription_id', 'UPDATE')
  UNION ALL
  SELECT 9, 'information only: accounts with at least one free period after a cancel = '
    || (SELECT count(*) FROM public.business_os_account_plans AS p WHERE p.after_plan_moves > 0)::text,
    true
)
SELECT checks.ord, checks.check_name, CASE WHEN checks.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM checks
ORDER BY checks.ord;
