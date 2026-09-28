SET default_transaction_read_only = on;

SELECT 'plan rows' AS what,
       (SELECT count(*) FROM public.business_os_account_plans)::text AS how_many,
       'rebuildable by re-applying 20261005 and 20261005b' AS after_rollback,
       'runbook R1' AS fix
UNION ALL
SELECT 'set by an admin',
       (SELECT count(*) FROM public.business_os_account_plans
         WHERE origin IN ('admin', 'admin_reset', 'launch') OR updated_by_admin_id IS NOT NULL)::text,
       'NOT REBUILDABLE export first',
       'runbook R2'
UNION ALL
SELECT 'overrides all',
       (SELECT count(*) FROM public.business_os_entitlement_overrides)::text,
       'NOT REBUILDABLE export first',
       'runbook R3'
UNION ALL
SELECT 'overrides still in force',
       (SELECT count(*) FROM public.business_os_entitlement_overrides WHERE ended_at IS NULL)::text,
       'NOT REBUILDABLE and in use right now',
       'runbook R4'
UNION ALL
SELECT 'shadow events',
       (SELECT count(*) FROM public.business_os_entitlement_shadow_events)::text,
       'NOT REBUILDABLE export if shadow mode has run',
       'runbook R5'
UNION ALL
SELECT 'this session',
       'this statement ' || current_setting('transaction_read_only')
         || ' this connection ' || current_setting('default_transaction_read_only'),
       'paste 2 opens with RESET so it can drop',
       'runbook read only';

RESET default_transaction_read_only;

SET lock_timeout = '5s';

DO $$
DECLARE
  v_confirm text := 'NO';
  v_admin_rows int := 0;
  v_overrides int := 0;
BEGIN
  IF v_confirm <> 'DROP-ENTITLEMENTS' THEN
    RAISE EXCEPTION 'REFUSING. Run paste 1, export anything not rebuildable, then arm this block as the runbook describes.'
      USING ERRCODE = '42501';
  END IF;

  IF to_regclass('public.business_os_account_plans') IS NOT NULL THEN
    SELECT count(*) INTO v_admin_rows FROM public.business_os_account_plans
     WHERE origin IN ('admin', 'admin_reset', 'launch') OR updated_by_admin_id IS NOT NULL;
  END IF;

  IF to_regclass('public.business_os_entitlement_overrides') IS NOT NULL THEN
    SELECT count(*) INTO v_overrides FROM public.business_os_entitlement_overrides;
  END IF;

  IF v_admin_rows > 0 OR v_overrides > 0 THEN
    RAISE WARNING 'dropping % admin set plan rows and % overrides. Neither can be rebuilt by re-applying the migrations',
      v_admin_rows, v_overrides;
  END IF;

  DROP TRIGGER IF EXISTS business_os_plan_on_onboarding ON public.onboarding_conversations;
  DROP TRIGGER IF EXISTS business_os_plan_on_profile    ON public.business_profiles;

  DROP FUNCTION IF EXISTS public.business_os_plan_fact_onboarding();
  DROP FUNCTION IF EXISTS public.business_os_plan_fact_profile();
  DROP FUNCTION IF EXISTS public.business_os_record_shadow_events(jsonb);
  DROP FUNCTION IF EXISTS public.business_os_reset_plan_state(uuid, text, timestamptz, timestamptz, uuid, text);

  DROP TABLE IF EXISTS public.business_os_entitlement_shadow_events;
  DROP TABLE IF EXISTS public.business_os_entitlement_overrides;
  DROP TABLE IF EXISTS public.business_os_account_plans;
END $$;

WITH expected_objects(kind, object_name) AS (
  VALUES ('table',    'business_os_account_plans'),
         ('table',    'business_os_entitlement_overrides'),
         ('table',    'business_os_entitlement_shadow_events'),
         ('function', 'business_os_plan_fact_onboarding'),
         ('function', 'business_os_plan_fact_profile'),
         ('function', 'business_os_record_shadow_events'),
         ('function', 'business_os_reset_plan_state'),
         ('trigger',  'business_os_plan_on_onboarding'),
         ('trigger',  'business_os_plan_on_profile')
),
leftovers AS (
  SELECT expected_objects.kind || ' ' || expected_objects.object_name AS leftover
  FROM expected_objects
  WHERE (expected_objects.kind = 'table'
         AND to_regclass('public.' || expected_objects.object_name) IS NOT NULL)
     OR (expected_objects.kind = 'function'
         AND EXISTS (SELECT 1 FROM pg_proc
                     JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
                     WHERE pg_namespace.nspname = 'public'
                       AND pg_proc.proname = expected_objects.object_name))
     OR (expected_objects.kind = 'trigger'
         AND EXISTS (SELECT 1 FROM pg_trigger
                     WHERE NOT pg_trigger.tgisinternal
                       AND pg_trigger.tgname = expected_objects.object_name))
)
SELECT CASE WHEN (SELECT count(*) FROM leftovers) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
       (SELECT count(*) FROM leftovers) || ' of 9 objects still present '
         || COALESCE((SELECT string_agg(leftovers.leftover, ' ' ORDER BY leftovers.leftover) FROM leftovers), '') AS detail,
       'runbook R6' AS fix;
