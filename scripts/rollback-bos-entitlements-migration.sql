-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  UNDO — SUPABASE SQL EDITOR. ⚠️ DESTRUCTIVE. IT IS DISARMED BY DEFAULT.   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- This drops the three entitlement tables and everything in them. Pasted as-is
-- it REFUSES to run; arming it is a deliberate edit you make in PASTE 2.
--
-- ── When you need it, and when you do not ───────────────────────────────────
-- You almost certainly do not. Applying these migrations changes no customer
-- behaviour: nothing in the product reads these tables and
-- `BOS_ENTITLEMENTS_MODE` defaults to `off`. The realistic failure is a
-- partially-applied first migration (a `lock_timeout` while creating a trigger),
-- and the honest fix for that is to run `20261005` again — it is written to be
-- re-runnable (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`,
-- `DROP TRIGGER IF EXISTS` before each `CREATE TRIGGER`).
--
-- Use this only when you want the schema gone entirely.
--
-- ── Two pastes, in order ────────────────────────────────────────────────────
-- PASTE 1 tells you what cannot be rebuilt. PASTE 2 does the drop.
-- Run PASTE 1 first and read it — mid-incident, a number gets read and a comment
-- does not (QA R-8).


-- ════════════════════════════════════════════════════════════════════════════
-- PASTE 1 — WHAT WOULD BE LOST. Read-only, safe, changes nothing.
--
-- If it fails with `relation … does not exist`, the apply only half-landed: that
-- table was never created, so there is nothing in it to lose. **Go straight to
-- PASTE 2** — it is written for exactly that state and will drop whatever does
-- exist (QA P-2).
-- ════════════════════════════════════════════════════════════════════════════

SET default_transaction_read_only = on;

SELECT
  'plan rows'            AS what,
  (SELECT count(*) FROM public.business_os_account_plans)::text AS how_many,
  'rebuildable — re-applying 20261005 + 20261005b recreates them from each tenant''s own history' AS after_rollback
UNION ALL
SELECT
  'set by an admin',
  (SELECT count(*) FROM public.business_os_account_plans
    WHERE origin IN ('admin', 'admin_reset', 'launch') OR updated_by_admin_id IS NOT NULL)::text,
  'NOT REBUILDABLE — cohorts, tiers and expiry dates somebody chose by hand. Export first.'
UNION ALL
SELECT
  'overrides (all)',
  (SELECT count(*) FROM public.business_os_entitlement_overrides)::text,
  'NOT REBUILDABLE — every grant and its reason. Export first.'
UNION ALL
SELECT
  'overrides still in force',
  (SELECT count(*) FROM public.business_os_entitlement_overrides WHERE ended_at IS NULL)::text,
  'NOT REBUILDABLE — and these are the ones an account is relying on right now.'
UNION ALL
SELECT
  'shadow events',
  (SELECT count(*) FROM public.business_os_entitlement_shadow_events)::text,
  'NOT REBUILDABLE — the measurement Slice 3 sets its numbers from. Export if shadow mode has run.'
UNION ALL
SELECT
  'how to export',
  '—',
  'Supabase dashboard → Table Editor → the table → Export as CSV. Do this for '
    || 'business_os_account_plans and business_os_entitlement_overrides BEFORE PASTE 2 if either '
    || 'count above is non-zero.'
UNION ALL
SELECT
  'this session',
  'transaction_read_only=' || current_setting('transaction_read_only')
    || ', default_transaction_read_only=' || current_setting('default_transaction_read_only'),
  'This connection is read-only from now on. PASTE 2 must drop things, so it opens with '
    || 'RESET default_transaction_read_only; — pasting the whole block is enough.';


-- ════════════════════════════════════════════════════════════════════════════
-- PASTE 2 — THE DROP. Copy from `RESET` to the final `SELECT`, edit ONE line,
-- then run.
-- ════════════════════════════════════════════════════════════════════════════
--
-- TO ARM IT: change  v_confirm text := 'NO';
--                to  v_confirm text := 'DROP-ENTITLEMENTS';
--
-- That is the same standard the module applies to itself: resetting ONE
-- account's plan state requires a confirm literal and the account id echoed back
-- (§4.12), so the one script that destroys everything cannot ask for less
-- (QA R-7).
--
-- ── WHY THE DROPS ARE INSIDE THE GUARD'S OWN BLOCK (QA P-1) ─────────────────
-- They used to be nine statements after it, which was safe *only if* the editor
-- submits the paste as one implicit transaction — true under PostgreSQL's simple
-- query protocol, and not something we can verify about a UI. If an editor ever
-- split the statements client-side, the guard's `RAISE EXCEPTION` would abort
-- only its own statement and the drops would run anyway.
--
-- Putting them in the same `DO` block removes the question: **the arming check
-- and the drops are one statement.** If the guard refuses, execution never
-- reaches a `DROP`, however the paste was submitted.
--
-- ── IT WORKS ON A HALF-APPLIED MIGRATION (QA P-2) ───────────────────────────
-- That is the case this script exists for, so it must not be the case it breaks
-- on. Every `DROP` is `IF EXISTS`, and the two "what is lost" counts are wrapped
-- in `to_regclass` checks — PL/pgSQL resolves a statement only when it is
-- actually executed, so a branch that is skipped never looks for a table that is
-- not there. Previously those two counts ran unconditionally and a missing plan
-- table raised `42P01`, which aborted the batch: nothing dropped, no grid, and
-- no way to finish cleaning up.

RESET default_transaction_read_only;

-- Bounded: a drop that cannot get its lock fails in 5s instead of queueing
-- behind live traffic. (Both SETs above live until this editor connection is
-- recycled, which is harmless.)
SET lock_timeout = '5s';

DO $$
DECLARE
  v_confirm text := 'NO';   -- <<<<<< EDIT THIS LINE TO ARM (see above)
  v_admin_rows int := 0;
  v_overrides int := 0;
BEGIN
  IF v_confirm <> 'DROP-ENTITLEMENTS' THEN
    RAISE EXCEPTION
      'REFUSING: this script drops business_os_account_plans, business_os_entitlement_overrides and business_os_entitlement_shadow_events. Run PASTE 1 first, export anything not rebuildable, then set v_confirm := ''DROP-ENTITLEMENTS'' in this block and run PASTE 2 again.'
      USING ERRCODE = '42501';
  END IF;

  -- Named in the failure path too, so an armed run still cannot claim it was
  -- not told (QA R-8). Guarded, so a half-applied state still gets cleaned up
  -- (QA P-2) — a missing table means there is nothing in it to lose.
  IF to_regclass('public.business_os_account_plans') IS NOT NULL THEN
    SELECT count(*) INTO v_admin_rows FROM public.business_os_account_plans
     WHERE origin IN ('admin', 'admin_reset', 'launch') OR updated_by_admin_id IS NOT NULL;
  END IF;

  IF to_regclass('public.business_os_entitlement_overrides') IS NOT NULL THEN
    SELECT count(*) INTO v_overrides FROM public.business_os_entitlement_overrides;
  END IF;

  IF v_admin_rows > 0 OR v_overrides > 0 THEN
    RAISE WARNING 'dropping % admin-set plan row(s) and % override(s); neither can be rebuilt by re-applying the migrations',
      v_admin_rows, v_overrides;
  END IF;

  -- ── 1. Triggers on the parent tables ──────────────────────────────────────
  -- The only objects this migration added to tables the product actually uses,
  -- so they come off first. The parent tables always exist; the triggers may not.
  DROP TRIGGER IF EXISTS business_os_plan_on_onboarding ON public.onboarding_conversations;
  DROP TRIGGER IF EXISTS business_os_plan_on_profile    ON public.business_profiles;

  -- ── 2. Functions ──────────────────────────────────────────────────────────
  DROP FUNCTION IF EXISTS public.business_os_plan_fact_onboarding();
  DROP FUNCTION IF EXISTS public.business_os_plan_fact_profile();
  DROP FUNCTION IF EXISTS public.business_os_record_shadow_events(jsonb);
  DROP FUNCTION IF EXISTS public.business_os_reset_plan_state(uuid, text, timestamptz, timestamptz, uuid, text);

  -- ── 3. Tables ─────────────────────────────────────────────────────────────
  -- The overrides table has an FK to the plan table, so `CASCADE` on the plan
  -- table would take it anyway; it is dropped explicitly so nothing is removed
  -- implicitly.
  DROP TABLE IF EXISTS public.business_os_entitlement_shadow_events;
  DROP TABLE IF EXISTS public.business_os_entitlement_overrides;
  DROP TABLE IF EXISTS public.business_os_account_plans;
END $$;

-- 4. Prove it: none of THESE NINE OBJECTS is left behind (3 tables + 4 functions
--    + 2 triggers — QA R-9 corrected "eight").
--
-- Enumerated, not matched with `business_os_%` (SA C-3). A pattern would sweep
-- in objects this script never claimed to drop — Slice 3's
-- `business_os_ai_action_usage`, for one — and report "rollback incomplete"
-- after a rollback that did exactly what it should. That message would arrive
-- mid-incident, which is the worst possible moment to be misleading.
--
-- A result row rather than a NOTICE, because the SQL editor does not show
-- notices: this grid IS the confirmation that the rollback finished.
WITH expected(kind, name) AS (
  VALUES
    ('table',    'business_os_account_plans'),
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
  SELECT e.kind || ' ' || e.name AS obj
  FROM expected e
  WHERE (e.kind = 'table' AND to_regclass('public.' || e.name) IS NOT NULL)
     OR (e.kind = 'function' AND EXISTS (
           SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = e.name))
     OR (e.kind = 'trigger' AND EXISTS (
           SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname = e.name))
)
SELECT
  CASE WHEN (SELECT count(*) FROM leftovers) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  CASE WHEN (SELECT count(*) FROM leftovers) = 0
       THEN 'all nine objects are gone'
       ELSE 'still present: ' || (SELECT string_agg(obj, ', ' ORDER BY obj) FROM leftovers) END AS finding,
  CASE WHEN (SELECT count(*) FROM leftovers) = 0
       THEN 'The database is back where it started. To rebuild: apply 20261005, then 20261005b, '
            || 'then run check-bos-entitlements-migration.sql.'
       ELSE 'Rollback incomplete. Something holds a dependency on the listed object(s) — read the '
            || 'error, then drop it by hand.' END AS what_to_do;
