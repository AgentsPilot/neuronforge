-- Rollback of supabase/migrations/20261098_business_os_account_plans_after_plan_moves.sql (account deletion lifecycle D3.1, SX-2b)
-- Run ONLY after the code that reads the two columns is reverted. Until then the webhook writer's read fails and Stripe
-- retries, and the Cancel drawer shows its could-not-work-out line. Nothing else reads them
-- Refuses when any account already holds a count above 0. That count is the only record of how many free periods an
-- account has had, and dropping it would give every repeat canceller the full period again (user U-1: never reset)
-- The table is locked before the count, so no write can slip between the count and the DROP
-- Drops the three CHECK constraints and the two columns
-- The whole file is one transaction. A refusal changes nothing

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $rollback_guard$
DECLARE
  v_rows bigint;
BEGIN
  IF pg_catalog.to_regclass('public.business_os_account_plans') IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'After-plan moves rollback refused: table public.business_os_account_plans does not exist. Nothing was changed';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_attribute AS att
       WHERE att.attrelid = pg_catalog.to_regclass('public.business_os_account_plans')
         AND att.attname IN ('after_plan_moves', 'after_plan_last_subscription_id')
         AND NOT att.attisdropped) <> 2 THEN
    RAISE EXCEPTION USING MESSAGE = 'After-plan moves rollback refused: the two columns are not both there. Nothing was changed';
  END IF;
  LOCK TABLE public.business_os_account_plans IN ACCESS EXCLUSIVE MODE;
  v_rows := (SELECT count(*) FROM public.business_os_account_plans AS plans WHERE plans.after_plan_moves > 0);
  IF v_rows > 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'After-plan moves rollback refused: ' || v_rows || ' account(s) already had a free period after a cancel. Nothing was changed';
  END IF;
END
$rollback_guard$;

ALTER TABLE public.business_os_account_plans DROP CONSTRAINT IF EXISTS business_os_account_plans_after_plan_pair;

ALTER TABLE public.business_os_account_plans DROP CONSTRAINT IF EXISTS business_os_account_plans_after_plan_subscription_shape;

ALTER TABLE public.business_os_account_plans DROP CONSTRAINT IF EXISTS business_os_account_plans_after_plan_moves_check;

ALTER TABLE public.business_os_account_plans
  DROP COLUMN after_plan_last_subscription_id,
  DROP COLUMN after_plan_moves;

NOTIFY pgrst, 'reload schema';

COMMIT;
