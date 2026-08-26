-- Business OS chat — action log
--
-- WHY THIS TABLE EXISTS
--
-- Fan-out sends real, irreversible things to real people. Three failure modes
-- have to be impossible, and none of them can be handled in memory:
--
--   1. DOUBLE SEND. A double-clicked confirmation, a retried serverless
--      invocation, or a user re-confirming after a timeout must not email the
--      same person twice. `idempotency_key` is UNIQUE, so the second attempt
--      loses the insert race and is skipped rather than sent.
--
--   2. "DID WE ALREADY DO THIS?" surviving a restart. chat-v3 kept its journal
--      in Redis with a ~1h TTL, which is fine for conversation context and
--      useless as a record of who was contacted.
--
--   3. HONEST PARTIAL FAILURE. When 45 of 47 sends succeed, the user must be
--      told exactly that — and be able to see which two failed and why.
--
-- This is also the audit trail: every write the AI performed, with its target
-- and outcome, attributable to a plan and a person.

CREATE TABLE IF NOT EXISTS business_chat_action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Which confirmed plan and step produced this action.
  plan_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  -- The row acted on. NULL for an action that is not per-row.
  item_id TEXT,

  -- sha256(plan_id | step_id | item_id). The uniqueness of this column is the
  -- entire double-send guarantee, so it is enforced by the database rather than
  -- by application logic that a retry could bypass.
  idempotency_key TEXT NOT NULL UNIQUE,

  entity TEXT NOT NULL,
  action TEXT NOT NULL,
  -- Where it went (an email address, a row id). Kept for the audit trail.
  target TEXT,

  status TEXT NOT NULL DEFAULT 'pending'
    CONSTRAINT business_chat_action_log_status_check
    CHECK (status IN ('pending', 'succeeded', 'failed', 'skipped')),

  -- Provider name and error, so a failure is diagnosable after the fact.
  provider TEXT,
  error TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bcal_user_created
  ON business_chat_action_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bcal_plan
  ON business_chat_action_log (plan_id);

-- Supports the per-user daily send quota without a table scan.
CREATE INDEX IF NOT EXISTS idx_bcal_user_action_created
  ON business_chat_action_log (user_id, action, created_at DESC);

ALTER TABLE business_chat_action_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read own action log" ON business_chat_action_log;
CREATE POLICY "read own action log"
  ON business_chat_action_log FOR SELECT
  USING (user_id = auth.uid());

COMMENT ON TABLE business_chat_action_log IS
  'Every write the Business OS chat performed. idempotency_key UNIQUE is what makes a double-confirmed fan-out safe.';
