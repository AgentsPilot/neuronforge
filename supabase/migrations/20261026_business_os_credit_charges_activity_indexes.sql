-- Admin AI Activity view, slice B0-prime (FR-B11, SA-RC-1, SA-B1-1, D-7).
-- Workplan: docs/workplans/BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B1_WORKPLAN.md section A.
--
-- Two indexes on the credit ledger, and nothing else: no function, no grant,
-- no table change. Hand-applied by the user in the Supabase SQL editor on
-- production; verified afterwards with
-- scripts/check-bos-credit-charges-activity-indexes.sql.
--
-- Index (a) LEADS WITH kind and is NOT partial (SA-B1-1). PostgREST may send
-- filter values as bound parameters, and a cached generic plan cannot use an
-- index whose partial predicate needs the parameter value. With kind leading,
-- the equality on kind, the created_at range and the order
-- created_at DESC, id DESC are served whatever the plan.
--
-- Index (b) stays partial: adjusts_action_id IS NOT NULL is implied by any
-- strict equality or = ANY on that column, whatever the parameter value.
--
-- lock_timeout is 1s, below the 1.5 s budget of the charge writer
-- (aiChargeRecorder.ts BOS_AI_CHARGE_WRITE_BUDGET_MS): a CREATE INDEX that has
-- to queue holds every later charge INSERT behind it. A timed-out apply rolls
-- back whole and is simply re-run.
--
-- Plain CREATE INDEX, deliberately not CONCURRENTLY: the table holds about a
-- hundred rows, so the build takes milliseconds, and CONCURRENTLY cannot run
-- inside a transaction block.

BEGIN;

SET LOCAL lock_timeout = '1s';

CREATE INDEX IF NOT EXISTS business_os_credit_charges_kind_created_idx
  ON public.business_os_credit_charges (kind, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS business_os_credit_charges_adjusts_action_idx
  ON public.business_os_credit_charges (adjusts_action_id)
  WHERE adjusts_action_id IS NOT NULL;

COMMIT;
