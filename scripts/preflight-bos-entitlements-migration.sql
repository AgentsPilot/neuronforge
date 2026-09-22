-- PRE-FLIGHT for the Business OS entitlements migrations — READ ONLY.
--
--   psql "$BOS_DB" -v ON_ERROR_STOP=1 -f scripts/preflight-bos-entitlements-migration.sql
--
-- ✅ SAFE ON PRODUCTION, and meant for it. Run it BEFORE applying anything. Like
-- the post-apply checker, the whole run is inside `SET TRANSACTION READ ONLY`,
-- so the database itself refuses any write a future edit might introduce.
--
-- ── WHY THIS EXISTS (SA P-1) ────────────────────────────────────────────────
-- The migrations will be applied straight to production, with no branch database
-- anywhere in front of them. Everything that could go wrong is knowable
-- beforehand, in about two minutes, with three questions:
--
--   1. Is anything already there?  `CREATE TABLE IF NOT EXISTS` SILENTLY SKIPS a
--      table that already exists with a different shape — the post-apply checks
--      would then pass over real drift. A clean database is the assumption; this
--      is where it gets checked rather than assumed.
--   2. Is any tenant missing its login row?  The backfill inserts one row per
--      tenant into a table with an FK to `auth.users`. Both parent tables have
--      validated FKs, so an orphan should be impossible — and "should be
--      impossible" is exactly what a first production run finds out. An orphan
--      aborts the whole backfill, and the fix (a `WHERE EXISTS` guard) is much
--      better decided now than mid-apply.
--   3. How big is the scan?  The backfill reads `onboarding_conversations` in
--      full. §4.20 says its duration cannot be known before running it; that is
--      true of the write, but the READ can be timed right here, which is the
--      number RM actually wants.
--
-- Nothing below fails the run for a "yes": each check reports, and the ones that
-- need a decision say what the decision is. Only a genuinely broken
-- precondition raises.

\set ON_ERROR_STOP on
\timing on

BEGIN;
SET TRANSACTION READ ONLY;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Is the database clean?
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  present text[] := ARRAY[]::text[];
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
    IF to_regclass('public.' || name) IS NOT NULL THEN present := present || ('table ' || name); END IF;
  END LOOP;

  FOREACH name IN ARRAY functions LOOP
    IF EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = name
    ) THEN present := present || ('function ' || name); END IF;
  END LOOP;

  FOREACH name IN ARRAY triggers LOOP
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = name) THEN
      present := present || ('trigger ' || name);
    END IF;
  END LOOP;

  IF array_length(present, 1) IS NULL THEN
    RAISE NOTICE '1. clean: none of the nine objects exists yet. Safe to apply.';
  ELSE
    -- Deliberately an exception: a partly-applied module is the one state where
    -- running the migration would report success while leaving drift behind.
    RAISE EXCEPTION E'1. NOT CLEAN — already present: %.\n'
      'Applying now would SKIP these (CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE) and the '
      'post-apply checks could pass over a table with the wrong shape. Either this migration has '
      'already been applied (in which case run scripts/check-bos-entitlements-migration.sql '
      'instead), or a previous attempt half-landed (in which case use '
      'scripts/rollback-bos-entitlements-migration.sql first).',
      array_to_string(present, ', ');
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Would the backfill's foreign key hold?
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE orphans int;
BEGIN
  SELECT count(*) INTO orphans
  FROM (
    SELECT user_id FROM public.business_profiles
    UNION
    SELECT user_id FROM public.onboarding_conversations
  ) AS t
  LEFT JOIN auth.users u ON u.id = t.user_id
  WHERE u.id IS NULL;

  IF orphans = 0 THEN
    RAISE NOTICE '2. no orphans: every tenant has an auth.users row, so the backfill FK will hold.';
  ELSE
    RAISE WARNING E'2. % tenant(s) have NO auth.users row.\n'
      'The backfill inserts into a table with an FK to auth.users, so it would abort in full '
      '(nothing partially applied). DECIDE BEFORE APPLYING: add a guard to the backfill''s SELECT — '
      'AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = tenants.user_id) — which skips those '
      'accounts deliberately, and record why they exist.', orphans;
  END IF;
END $$;

-- The orphans themselves, if there are any. Ids only: no names, no emails.
SELECT t.user_id AS tenant_without_auth_user
FROM (
  SELECT user_id FROM public.business_profiles
  UNION
  SELECT user_id FROM public.onboarding_conversations
) AS t
LEFT JOIN auth.users u ON u.id = t.user_id
WHERE u.id IS NULL
LIMIT 20;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. How big is the work, and how long does the read take?
--
-- `\timing on` at the top of the file times the SELECT below. It performs the
-- backfill's own scan — union, group, both joins — and counts the result
-- instead of inserting it. The insert adds the write cost on top, but this is
-- the number that tells RM whether the backfill is a second or a minute.
-- ────────────────────────────────────────────────────────────────────────────

SELECT
  (SELECT count(*) FROM public.onboarding_conversations)                            AS onboarding_rows,
  (SELECT count(*) FROM public.business_profiles)                                   AS business_profiles,
  (SELECT count(*) FROM auth.users)                                                 AS auth_users;

-- The backfill's SELECT, counted rather than inserted (same scan, no write).
SELECT count(*) AS rows_the_backfill_would_insert
FROM (
  SELECT user_id FROM public.business_profiles
  UNION
  SELECT user_id FROM public.onboarding_conversations
) AS tenants
LEFT JOIN (
  SELECT user_id, MIN(created_at) AS first_message_at
  FROM public.onboarding_conversations GROUP BY user_id
) AS onboarding ON onboarding.user_id = tenants.user_id
LEFT JOIN public.business_profiles AS profiles ON profiles.user_id = tenants.user_id
WHERE tenants.user_id IS NOT NULL;

-- How the planner intends to do it. Worth a glance for a sequential scan over a
-- table far larger than expected; EXPLAIN without ANALYZE executes nothing.
EXPLAIN
SELECT tenants.user_id
FROM (
  SELECT user_id FROM public.business_profiles
  UNION
  SELECT user_id FROM public.onboarding_conversations
) AS tenants
LEFT JOIN (
  SELECT user_id, MIN(created_at) AS first_message_at
  FROM public.onboarding_conversations GROUP BY user_id
) AS onboarding ON onboarding.user_id = tenants.user_id
LEFT JOIN public.business_profiles AS profiles ON profiles.user_id = tenants.user_id;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Is now a quiet moment?
--
-- Step 2 of the apply needs an ACCESS EXCLUSIVE lock on both parent tables for
-- the instant it creates the triggers, and waits up to 5s for it. A long-running
-- transaction touching those tables will make it fail — which is safe, but it is
-- nicer to know before than to read it in an error.
-- ────────────────────────────────────────────────────────────────────────────

SELECT count(*) FILTER (WHERE state <> 'idle')                                    AS active_queries,
       count(*) FILTER (WHERE state = 'idle in transaction')                      AS idle_in_transaction,
       COALESCE(max(EXTRACT(epoch FROM (now() - xact_start)))::int, 0)            AS longest_transaction_seconds
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid();

SELECT 'business_os entitlements: pre-flight complete — read the notices above before applying' AS result;

COMMIT;
