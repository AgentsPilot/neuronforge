BEGIN;

SET LOCAL lock_timeout = '5s';

REVOKE ALL ON TABLE public.business_os_account_plans             FROM anon;
REVOKE ALL ON TABLE public.business_os_account_plans             FROM authenticated;
REVOKE ALL ON TABLE public.business_os_account_plans             FROM PUBLIC;

REVOKE ALL ON TABLE public.business_os_entitlement_overrides     FROM anon;
REVOKE ALL ON TABLE public.business_os_entitlement_overrides     FROM authenticated;
REVOKE ALL ON TABLE public.business_os_entitlement_overrides     FROM PUBLIC;

REVOKE ALL ON TABLE public.business_os_entitlement_shadow_events FROM anon;
REVOKE ALL ON TABLE public.business_os_entitlement_shadow_events FROM authenticated;
REVOKE ALL ON TABLE public.business_os_entitlement_shadow_events FROM PUBLIC;

REVOKE DELETE, TRUNCATE ON TABLE public.business_os_account_plans             FROM service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.business_os_entitlement_overrides     FROM service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.business_os_entitlement_shadow_events FROM service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.business_os_account_plans             TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.business_os_entitlement_overrides     TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.business_os_entitlement_shadow_events TO service_role;

REVOKE ALL ON FUNCTION public.business_os_record_shadow_events(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.business_os_record_shadow_events(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.business_os_record_shadow_events(jsonb) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_reset_plan_state(uuid, text, timestamptz, timestamptz, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.business_os_reset_plan_state(uuid, text, timestamptz, timestamptz, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.business_os_reset_plan_state(uuid, text, timestamptz, timestamptz, uuid, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_plan_fact_onboarding() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.business_os_plan_fact_onboarding() FROM anon;
REVOKE ALL ON FUNCTION public.business_os_plan_fact_onboarding() FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_plan_fact_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.business_os_plan_fact_profile() FROM anon;
REVOKE ALL ON FUNCTION public.business_os_plan_fact_profile() FROM authenticated;

GRANT EXECUTE ON FUNCTION public.business_os_record_shadow_events(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.business_os_reset_plan_state(uuid, text, timestamptz, timestamptz, uuid, text) TO service_role;

COMMIT;

SELECT 'business_os entitlements privilege fix' AS migration,
       'revokes ALL from anon authenticated and PUBLIC and takes DELETE and TRUNCATE from service_role' AS what_it_does,
       'see docs BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md step 9' AS why,
       'safe to re-run' AS notes;
