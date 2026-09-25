-- Business OS entitlements — component 1: the backfill, in its own transaction.
--
-- Run AFTER 20261005_business_os_entitlements.sql.
--
-- ── WHY THIS IS NOT IN THE SCHEMA MIGRATION (SA M-1) ────────────────────────
-- That migration creates triggers, which take ACCESS EXCLUSIVE locks on
-- `onboarding_conversations` and `business_profiles` until it commits. A scan of
-- those tables inside the same transaction would hold those locks for its whole
-- duration, blocking every onboarding message and profile write in the product.
-- Splitting it costs nothing: the triggers are already live, so any tenant
-- created between the two migrations already has a row and the insert below
-- skips it.
--
-- ── WHAT IT DOES ────────────────────────────────────────────────────────────
-- Every account that already exists in Business OS becomes an OPEN-ENDED
-- CHAMPION: every capability, with no end date, until an admin sets one
-- (workplan RC-3, U-2, UD-4. Requirement B-3 revised / P-2).
--
-- This is the moment the record is created. It changes no behaviour — nothing
-- reads these tables until BOS_ENTITLEMENTS_MODE is switched on, which is a
-- later slice and a separate decision.
--
-- The facts are taken from the history of the tenant so the derived dates are
-- right the first time: the first onboarding message, and when the business
-- profile was created.
--
-- Idempotent: `ON CONFLICT DO NOTHING`. Re-running it after new signups leaves
-- their trigger-created trial rows exactly as they are — turning those into
-- champions is the job of the launch operation, at enforcement switch-on, and not
-- the job of this migration.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- A deliberate ceiling on how long this may run (SA P-2).
--
-- Supabase sets role-level statement timeouts, so without this the backfill
-- inherits a number nobody here chose: it either dies at a surprise boundary
-- part-way through a scan, or runs unbounded on a table whose size we do not
-- know in advance. Ten minutes is far beyond the expected runtime — the
-- pre-flight script measures the real scan first — and failing at a chosen
-- limit is recoverable: the whole file is one transaction, so a timeout leaves
-- the database exactly as it was and the run can simply be repeated.
SET LOCAL statement_timeout = '10min';

INSERT INTO public.business_os_account_plans (
  user_id, cohort, cohort_expires_at, origin,
  onboarding_started_at, profile_created_at
)
SELECT
  tenants.user_id,
  'champion',
  NULL,          -- open-ended: no end date until an admin sets one (UD-4)
  'backfill',
  onboarding.first_message_at,
  profiles.created_at
FROM (
  SELECT user_id FROM public.business_profiles
  UNION
  SELECT user_id FROM public.onboarding_conversations
) AS tenants
LEFT JOIN (
  SELECT user_id, MIN(created_at) AS first_message_at
  FROM public.onboarding_conversations
  GROUP BY user_id
) AS onboarding ON onboarding.user_id = tenants.user_id
LEFT JOIN public.business_profiles AS profiles ON profiles.user_id = tenants.user_id
WHERE tenants.user_id IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

-- ── Heal the facts of rows this insert skipped (QA Q-5) ─────────────────────
--
-- Between the two migrations the triggers are already live. A tenant who writes
-- in that gap gets a trigger-created row carrying only ONE fact — the one that
-- trigger records — and the insert above then skips them (`DO NOTHING`). Because
-- the triggers fire AFTER INSERT only, the other fact could never be filled
-- afterwards, and the trial clock is derived from it.
--
-- This fills NULL facts from the history of the tenant. It can only write where
-- the column is NULL, so it cannot move a fact that was already recorded, and it
-- touches no cohort, tier or pin — a trial still cannot be restarted by it. It
-- is also why re-running this file stays inert: after the first run there is
-- nothing left to fill.
--
-- What it does NOT do is change the cohort of a gap row from `trial` to
-- `champion`. That is the job of the launch operation at enforcement switch-on, which
-- makes every account with no tier a champion. Until then the window query in
-- the runbook (workplan §14.6 step 5b) lists them.
UPDATE public.business_os_account_plans AS p
   SET onboarding_started_at = COALESCE(
         p.onboarding_started_at,
         (SELECT min(oc.created_at) FROM public.onboarding_conversations oc WHERE oc.user_id = p.user_id)
       ),
       profile_created_at = COALESCE(
         p.profile_created_at,
         (SELECT bp.created_at FROM public.business_profiles bp WHERE bp.user_id = p.user_id)
       ),
       updated_at = now()
 -- Only rows where a fact is BOTH missing and recoverable. Without the EXISTS
 -- clauses this would rewrite `updated_at` on every re-run for accounts whose
 -- fact is legitimately absent (no profile yet), which would make the migration
 -- non-inert on a second run — the property the runbook fingerprints.
 WHERE (p.onboarding_started_at IS NULL
        AND EXISTS (SELECT 1 FROM public.onboarding_conversations oc WHERE oc.user_id = p.user_id))
    OR (p.profile_created_at IS NULL
        AND EXISTS (SELECT 1 FROM public.business_profiles bp WHERE bp.user_id = p.user_id));

COMMIT;

-- Verification (see scripts/verify-bos-entitlements-migration.sql for the full
-- set). Expect zero rows: every Business OS tenant now has a plan row.
--
--   SELECT tenants.user_id
--   FROM (SELECT user_id FROM public.business_profiles
--         UNION SELECT user_id FROM public.onboarding_conversations) AS tenants
--   LEFT JOIN public.business_os_account_plans p ON p.user_id = tenants.user_id
--   WHERE p.user_id IS NULL
