BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.business_os_tenants_missing_plan_row(p_limit integer DEFAULT 2000)
RETURNS TABLE (
  tenants_checked bigint,
  missing_count bigint,
  missing_with_profile bigint,
  missing_onboarding_only bigint,
  missing_sample uuid[],
  truncated boolean
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $fn$
WITH bounded AS (
  SELECT least(greatest(coalesce(p_limit, 2000), 1), 20000) AS cap
),
tenants AS (
  SELECT profiles.user_id AS user_id, true AS has_business_profile
  FROM public.business_profiles AS profiles
  WHERE profiles.user_id IS NOT NULL
  UNION
  SELECT conversations.user_id AS user_id, false AS has_business_profile
  FROM public.onboarding_conversations AS conversations
  WHERE conversations.user_id IS NOT NULL
),
folded AS (
  SELECT tenants.user_id AS user_id, bool_or(tenants.has_business_profile) AS has_business_profile
  FROM tenants
  GROUP BY tenants.user_id
),
missing AS (
  SELECT folded.user_id AS user_id, folded.has_business_profile AS has_business_profile
  FROM folded
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.business_os_account_plans AS plans
    WHERE plans.user_id = folded.user_id
  )
),
sampled AS (
  SELECT missing.user_id AS user_id
  FROM missing
  ORDER BY missing.user_id
  LIMIT (SELECT bounded.cap FROM bounded)
)
SELECT (SELECT count(*) FROM folded) AS tenants_checked,
       (SELECT count(*) FROM missing) AS missing_count,
       (SELECT count(*) FROM missing WHERE missing.has_business_profile) AS missing_with_profile,
       (SELECT count(*) FROM missing WHERE NOT missing.has_business_profile) AS missing_onboarding_only,
       coalesce((SELECT array_agg(sampled.user_id ORDER BY sampled.user_id) FROM sampled), ARRAY[]::uuid[]) AS missing_sample,
       (SELECT count(*) FROM missing) > (SELECT bounded.cap FROM bounded) AS truncated;
$fn$;

REVOKE ALL ON FUNCTION public.business_os_tenants_missing_plan_row(integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_tenants_missing_plan_row(integer) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_tenants_missing_plan_row(integer) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.business_os_tenants_missing_plan_row(integer) TO service_role;

COMMIT;

SELECT 'business_os tenants missing plan row' AS migration,
       'exhaustive anti join over business profiles and onboarding conversations' AS what_it_does,
       'see docs BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md step 10' AS why,
       'read only and safe to re-run' AS notes;
