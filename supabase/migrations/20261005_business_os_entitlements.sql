-- Business OS subscription & entitlements — component 1: plan records (schema only).
--
-- Workplan: docs/workplans/business-os-subscription-entitlements.md §4.3 (component 1)
-- Requirement: docs/requirements/BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md
--
-- ⚠️ THIS FILE WAS EDITED ON 2026-09-24, AFTER IT WAS APPLIED TO PRODUCTION.
-- It no longer matches the SQL the live database received, so do not read it as
-- a record of what ran there.
--
--   WHAT PRODUCTION GOT   this file as it stood on 2026-09-23, whose REVOKE
--                         ENUMERATED seven privileges, plus the follow-up
--                         supabase/migrations/20261009_business_os_entitlements_privilege_fix.sql
--                         which repairs the two gaps that enumeration left.
--   WHAT THIS FILE IS     the corrected version. A fresh apply of it alone
--                         reaches the same end state, and does NOT need 20261009.
--
-- The two gaps were: `anon` and `authenticated` kept PostgreSQL 17 MAINTAIN,
-- which the list predates, and `service_role` kept DELETE and TRUNCATE, which a
-- GRANT naming three privileges never took away. Both are corrected below, each
-- at the statement it belongs to. Check A4 in
-- scripts/check-bos-entitlements-migration.sql is what found them, and is what
-- tells you which state a given database is in.
--
-- ── WHAT THIS IS ────────────────────────────────────────────────────────────
-- Three tables that record, per Business OS account, what the account is
-- entitled to and what an admin has changed about it, plus the functions that
-- keep them correct. NOTHING READS THEM YET: the resolver (component 3) and the
-- shadow hook (component 4) come later, and both are behind
-- BOS_ENTITLEMENTS_MODE, which defaults to off. Applying this migration is
-- therefore invisible to customers — except that every existing tenant acquires
-- an open-ended champion row (see the SEPARATE backfill migration, 20261005b).
--
-- ── WHY THE BACKFILL IS A SEPARATE MIGRATION (SA M-1) ───────────────────────
-- `CREATE TRIGGER` takes an ACCESS EXCLUSIVE lock on `onboarding_conversations`
-- and `business_profiles` and holds it until COMMIT. A backfill inside this
-- transaction would hold those locks for the whole scan, so every onboarding
-- message and every profile write in the product would block behind the deploy.
-- So: this transaction is schema only, with a bounded `lock_timeout` so it fails
-- fast rather than queueing behind a long-running query. 20261005b does the
-- backfill in its own transaction afterwards.
--
-- The S-8(g) guarantee, no window where a new tenant is covered by neither,
-- the triggers are live when this transaction commits, so a tenant created
-- between the two migrations gets its row from the trigger and the backfill is
-- a no-op for it (`ON CONFLICT DO NOTHING`).
--
-- ── TENANCY AND PURGE ───────────────────────────────────────────────────────
-- Every table is keyed by the `user_id` of the owner with an FK to `auth.users(id)`,
-- deliberately NOT to `business_profiles`. A Business OS "Reset / start over"
-- cascades from `business_profiles`. If these rows cascaded with it, an owner
-- could reset their way into a fresh trial. The tables are registered as
-- `never` in lib/business-os/purge/descriptors.ts and as person-owned in
-- lib/business-os/businessOwnedTables.ts, in the same change as this file.
--
-- ── RLS (workplan RC-8) ─────────────────────────────────────────────────────
-- RLS is ON and there is NO policy at all, plus explicit REVOKEs: `reason`,
-- `ended_reason` and the actor ids are admin-internal, and nothing reads these
-- tables with a user session. Every read and write goes through the service
-- role via lib/repositories/BusinessOs*Repository.ts. Creating no policy also
-- satisfies R5 of the admin-authz guard (no RLS policy may reference
-- profiles.role).
--
-- ── NO TIER NAMES IN SQL ────────────────────────────────────────────────────
-- `tier` and `cohort` are plain text with no CHECK listing values. Tier names
-- live in one place, lib/business-os/entitlements/config (FR-12), and are
-- validated in the application with Zod before any write. A CHECK here would be
-- a second source of truth that a pricing change would have to migrate.

BEGIN;

-- Fail fast instead of queueing behind a long-running statement while holding
-- locks that block product writes (M-1).
SET LOCAL lock_timeout = '5s';

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Tables
-- ────────────────────────────────────────────────────────────────────────────

-- One row per Business OS account. The lifecycle state (trial / champion /
-- active / grace / paused) is DERIVED from these columns at resolution time and
-- is never stored, so no cron has to move accounts between states and no
-- unscheduled job can silently fail to run.
CREATE TABLE IF NOT EXISTS public.business_os_account_plans (
  user_id               uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Commercial assignment. Validated in the app against the tier config.
  tier                  text NULL,
  -- The matrix version this account subscribed at, for grandfathering.
  -- 0 means "unversioned, so treat it as the version current at trial start", which is
  -- only meaningful while there is no tier — hence the CHECK below.
  plan_version          integer NOT NULL DEFAULT 0,
  -- A-1: the tier assignment has its OWN end date, mirroring cohort_expires_at.
  -- NULL means no end date (forever). In Slice 4 this becomes the Stripe
  -- current-period end, so "cancelled at period end" needs no new column.
  tier_expires_at       timestamptz NULL,

  -- Cohort assignment: the value trial or the value champion. Validated in the app.
  cohort                text NULL,
  -- NULL means OPEN-ENDED for a champion: free access with no end date. An
  -- admin must say so explicitly (the admin route requires the key), and the
  -- report lists every account in this state.
  cohort_expires_at     timestamptz NULL,

  -- FACTS: what the tenant did. Written once by the triggers below, via
  -- COALESCE, and never overwritten — not by a later message, not by an
  -- onboarding reset, not by a business Reset. The trial clock is derived from
  -- whichever fact the config names, so a customer cannot restart a trial by
  -- replaying the event that started it.
  onboarding_started_at timestamptz NULL,
  profile_created_at    timestamptz NULL,

  -- PINS: admin overrides of the derived dates. NULL means "derive it".
  trial_started_at      timestamptz NULL,
  trial_ends_at         timestamptz NULL,
  grace_ends_at         timestamptz NULL,

  -- Anniversary anchor for metered periods (Slice 3). Set when a tier or cohort
  -- is assigned. Becomes the Stripe billing-cycle anchor in Slice 4.
  period_anchor         timestamptz NOT NULL DEFAULT now(),

  -- How this row came to exist: onboarding_trigger, profile_trigger, backfill,
  -- admin, admin_reset or launch. Free text on purpose: it is
  -- provenance for humans, not a control value.
  origin                text NOT NULL,

  -- Plain uuid with NO foreign key, deliberately (workplan RC-9). An FK with no
  -- ON DELETE would block deleting the auth user of an admin. ON DELETE SET NULL
  -- would erase the durable actor record that WC-7 requires precisely so that
  -- history does not depend on the audit queue surviving.
  updated_by_admin_id   uuid NULL,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- A tier always carries a real matrix version. Version 0 with a tier would
  -- silently grandfather everything.
  CONSTRAINT business_os_account_plans_tier_versioned
    CHECK (tier IS NULL OR plan_version > 0),

  -- M-3: an end date with nothing to end is unreachable for the resolver and
  -- could only ever be a bug. The admin route returns 409 before either of
  -- these can fire, so a constraint violation is never how the user hears it.
  CONSTRAINT business_os_account_plans_tier_expiry_needs_tier
    CHECK (tier IS NOT NULL OR tier_expires_at IS NULL),
  CONSTRAINT business_os_account_plans_cohort_expiry_needs_cohort
    CHECK (cohort IS NOT NULL OR cohort_expires_at IS NULL)
);

COMMENT ON TABLE public.business_os_account_plans IS
  'Business OS entitlement state per account (owner user_id). Lifecycle is derived from these timestamps at read time, and no cron moves accounts between states. Never purged: see lib/business-os/purge/descriptors.ts.';
COMMENT ON COLUMN public.business_os_account_plans.tier_expires_at IS
  'End of the tier assignment. NULL = no end date (forever). Stripe current-period end from Slice 4.';
COMMENT ON COLUMN public.business_os_account_plans.cohort_expires_at IS
  'End of the cohort assignment. NULL = open-ended (a champion with no end date). Listed by the admin report.';

-- Per-account admin adjustments. Rows are ENDED, never deleted: they are the
-- durable record of who granted or revoked what, and why.
CREATE TABLE IF NOT EXISTS public.business_os_entitlement_overrides (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- FK to the plan row, which itself has an FK to auth.users, so PostgREST can embed the
  -- overrides in the plan select: one round trip for a resolution (T-5).
  user_id            uuid NOT NULL
                       REFERENCES public.business_os_account_plans(user_id) ON DELETE CASCADE,
  capability         text NOT NULL,
  -- The three merge operations of the resolver. This IS schema — it is the
  -- grammar of an override, not a pricing value — so a CHECK belongs here.
  op                 text NOT NULL CHECK (op IN ('set', 'add', 'revoke')),
  value              jsonb NULL,
  reason             text NOT NULL CHECK (length(btrim(reason)) >= 3),
  expires_at         timestamptz NULL,
  actor_admin_id     uuid NOT NULL,        -- no FK, same reason as above (RC-9)
  created_at         timestamptz NOT NULL DEFAULT now(),
  ended_at           timestamptz NULL,
  ended_by_admin_id  uuid NULL,
  ended_reason       text NULL
);

CREATE INDEX IF NOT EXISTS business_os_entitlement_overrides_active_idx
  ON public.business_os_entitlement_overrides (user_id)
  WHERE ended_at IS NULL;

COMMENT ON TABLE public.business_os_entitlement_overrides IS
  'Admin grants/revocations per account. Ended, never deleted — including by the reset operation, which marks them ended rather than erasing the record.';

-- Shadow-mode observations: what the resolver WOULD have answered, aggregated
-- per day. `allowed` outcomes are recorded too, because with no tiers
-- configured a denials-only log would be empty and would lose the usage data
-- the tier design depends on.
CREATE TABLE IF NOT EXISTS public.business_os_entitlement_shadow_events (
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  capability            text NOT NULL,
  surface               text NOT NULL,
  outcome               text NOT NULL,
  -- Which read-rule interpretation produced the capability set, so both can be
  -- recorded in the same run and compared with real numbers.
  rule                  text NOT NULL,
  day                   date NOT NULL,
  hits                  integer NOT NULL DEFAULT 0,
  items_total           bigint  NOT NULL DEFAULT 0,
  items_max             integer NOT NULL DEFAULT 0,
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  sample_correlation_id text NULL,
  PRIMARY KEY (user_id, capability, surface, outcome, rule, day)
);

CREATE INDEX IF NOT EXISTS business_os_entitlement_shadow_events_day_idx
  ON public.business_os_entitlement_shadow_events (day);

COMMENT ON TABLE public.business_os_entitlement_shadow_events IS
  'Aggregated shadow-mode decisions (one row per account/capability/surface/outcome/rule/day). Observability only, and nothing reads it to make a decision.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. RLS and privileges (RC-8)
--
-- RLS on, no policies at all, and the named privileges revoked from the two
-- client roles. `service_role` is not named: it has BYPASSRLS and keeps its
-- grants, which is how the repositories reach these tables.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.business_os_account_plans             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_os_entitlement_overrides     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_os_entitlement_shadow_events ENABLE ROW LEVEL SECURITY;

-- REVOKE ALL, not a list. Corrected 2026-09-24 after the post-apply check A4
-- FAILED on production: this used to enumerate SELECT, INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES and TRIGGER, and PostgreSQL 17 added MAINTAIN (VACUUM,
-- ANALYZE, REINDEX, CLUSTER, REFRESH MATERIALIZED VIEW, LOCK TABLE). The
-- Supabase default privileges granted it to anon and authenticated at CREATE
-- time, and the enumeration did not take it away, so both client roles kept
-- `m` on all three tables.
--
-- THE TRAP IS THE ENUMERATION ITSELF. A database gains privileges over time,
-- through a major upgrade or a vendor default, and a list written today silently
-- stops covering them. REVOKE ALL cannot go stale. Enumerate the GRANT, which
-- states what we intend, and never the REVOKE, which states what we forbid.
--
-- PUBLIC is named too: it has no entry here, and a REVOKE from a role with no
-- entry is a no-op, so it costs nothing and closes the case where a later
-- default grants one.
REVOKE ALL
  ON TABLE public.business_os_account_plans,
           public.business_os_entitlement_overrides,
           public.business_os_entitlement_shadow_events
  FROM PUBLIC, anon, authenticated;

-- …and state the positive side rather than inheriting it (QA Q-4). The Supabase
-- ALTER DEFAULT PRIVILEGES normally grants `service_role` on new tables, but that
-- depends on which role applies this DDL. If it were applied by a role with
-- different defaults, `service_role` would end up with NO access and every
-- repository call would fail with "permission denied" — weeks later, because
-- nothing reads these tables until components 3 and 4.
--
-- DELETE and TRUNCATE are deliberately not granted: nothing in this module
-- deletes a plan row or an override, and the reset ENDS rows rather than
-- removing them (M-2). Corrected 2026-09-24: a GRANT that omits them does not
-- take away what the Supabase defaults already gave, so service_role held `d`
-- and `D` on production while this comment claimed otherwise. The REVOKE below
-- makes the claim true, and the GRANT after it states the positive side.
REVOKE DELETE, TRUNCATE
  ON TABLE public.business_os_account_plans,
           public.business_os_entitlement_overrides,
           public.business_os_entitlement_shadow_events
  FROM service_role;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.business_os_account_plans,
           public.business_os_entitlement_overrides,
           public.business_os_entitlement_shadow_events
  TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Functions
-- ────────────────────────────────────────────────────────────────────────────

-- Shadow counter upsert. SECURITY INVOKER + REVOKE, following the convention of
-- 20260929_usage_summary.sql: the only caller holds the service-role key, so
-- definer rights would buy nothing and would turn `user_id` into a parameter
-- any logged-in caller could aim at another tenant through PostgREST.
--
-- ⚠️ THE GROUP BY IS LOAD-BEARING (QA Q-1). PostgreSQL refuses to let one
-- command update the same row twice: without aggregating first, a payload
-- carrying two rows with the same
-- (user_id, capability, surface, outcome, rule, day) raises
--   ON CONFLICT DO UPDATE command cannot affect row a second time  (SQLSTATE 21000)
-- and the WHOLE batch is lost. That payload is not exotic — the same capability
-- denied twice on one surface in one request produces it — and because shadow
-- errors are swallowed by design the loss would be silent. Folding duplicates
-- here makes the function correct for any payload, so no caller has to remember
-- to de-duplicate.
CREATE OR REPLACE FUNCTION public.business_os_record_shadow_events(p_rows jsonb)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  INSERT INTO public.business_os_entitlement_shadow_events AS e (
    user_id, capability, surface, outcome, rule, day,
    hits, items_total, items_max, last_seen_at, sample_correlation_id
  )
  SELECT
    r.user_id, r.capability, r.surface, r.outcome, r.rule,
    COALESCE(r.day, (now() AT TIME ZONE 'utc')::date)                    AS day,
    SUM(GREATEST(COALESCE(r.hits, 1), 0))::integer                       AS hits,
    SUM(GREATEST(COALESCE(r.items_total, 0), 0))::bigint                 AS items_total,
    MAX(GREATEST(COALESCE(r.items_max, 0), 0))::integer                  AS items_max,
    now()                                                                AS last_seen_at,
    -- One sample is enough to find the request in the logs. Take any non-null.
    (array_agg(r.sample_correlation_id) FILTER (WHERE r.sample_correlation_id IS NOT NULL))[1]
  FROM jsonb_to_recordset(p_rows) AS r(
    user_id uuid, capability text, surface text, outcome text, rule text,
    day date, hits integer, items_total bigint, items_max integer,
    sample_correlation_id text
  )
  GROUP BY r.user_id, r.capability, r.surface, r.outcome, r.rule, 6
  ON CONFLICT (user_id, capability, surface, outcome, rule, day) DO UPDATE
    SET hits                  = e.hits + EXCLUDED.hits,
        items_total           = e.items_total + EXCLUDED.items_total,
        items_max             = GREATEST(e.items_max, EXCLUDED.items_max),
        last_seen_at          = EXCLUDED.last_seen_at,
        sample_correlation_id = COALESCE(EXCLUDED.sample_correlation_id, e.sample_correlation_id);
$$;

-- REVOKE ALL rather than REVOKE EXECUTE, for the same reason as the tables
-- above: EXECUTE is the only privilege a function can carry today, so the two
-- are equivalent right now, and the list is the thing that goes stale. There is
-- no gap here to fix — this is the habit, applied where it is still free.
REVOKE ALL ON FUNCTION public.business_os_record_shadow_events(jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.business_os_record_shadow_events(jsonb)
  TO service_role;

-- ── Provisioning: record a FACT, nothing else ───────────────────────────────
--
-- SECURITY DEFINER because both parent tables accept user INSERTs under RLS
-- (`WITH CHECK (auth.uid() = user_id)`) while the plan table has no user write
-- policy at all, so the trigger must not run with the rights of the caller.
--
-- Rules these two functions follow, none of them optional:
--   (a) they read ONLY NEW.user_id, plus constants and now(). They never copy
--       any other column of the parent row into the plan row.
--   (b) `search_path` set to the empty string, with every name schema-qualified.
--   (c) a `lock_timeout` of 2s: a lock on the plan table must never stall an
--       onboarding message or a profile write.
--   (d) every error becomes a WARNING. Creating a plan row must not be able to
--       fail a signup — the row is backfilled or created by an admin instead.
--   (e) the upsert can only fill a NULL fact. It cannot touch cohort, tier,
--       pins or the other fact, so deleting the onboarding transcript and
--       starting over cannot restart a trial.
CREATE OR REPLACE FUNCTION public.business_os_plan_fact_onboarding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
BEGIN
  BEGIN
    INSERT INTO public.business_os_account_plans AS p (
      user_id, cohort, origin, onboarding_started_at
    )
    VALUES (NEW.user_id, 'trial', 'onboarding_trigger', now())
    ON CONFLICT (user_id) DO UPDATE
      SET onboarding_started_at = EXCLUDED.onboarding_started_at,
          updated_at            = now()
      WHERE p.onboarding_started_at IS NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'business_os_plan_fact_onboarding failed for %: %', NEW.user_id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.business_os_plan_fact_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
BEGIN
  BEGIN
    INSERT INTO public.business_os_account_plans AS p (
      user_id, cohort, origin, profile_created_at
    )
    VALUES (NEW.user_id, 'trial', 'profile_trigger', now())
    ON CONFLICT (user_id) DO UPDATE
      SET profile_created_at = EXCLUDED.profile_created_at,
          updated_at         = now()
      WHERE p.profile_created_at IS NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'business_os_plan_fact_profile failed for %: %', NEW.user_id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- A trigger function cannot be invoked through PostgREST, but EXECUTE is
-- revoked anyway so the privilege list says what is intended.
REVOKE ALL ON FUNCTION public.business_os_plan_fact_onboarding()
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.business_os_plan_fact_profile()
  FROM public, anon, authenticated;

-- ── Admin reset: start the plan state of an account over, in place ──────────
--
-- WHY A FUNCTION. The customer-facing Reset and Purge must never touch these
-- tables (that is what stops a customer resetting into a fresh trial), so an
-- admin still needs a sanctioned way to genuinely start an account over. Doing
-- it from the application would be several statements, and a function body is one
-- transaction, so there is never an instant where the account has no plan row.
--
-- WHAT IT DOES NOT DO (SA M-2). It does not delete anything. Override rows are
-- ENDED with the reason given for the reset, because they are the durable record of what an
-- admin once granted, and the plan row is REWRITTEN IN PLACE rather than
-- recreated. `created_at` and the recorded facts survive, the "never no row"
-- invariant holds by construction, and there is no race with a provisioning
-- trigger firing between a delete and an insert.
--
-- The cohort is a required argument with no default: "start this account over"
-- must never silently decide what it starts over AS.
CREATE OR REPLACE FUNCTION public.business_os_reset_plan_state(
  p_user_id           uuid,
  p_cohort            text,
  p_cohort_expires_at timestamptz,
  p_trial_started_at  timestamptz,
  p_admin_id          uuid,
  p_reason            text
)
RETURNS public.business_os_account_plans
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  -- M-4: blank is as unacceptable as NULL. An empty-string cohort would pass a NULL
  -- check and then be stored as a value the resolver cannot interpret.
  v_cohort text := btrim(COALESCE(p_cohort, ''));
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_result public.business_os_account_plans;
BEGIN
  IF v_cohort = '' THEN
    RAISE EXCEPTION 'business_os_reset_plan_state requires an explicit cohort'
      USING ERRCODE = '22023';
  END IF;

  IF p_user_id IS NULL OR p_admin_id IS NULL THEN
    RAISE EXCEPTION 'business_os_reset_plan_state requires a target account and an acting admin'
      USING ERRCODE = '22023';
  END IF;

  IF length(v_reason) < 3 THEN
    RAISE EXCEPTION 'business_os_reset_plan_state requires a reason'
      USING ERRCODE = '22023';
  END IF;

  -- (a) End the active overrides. Never delete: this is the record WC-7 keeps
  --     outside the audit queue on purpose.
  UPDATE public.business_os_entitlement_overrides
     SET ended_at          = now(),
         ended_by_admin_id = p_admin_id,
         ended_reason      = 'plan_state_reset: ' || v_reason
   WHERE user_id = p_user_id
     AND ended_at IS NULL;

  -- (b) Rewrite the plan row in place. The INSERT branch covers an account that
  --     has no row yet (a trigger failure), so the operation is also a repair.
  --
  --     The repair branch RECOVERS THE FACTS from the history of the tenant (QA
  --     Q-2). It has to: the triggers fire AFTER INSERT only, and a repaired
  --     onboarding and profile rows of the account already exist, so a fact left NULL
  --     here can never be filled afterwards — and the trial clock is derived
  --     from it. On the DO UPDATE branch these two columns are absent from the
  --     SET list, so the facts on an existing row are untouched — only the repair
  --     branch reads history.
  --
  --     These two sub-selects read the parent tables from INSIDE A FUNCTION
  --     BODY, which is unrelated to M-1: M-1 is about the top-level of the migration
  --     DDL holding trigger locks across a scan. The guard test enforces exactly
  --     that distinction.
  INSERT INTO public.business_os_account_plans AS p (
    user_id, cohort, cohort_expires_at, trial_started_at,
    onboarding_started_at, profile_created_at,
    plan_version, period_anchor, origin, updated_by_admin_id, updated_at
  )
  VALUES (
    p_user_id,
    v_cohort,
    CASE WHEN v_cohort = 'champion' THEN p_cohort_expires_at END,
    CASE WHEN v_cohort = 'trial'    THEN p_trial_started_at  END,
    (SELECT min(oc.created_at) FROM public.onboarding_conversations oc WHERE oc.user_id = p_user_id),
    (SELECT bp.created_at FROM public.business_profiles bp WHERE bp.user_id = p_user_id),
    0, now(), 'admin_reset', p_admin_id, now()
  )
  ON CONFLICT (user_id) DO UPDATE
    SET cohort              = EXCLUDED.cohort,
        cohort_expires_at   = EXCLUDED.cohort_expires_at,
        trial_started_at    = EXCLUDED.trial_started_at,
        -- Cleared: the account is starting over, so nothing from the old
        -- assignment may survive into the new one.
        tier                = NULL,
        tier_expires_at     = NULL,
        trial_ends_at       = NULL,
        grace_ends_at       = NULL,
        plan_version        = 0,
        period_anchor       = EXCLUDED.period_anchor,
        origin              = EXCLUDED.origin,
        updated_by_admin_id = EXCLUDED.updated_by_admin_id,
        -- M-5: updated_at is maintained explicitly by every writer.
        updated_at          = EXCLUDED.updated_at
        -- Deliberately untouched: created_at, onboarding_started_at,
        -- profile_created_at. Facts are what the tenant did. A reset changes
        -- what they are entitled to, not what happened.
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.business_os_reset_plan_state(uuid, text, timestamptz, timestamptz, uuid, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.business_os_reset_plan_state(uuid, text, timestamptz, timestamptz, uuid, text)
  TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Triggers
--
-- Both fire on INSERT only. The onboarding one fires on every message, which is
-- cheap: after the first, the WHERE clause of the upsert matches nothing and no row
-- is written.
-- ────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS business_os_plan_on_onboarding ON public.onboarding_conversations;
CREATE TRIGGER business_os_plan_on_onboarding
  AFTER INSERT ON public.onboarding_conversations
  FOR EACH ROW EXECUTE FUNCTION public.business_os_plan_fact_onboarding();

DROP TRIGGER IF EXISTS business_os_plan_on_profile ON public.business_profiles;
CREATE TRIGGER business_os_plan_on_profile
  AFTER INSERT ON public.business_profiles
  FOR EACH ROW EXECUTE FUNCTION public.business_os_plan_fact_profile();

COMMIT;

-- The backfill is 20261005b_business_os_entitlements_backfill.sql. Run it after
-- this one. Running it late is safe. Running it never leaves existing tenants
-- without a row, which the ops check in the admin report counts.
