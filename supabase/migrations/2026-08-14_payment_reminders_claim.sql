-- ============================================================================
-- Payment Reminders — durable-queue claim pattern (Task A)
-- ============================================================================
-- Migration date: 2026-08-14
-- Companion: docs/architecture/BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md §8.1
-- Workplan:  docs/workplans/BUSINESS_OS_PAYMENT_QUEUE_DRAIN_WORKPLAN.md (Task A)
--
-- Turns `payment_reminders` into a durable claim queue so the reminders cron
-- (PaymentReminderService.processDueReminders) can atomically claim due rows
-- via SELECT ... FOR UPDATE SKIP LOCKED before dispatching — no double-send,
-- no select-then-process race.
--
-- STATUS VOCAB (M5, documented — there is NO CHECK constraint on this column
-- today and this migration deliberately does NOT add one):
--   pending    — scheduled, not yet claimed (the only claimable state)
--   processing — claimed / in-flight (holds the lease via claimed_by/claimed_at)
--   sent       — terminal success
--   failed     — terminal failure / dead-letter (max attempts)
--   cancelled  — terminal, user-cancelled
--
-- Exactly-once effect: the claim only ever selects `status='pending'`, so a row
-- that reached a terminal state is never re-dispatched. Duplicate effects are
-- bounded to a genuine crash-then-reap of a `processing` row (at-least-once).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Claim-queue columns (idempotent)
-- ----------------------------------------------------------------------------
ALTER TABLE payment_reminders ADD COLUMN IF NOT EXISTS claimed_by UUID;
ALTER TABLE payment_reminders ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE payment_reminders ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;
ALTER TABLE payment_reminders ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

-- The existing partial index backs the claim hot path (select of `status='pending'`):
--   idx_payment_reminders_scheduled ON payment_reminders(scheduled_at) WHERE status = 'pending'
-- (20260723_enhance_payments.sql:315). It is correct as-is — no new index needed here.

-- ----------------------------------------------------------------------------
-- 2. Claim RPC — atomically claim a bounded batch of due pending reminders.
--    SECURITY DEFINER + service-role only (crons use supabaseServer).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_due_payment_reminders(p_runner UUID, p_batch INT)
RETURNS SETOF payment_reminders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE payment_reminders
     SET status = 'processing',
         claimed_by = p_runner,
         claimed_at = now(),
         attempts = attempts + 1
   WHERE id IN (
     SELECT id
       FROM payment_reminders
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
-- 3. Reaper RPC — reclaim rows stuck in `processing` past the lease.
--    Rows past lease with attempts < max → back to `pending` with backoff.
--    Rows past lease with attempts >= max → terminal `failed` (dead-letter).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reap_stale_payment_reminders(p_lease_seconds INT, p_max_attempts INT)
RETURNS SETOF payment_reminders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Dead-letter poison rows that have exhausted their attempts.
  UPDATE payment_reminders
     SET status = 'failed',
         error_message = 'dead-letter: max attempts',
         claimed_by = NULL,
         claimed_at = NULL,
         next_attempt_at = NULL
   WHERE status = 'processing'
     AND claimed_at < now() - make_interval(secs => p_lease_seconds)
     AND attempts >= p_max_attempts;

  -- Reclaim the rest to `pending` with an exponential-backoff gate.
  RETURN QUERY
  UPDATE payment_reminders
     SET status = 'pending',
         claimed_by = NULL,
         claimed_at = NULL,
         next_attempt_at = now() + make_interval(secs => least(3600, 60 * power(2, attempts)::int))
   WHERE status = 'processing'
     AND claimed_at < now() - make_interval(secs => p_lease_seconds)
     AND attempts < p_max_attempts
  RETURNING *;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Lock down: service-role only (never anon/authenticated).
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION claim_due_payment_reminders(UUID, INT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION reap_stale_payment_reminders(INT, INT) FROM anon, authenticated;

-- ============================================================================
-- DOWN MIGRATION (manual — uncomment to roll back)
-- ============================================================================
-- DROP FUNCTION IF EXISTS claim_due_payment_reminders(UUID, INT);
-- DROP FUNCTION IF EXISTS reap_stale_payment_reminders(INT, INT);
-- ALTER TABLE payment_reminders DROP COLUMN IF EXISTS claimed_by;
-- ALTER TABLE payment_reminders DROP COLUMN IF EXISTS claimed_at;
-- ALTER TABLE payment_reminders DROP COLUMN IF EXISTS attempts;
-- ALTER TABLE payment_reminders DROP COLUMN IF EXISTS next_attempt_at;
