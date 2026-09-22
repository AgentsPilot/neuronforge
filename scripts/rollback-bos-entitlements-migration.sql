-- UNDO for the Business OS entitlements migrations (component 1).
--
--   psql "$BOS_DB" -v ON_ERROR_STOP=1 -f scripts/rollback-bos-entitlements-migration.sql
--
-- ⚠️ THIS DROPS THE THREE ENTITLEMENT TABLES AND EVERYTHING IN THEM. Only run it
-- if the apply went wrong and you want the database back exactly as it was.
--
-- ── When you need it, and when you do not ───────────────────────────────────
-- You almost certainly do not. Applying these migrations changes no customer
-- behaviour: nothing in the product reads these tables, and
-- `BOS_ENTITLEMENTS_MODE` defaults to `off`. The realistic failure is a
-- partially-applied first migration (a `lock_timeout` while creating a trigger),
-- and the honest fix for that is to run `20261005` again — it is written to be
-- re-runnable (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`,
-- `DROP TRIGGER IF EXISTS` before each `CREATE TRIGGER`).
--
-- Use this only for the case where you want the schema gone entirely.
--
-- ── What is lost ────────────────────────────────────────────────────────────
-- Every plan row, override and shadow event. Re-applying both migrations
-- rebuilds the plan rows from the tenants' own history, so nothing that came
-- from the backfill is unrecoverable. What CANNOT be rebuilt is anything an
-- admin set by hand afterwards — cohorts, expiries, overrides and their reasons.
-- If any admin operations have run against this database, export them first:
--
--   \copy (SELECT * FROM public.business_os_account_plans)         TO 'plans.csv'    CSV HEADER
--   \copy (SELECT * FROM public.business_os_entitlement_overrides) TO 'overrides.csv' CSV HEADER
--
-- ── Order matters ───────────────────────────────────────────────────────────
-- Triggers first (they reference the functions), then the functions, then the
-- tables. The overrides table has an FK to the plan table, so `CASCADE` on the
-- plan table would take it anyway; it is dropped explicitly so nothing is
-- removed implicitly.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. Triggers on the parent tables. These are the only objects this migration
--    added to tables the product actually uses, so they come off first.
DROP TRIGGER IF EXISTS business_os_plan_on_onboarding ON public.onboarding_conversations;
DROP TRIGGER IF EXISTS business_os_plan_on_profile    ON public.business_profiles;

-- 2. Functions.
DROP FUNCTION IF EXISTS public.business_os_plan_fact_onboarding();
DROP FUNCTION IF EXISTS public.business_os_plan_fact_profile();
DROP FUNCTION IF EXISTS public.business_os_record_shadow_events(jsonb);
DROP FUNCTION IF EXISTS public.business_os_reset_plan_state(uuid, text, timestamptz, timestamptz, uuid, text);

-- 3. Tables.
DROP TABLE IF EXISTS public.business_os_entitlement_shadow_events;
DROP TABLE IF EXISTS public.business_os_entitlement_overrides;
DROP TABLE IF EXISTS public.business_os_account_plans;

-- 4. Prove it: none of THESE EIGHT OBJECTS is left behind.
--
-- Enumerated, not matched with `business_os_%` (SA C-3). A pattern would sweep
-- in objects this script never claimed to drop — Slice 3's
-- `business_os_ai_action_usage`, for one — and report "rollback incomplete"
-- after a rollback that did exactly what it should. That message would arrive
-- mid-incident, which is the worst possible moment to be misleading.
DO $$
DECLARE
  leftovers text[] := ARRAY[]::text[];
  name text;
  tables text[] := ARRAY[
    'business_os_account_plans',
    'business_os_entitlement_overrides',
    'business_os_entitlement_shadow_events'
  ];
  functions text[] := ARRAY[
    'business_os_plan_fact_onboarding',
    'business_os_plan_fact_profile',
    'business_os_record_shadow_events',
    'business_os_reset_plan_state'
  ];
  triggers text[] := ARRAY['business_os_plan_on_onboarding', 'business_os_plan_on_profile'];
BEGIN
  FOREACH name IN ARRAY tables LOOP
    IF to_regclass('public.' || name) IS NOT NULL THEN
      leftovers := leftovers || ('table ' || name);
    END IF;
  END LOOP;

  FOREACH name IN ARRAY functions LOOP
    IF EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = name
    ) THEN
      leftovers := leftovers || ('function ' || name);
    END IF;
  END LOOP;

  FOREACH name IN ARRAY triggers LOOP
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = name) THEN
      leftovers := leftovers || ('trigger ' || name);
    END IF;
  END LOOP;

  IF array_length(leftovers, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'rollback incomplete, still present: %', array_to_string(leftovers, ', ');
  END IF;
END $$;

SELECT 'business_os entitlements: rolled back; re-apply 20261005 then 20261005b to rebuild' AS result;

COMMIT;
