-- ============================================================================
-- Payment Automation Executions — durable-queue claim pattern (Task B)
-- ============================================================================
-- Migration date: 2026-08-14
-- Companion: docs/architecture/BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md §8.1
-- Workplan:  docs/workplans/BUSINESS_OS_PAYMENT_QUEUE_DRAIN_WORKPLAN.md (Task B)
--   Folds SA required-changes M1 (index), M4 (status vocab reconcile), M5 (per-table term).
--
-- Turns `payment_automation_executions` into a durable claim queue drained by
-- PaymentAutomationEngine.processScheduledExecutions. Also adds the phantom
-- `trigger_event_id` column that the engine already reads/writes (defect 3).
--
-- STATUS VOCAB (M4/M5, documented — there is NO CHECK constraint on this column
-- today and this migration deliberately does NOT add one):
--   pending     — enqueued at emit time, not yet claimed (the only claimable state)
--   running     — claimed / in-flight (holds the lease via claimed_by/claimed_at)
--   completed   — terminal success
--   failed      — terminal failure (also used for guardrail-skips and dead-letter)
--   cancelled   — terminal, user-cancelled
--   dead_letter — terminal, reaper-declared poison (attempts >= max)
--
-- Legacy vocab was `scheduled`/`executing`/`executed`; remapped below (M4). The
-- table is effectively dark (no live producer today) so the remap is low-risk.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Phantom + claim-queue columns (idempotent)
-- ----------------------------------------------------------------------------
-- M1/defect 3: `trigger_event_id` was read/written by the engine but never existed.
ALTER TABLE payment_automation_executions
  ADD COLUMN IF NOT EXISTS trigger_event_id UUID REFERENCES payment_events(id) ON DELETE SET NULL;

ALTER TABLE payment_automation_executions ADD COLUMN IF NOT EXISTS claimed_by UUID;
ALTER TABLE payment_automation_executions ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE payment_automation_executions ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;
ALTER TABLE payment_automation_executions ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 2. Reconcile legacy status vocab (M4) — defensive remap of any dark rows.
-- ----------------------------------------------------------------------------
UPDATE payment_automation_executions SET status = 'pending'   WHERE status = 'scheduled';
UPDATE payment_automation_executions SET status = 'completed' WHERE status = 'executed';
UPDATE payment_automation_executions SET status = 'running'   WHERE status = 'executing';

-- ----------------------------------------------------------------------------
-- 3. Index (M1, BLOCKING): the old partial index was WHERE status='scheduled',
--    which no longer exists in the vocab and does NOT back the pending claim.
--    Drop it and create the correct WHERE status='pending' partial index.
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_payment_automation_executions_scheduled;
CREATE INDEX IF NOT EXISTS idx_payment_automation_executions_pending
  ON payment_automation_executions(scheduled_at) WHERE status = 'pending';

-- ----------------------------------------------------------------------------
-- 4. Claim RPC — atomically claim a bounded batch of due pending executions.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_due_payment_automation_executions(p_runner UUID, p_batch INT)
RETURNS SETOF payment_automation_executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE payment_automation_executions
     SET status = 'running',
         claimed_by = p_runner,
         claimed_at = now(),
         attempts = attempts + 1
   WHERE id IN (
     SELECT id
       FROM payment_automation_executions
      WHERE status = 'pending'
        AND scheduled_at <= now()
        AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      ORDER BY scheduled_at
      LIMIT p_batch
      FOR UPDATE SKIP LOCKED
   )
  RETURNING *;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Reaper RPC — reclaim rows stuck in `running` past the lease.
--    attempts < max → back to `pending` with backoff; attempts >= max → dead_letter.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reap_stale_payment_automation_executions(p_lease_seconds INT, p_max_attempts INT)
RETURNS SETOF payment_automation_executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Dead-letter poison rows that have exhausted their attempts.
  UPDATE payment_automation_executions
     SET status = 'dead_letter',
         error_message = 'dead-letter: max attempts',
         claimed_by = NULL,
         claimed_at = NULL,
         next_attempt_at = NULL
   WHERE status = 'running'
     AND claimed_at < now() - make_interval(secs => p_lease_seconds)
     AND attempts >= p_max_attempts;

  -- Reclaim the rest to `pending` with an exponential-backoff gate.
  RETURN QUERY
  UPDATE payment_automation_executions
     SET status = 'pending',
         claimed_by = NULL,
         claimed_at = NULL,
         next_attempt_at = now() + make_interval(secs => least(3600, 60 * power(2, attempts)::int))
   WHERE status = 'running'
     AND claimed_at < now() - make_interval(secs => p_lease_seconds)
     AND attempts < p_max_attempts
  RETURNING *;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Lock down: service-role only (never anon/authenticated).
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION claim_due_payment_automation_executions(UUID, INT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION reap_stale_payment_automation_executions(INT, INT) FROM anon, authenticated;

-- ============================================================================
-- DOWN MIGRATION (manual — uncomment to roll back)
-- ============================================================================
-- DROP FUNCTION IF EXISTS claim_due_payment_automation_executions(UUID, INT);
-- DROP FUNCTION IF EXISTS reap_stale_payment_automation_executions(INT, INT);
-- DROP INDEX IF EXISTS idx_payment_automation_executions_pending;
-- CREATE INDEX IF NOT EXISTS idx_payment_automation_executions_scheduled
--   ON payment_automation_executions(scheduled_at) WHERE status = 'scheduled';
-- ALTER TABLE payment_automation_executions DROP COLUMN IF EXISTS trigger_event_id;
-- ALTER TABLE payment_automation_executions DROP COLUMN IF EXISTS claimed_by;
-- ALTER TABLE payment_automation_executions DROP COLUMN IF EXISTS claimed_at;
-- ALTER TABLE payment_automation_executions DROP COLUMN IF EXISTS attempts;
-- ALTER TABLE payment_automation_executions DROP COLUMN IF EXISTS next_attempt_at;
-- (Legacy status remap in step 2 is not reversed — the legacy vocab is retired.)
