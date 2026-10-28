-- 20261098_business_os_account_plans_after_plan_moves. Account deletion lifecycle D3.1 (SX-2b), the repeat-cancel count
-- Requirement docs/requirements/BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md section 3.2 (BQ-20) and SX-2b
-- Workplan docs/workplans/BUSINESS_OS_D3_1_FREE_COHORT_AFTER_CANCEL_WORKPLAN.md section 3 with SA Review 2026-10-27 S-1 option A
-- Adds two columns to public.business_os_account_plans
--   after_plan_moves                 how many free periods after an owner-started cancel the account has had. Never reset (user U-1)
--   after_plan_last_subscription_id  the Stripe subscription that gave the last one. The webhook writer's idempotency key
-- Both are written by the webhook in the SAME single UPDATE as the cohort and the free period dates, so they cannot disagree
-- Three CHECK constraints. The count is never negative. The id has the Stripe subscription shape. The pair agrees:
-- a count of 0 has no id and a count above 0 has one
-- No foreign key, no grant change, no policy change and no index. The table keeps RLS on with no policy, and browser roles
-- still hold nothing on it. The test account cleanup removes the plan row whole, so it needs no regeneration (SA verified)
-- Existing rows get 0 and NULL, which is true: no account has had this move before SX-2b
-- Pre-check scripts/precheck-after-plan-moves.sql. Checker scripts/check-after-plan-moves-migration.sql
-- Rollback supabase/SQL Scripts/20261098_business_os_account_plans_after_plan_moves_rollback.sql
-- Apply BEFORE the D3 and D3.1 merge deploys (user U-4). Code that runs first breaks nothing: the writer's read fails and
-- Stripe retries, and the Cancel drawer shows its honest could-not-work-out line
-- The whole file is one transaction. A failed pre-guard or post-condition applies nothing

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $pre_guard$
BEGIN
  IF pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') OR pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION USING MESSAGE = 'After-plan moves migration refused: anon or authenticated may create objects in schema public. Nothing was applied';
  END IF;
  IF pg_catalog.to_regclass('public.business_os_account_plans') IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'After-plan moves migration refused: table public.business_os_account_plans does not exist. Nothing was applied';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
              WHERE att.attrelid = pg_catalog.to_regclass('public.business_os_account_plans')
                AND att.attname IN ('after_plan_moves', 'after_plan_last_subscription_id')
                AND NOT att.attisdropped) THEN
    RAISE EXCEPTION USING MESSAGE = 'After-plan moves migration refused: a column after_plan_moves or after_plan_last_subscription_id already exists. Nothing was applied';
  END IF;
END
$pre_guard$;

ALTER TABLE public.business_os_account_plans
  ADD COLUMN after_plan_moves integer NOT NULL DEFAULT 0,
  ADD COLUMN after_plan_last_subscription_id text NULL;

ALTER TABLE public.business_os_account_plans ADD CONSTRAINT business_os_account_plans_after_plan_moves_check CHECK (after_plan_moves >= 0);

ALTER TABLE public.business_os_account_plans ADD CONSTRAINT business_os_account_plans_after_plan_subscription_shape CHECK (after_plan_last_subscription_id IS NULL OR (left(after_plan_last_subscription_id, 4) = ('sub' || chr(95)) AND char_length(after_plan_last_subscription_id) <= 255));

ALTER TABLE public.business_os_account_plans ADD CONSTRAINT business_os_account_plans_after_plan_pair CHECK ((after_plan_moves = 0) = (after_plan_last_subscription_id IS NULL));

COMMENT ON COLUMN public.business_os_account_plans.after_plan_moves IS 'How many free periods after an owner-started plan cancel this account has had. Never reset. Each repeat halves the next one (D3.1, SX-2b)';
COMMENT ON COLUMN public.business_os_account_plans.after_plan_last_subscription_id IS 'The Stripe subscription that gave the last free period after a cancel. The webhook writer applies a subscription once (D3.1, SX-2b)';

DO $post_condition$
DECLARE
  v_rel regclass := pg_catalog.to_regclass('public.business_os_account_plans');
  v_count bigint;
BEGIN
  v_count := (SELECT count(*) FROM pg_catalog.pg_attribute AS att
               WHERE att.attrelid = v_rel AND att.attname = 'after_plan_moves' AND NOT att.attisdropped
                 AND att.atttypid = 'integer'::regtype AND att.attnotnull);
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'After-plan moves post-condition 1: after_plan_moves is not an integer NOT NULL column so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_attribute AS att
               WHERE att.attrelid = v_rel AND att.attname = 'after_plan_last_subscription_id' AND NOT att.attisdropped
                 AND att.atttypid = 'text'::regtype AND NOT att.attnotnull);
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'After-plan moves post-condition 2: after_plan_last_subscription_id is not a nullable text column so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_constraint AS con
               WHERE con.conrelid = v_rel AND con.contype = 'c'
                 AND con.conname IN ('business_os_account_plans_after_plan_moves_check',
                                     'business_os_account_plans_after_plan_subscription_shape',
                                     'business_os_account_plans_after_plan_pair'));
  IF v_count <> 3 THEN
    RAISE EXCEPTION USING MESSAGE = 'After-plan moves post-condition 3: the three CHECK constraints are not all there so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM public.business_os_account_plans AS plans
               WHERE plans.after_plan_moves <> 0 OR plans.after_plan_last_subscription_id IS NOT NULL);
  IF v_count <> 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'After-plan moves post-condition 4: an existing row does not hold 0 and NULL so nothing was applied';
  END IF;
  IF pg_catalog.has_any_column_privilege('anon', 'public.business_os_account_plans', 'SELECT')
     OR pg_catalog.has_any_column_privilege('authenticated', 'public.business_os_account_plans', 'SELECT')
     OR pg_catalog.has_any_column_privilege('anon', 'public.business_os_account_plans', 'UPDATE')
     OR pg_catalog.has_any_column_privilege('authenticated', 'public.business_os_account_plans', 'UPDATE') THEN
    RAISE EXCEPTION USING MESSAGE = 'After-plan moves post-condition 5: a browser role may read or change the plan table so nothing was applied';
  END IF;
END
$post_condition$;

NOTIFY pgrst, 'reload schema';

COMMIT;
