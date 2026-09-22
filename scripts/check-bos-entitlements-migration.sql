-- POST-APPLY CHECKS for the Business OS entitlements migrations — READ ONLY.
--
--   psql "$BOS_DB" -v ON_ERROR_STOP=1 -f scripts/check-bos-entitlements-migration.sql
--
-- ✅ SAFE ON PRODUCTION. This script writes nothing, and does not merely promise
-- that: the whole run is wrapped in `SET TRANSACTION READ ONLY`, so PostgreSQL
-- itself refuses any INSERT/UPDATE/DELETE/DDL that might creep in later. If a
-- future edit adds a write, this file fails loudly rather than changing data.
--
-- It answers: did the migrations land, are the objects bound and privileged as
-- intended, and does the resulting data look the way the backfill promised?
--
-- What it CANNOT answer, because those need writes: the trigger actually records
-- a fact, a trial cannot be restarted, a failing plan write does not fail the
-- product write, the reset's behaviour, the shadow RPC's arithmetic. Those live
-- in scripts/verify-bos-entitlements-migration.sql, which MUST run inside a
-- rolled-back transaction (see its header, and the runbook in the workplan
-- §4.20).
--
-- Every check raises an exception naming the property that failed, so with
-- ON_ERROR_STOP=1 the first failure is the message. Counts that are FACTS rather
-- than pass/fail come out as NOTICEs and as the final summary table.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

-- ────────────────────────────────────────────────────────────────────────────
-- A. Objects, RLS, privileges — is the schema what the migration says?
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'business_os_account_plans',
    'business_os_entitlement_overrides',
    'business_os_entitlement_shadow_events'
  ];
  n int;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'A1 missing table: % — has 20261005 been applied?', t;
    END IF;

    SELECT count(*) INTO n
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = t AND c.relrowsecurity;
    IF n <> 1 THEN RAISE EXCEPTION 'A2 row level security is not enabled on %', t; END IF;

    SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public' AND tablename = t;
    IF n <> 0 THEN RAISE EXCEPTION 'A3 % has % policy/policies; this module defines none', t, n; END IF;

    IF has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR has_table_privilege('anon', 'public.' || t, 'INSERT')
       OR has_table_privilege('anon', 'public.' || t, 'UPDATE')
       OR has_table_privilege('anon', 'public.' || t, 'DELETE')
       OR has_table_privilege('authenticated', 'public.' || t, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || t, 'DELETE')
    THEN
      RAISE EXCEPTION 'A4 anon/authenticated still hold a privilege on % — an account could read or write its own entitlements', t;
    END IF;

    -- A10 (the positive side): every repository call runs as service_role.
    IF NOT (has_table_privilege('service_role', 'public.' || t, 'SELECT')
            AND has_table_privilege('service_role', 'public.' || t, 'INSERT')
            AND has_table_privilege('service_role', 'public.' || t, 'UPDATE')) THEN
      RAISE EXCEPTION 'A10 service_role cannot read/write %: every repository call would fail with permission denied', t;
    END IF;
  END LOOP;
END $$;

-- Functions: revoked from the client roles, executable by service_role, with
-- search_path pinned (and lock_timeout on the two trigger functions).
DO $$
DECLARE
  f record;
  seen int := 0;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname, p.prosecdef,
           pg_get_userbyid(p.proowner) AS owner,
           COALESCE(array_to_string(p.proconfig, ','), '') AS cfg
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.proname IN (
        'business_os_record_shadow_events',
        'business_os_reset_plan_state',
        'business_os_plan_fact_onboarding',
        'business_os_plan_fact_profile'
      )
  LOOP
    seen := seen + 1;

    IF has_function_privilege('authenticated', f.oid, 'EXECUTE')
       OR has_function_privilege('anon', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'A5 % is executable by a client role', f.proname;
    END IF;

    IF position('search_path=' in f.cfg) = 0 THEN
      RAISE EXCEPTION 'A6 % does not pin search_path (proconfig: %)', f.proname, f.cfg;
    END IF;

    IF f.proname LIKE 'business_os_plan_fact_%' THEN
      IF position('lock_timeout=2s' in f.cfg) = 0 THEN
        RAISE EXCEPTION 'A7 % does not pin lock_timeout=2s: a lock on the plan table could stall a product write', f.proname;
      END IF;
      IF NOT f.prosecdef THEN
        RAISE EXCEPTION 'A7 % is not SECURITY DEFINER; it cannot write the plan table when a user fires it', f.proname;
      END IF;
    ELSE
      IF NOT has_function_privilege('service_role', f.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'A10 service_role cannot execute %', f.proname;
      END IF;
      IF f.prosecdef THEN
        RAISE EXCEPTION 'A5 % is SECURITY DEFINER; the callable functions are INVOKER by design', f.proname;
      END IF;
    END IF;

    -- Q-14: ownership is a deployment property. Recorded, not asserted.
    RAISE NOTICE 'function % — owner=%, definer=%, config=[%]', f.proname, f.owner, f.prosecdef, f.cfg;
  END LOOP;

  IF seen <> 4 THEN RAISE EXCEPTION 'A8 expected 4 entitlement functions, found %', seen; END IF;
END $$;

-- Triggers: right table, right event, right function.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_proc  p ON p.oid = t.tgfoid
  WHERE NOT t.tgisinternal
    AND (t.tgtype & 4) <> 0 AND (t.tgtype & 1) <> 0 AND (t.tgtype & 2) = 0
    AND (
      (t.tgname = 'business_os_plan_on_onboarding'
        AND c.relname = 'onboarding_conversations' AND p.proname = 'business_os_plan_fact_onboarding')
      OR
      (t.tgname = 'business_os_plan_on_profile'
        AND c.relname = 'business_profiles' AND p.proname = 'business_os_plan_fact_profile')
    );
  IF n <> 2 THEN
    RAISE EXCEPTION 'A9 expected both AFTER INSERT ROW triggers bound to their own table and function, found %', n;
  END IF;
END $$;

-- Constraints: present AND checking what they claim.
DO $$
DECLARE
  expected text[][] := ARRAY[
    ARRAY['business_os_account_plans_tier_versioned', '%plan_version > 0%'],
    ARRAY['business_os_account_plans_tier_expiry_needs_tier', '%tier_expires_at IS NULL%'],
    ARRAY['business_os_account_plans_cohort_expiry_needs_cohort', '%cohort_expires_at IS NULL%']
  ];
  i int;
  def text;
BEGIN
  FOR i IN 1 .. array_length(expected, 1) LOOP
    SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
    WHERE conrelid = 'public.business_os_account_plans'::regclass
      AND contype = 'c' AND conname = expected[i][1];

    IF def IS NULL THEN RAISE EXCEPTION 'A11 missing CHECK constraint %', expected[i][1]; END IF;
    IF def NOT LIKE expected[i][2] THEN
      RAISE EXCEPTION 'A11 constraint % does not check what it claims: %', expected[i][1], def;
    END IF;
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- B. The data the backfill produced — is every tenant recorded, and correctly?
--
-- These are the checks that are WORTH MORE on production than on any throwaway
-- database: this is the only place where the tenant set is real.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tenants int;
  plan_rows int;
  missing int;
  backfilled int;
  malformed int;
BEGIN
  SELECT count(*) INTO tenants FROM (
    SELECT user_id FROM public.business_profiles
    UNION
    SELECT user_id FROM public.onboarding_conversations
  ) t;

  SELECT count(*) INTO plan_rows FROM public.business_os_account_plans;

  SELECT count(*) INTO missing
  FROM (
    SELECT user_id FROM public.business_profiles
    UNION
    SELECT user_id FROM public.onboarding_conversations
  ) AS t
  LEFT JOIN public.business_os_account_plans p ON p.user_id = t.user_id
  WHERE p.user_id IS NULL;

  SELECT count(*) INTO backfilled FROM public.business_os_account_plans WHERE origin = 'backfill';

  SELECT count(*) INTO malformed
  FROM public.business_os_account_plans
  WHERE origin = 'backfill'
    AND (cohort <> 'champion' OR cohort_expires_at IS NOT NULL OR tier IS NOT NULL);

  RAISE NOTICE 'tenants=% plan_rows=% backfilled=% missing=%', tenants, plan_rows, backfilled, missing;

  IF missing <> 0 THEN
    RAISE EXCEPTION 'B1 % Business OS tenant(s) have no plan row — apply 20261005b (the backfill)', missing;
  END IF;

  IF malformed <> 0 THEN
    RAISE EXCEPTION 'B2 % backfilled row(s) are not open-ended champions', malformed;
  END IF;

  -- Non-vacuity: on a database with tenants, a backfill that produced nothing
  -- means the second migration never ran, and B1/B2 above proved nothing.
  IF tenants > 0 AND backfilled = 0 THEN
    RAISE EXCEPTION 'B3 % tenants exist but no row has origin=backfill: 20261005b has not been applied', tenants;
  END IF;
END $$;

-- The migration-window hazard (Q-5): a PRE-EXISTING tenant whose row was created
-- by a trigger between the two migrations. Such a row says `trial` when it should
-- say `champion`. Not an error — the launch operation fixes the cohort at
-- enforcement switch-on — but the count belongs in the record.
DO $$
DECLARE gap int;
BEGIN
  SELECT count(*) INTO gap
  FROM public.business_os_account_plans p
  WHERE p.origin IN ('onboarding_trigger', 'profile_trigger')
    AND (EXISTS (SELECT 1 FROM public.onboarding_conversations o
                  WHERE o.user_id = p.user_id AND o.created_at < p.created_at)
         OR EXISTS (SELECT 1 FROM public.business_profiles b
                     WHERE b.user_id = p.user_id AND b.created_at < p.created_at));

  IF gap > 0 THEN
    RAISE WARNING 'Q-5 window: % pre-existing tenant(s) were caught by a trigger between the two migrations and are recorded as trials. The launch operation will make them champions; their facts were healed by 20261005b.', gap;
  ELSE
    RAISE NOTICE 'Q-5 window: 0 rows — the two migrations were applied close enough together that no tenant fell in the gap.';
  END IF;
END $$;

-- The fact heal did its job: no plan row is missing a fact its own history could
-- supply. (A NULL fact with no history is normal and is not counted.)
DO $$
DECLARE unhealed int;
BEGIN
  SELECT count(*) INTO unhealed
  FROM public.business_os_account_plans p
  WHERE (p.onboarding_started_at IS NULL
         AND EXISTS (SELECT 1 FROM public.onboarding_conversations o WHERE o.user_id = p.user_id))
     OR (p.profile_created_at IS NULL
         AND EXISTS (SELECT 1 FROM public.business_profiles b WHERE b.user_id = p.user_id));

  IF unhealed <> 0 THEN
    RAISE EXCEPTION 'B4 % plan row(s) are missing a fact their own history could supply — re-run 20261005b, whose heal step fills exactly these', unhealed;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- C. Numbers for the record (facts, not pass/fail)
-- ────────────────────────────────────────────────────────────────────────────

SELECT
  (SELECT count(*) FROM (SELECT user_id FROM public.business_profiles
                         UNION SELECT user_id FROM public.onboarding_conversations) t) AS tenants,
  (SELECT count(*) FROM public.business_os_account_plans)                              AS plan_rows,
  (SELECT count(*) FROM public.business_os_account_plans WHERE origin = 'backfill')    AS backfilled,
  (SELECT count(*) FROM public.business_os_account_plans
     WHERE cohort = 'champion' AND cohort_expires_at IS NULL)                          AS open_ended_champions,
  -- The S1-T11a trim list: champions who never created a business profile, i.e.
  -- accounts that opened onboarding once and never came back.
  (SELECT count(*) FROM public.business_os_account_plans
     WHERE cohort = 'champion' AND cohort_expires_at IS NULL AND profile_created_at IS NULL)
                                                                                       AS open_ended_no_profile,
  (SELECT count(*) FROM public.business_os_account_plans WHERE cohort = 'trial')       AS trials,
  (SELECT count(*) FROM public.business_os_account_plans WHERE tier IS NOT NULL)       AS with_tier,
  (SELECT count(*) FROM public.business_os_entitlement_overrides WHERE ended_at IS NULL) AS active_overrides,
  (SELECT count(*) FROM public.onboarding_conversations)                               AS onboarding_rows;

SELECT 'business_os entitlements: post-apply checks passed (read-only)' AS result;

COMMIT;
