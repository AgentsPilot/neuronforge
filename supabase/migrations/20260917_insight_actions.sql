-- Acting on an insight, durably.
--
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS
--
-- Every insight automation is currently declared and mapped and shown to the
-- owner, and none of them runs. The chain ends at KernelTrigger:
--
--     'Kernel process is not implemented; refusing rather than reporting
--      fabricated work'
--
-- The kernel is right to refuse rather than fake it, but the result is a
-- dashboard offering "put it on autopilot" for four processes that cannot fire.
-- Nothing under lib/business-os/insight/** imports an email service at all.
--
-- WHY NOT FIX THE KERNEL
--
-- The same reason lead_responses gave four days ago: wiring KernelTrigger to
-- BizQL is an unstarted piece of work that would touch every detector, and this
-- pattern already works. This is its fourth application after payment
-- reminders, the daily briefing and lead responses. The shape is deliberately
-- identical so there is one thing to learn rather than four.
--
-- ONE TABLE, NOT FOUR QUEUES
--
-- The four processes differ only in which template they render and which row
-- they read. They share a claim, a lease, a reaper, a dead-letter and a
-- guardrail, and splitting them would mean maintaining that machinery four
-- times over for no behavioural difference. `kind` says which effect; the
-- target columns say what it acts on.
--
-- THE DELAY LIVES IN next_attempt_at, as in lead_responses. The claim already
-- filters it, the reaper already writes it for backoff, and a second
-- `scheduled_at` would duplicate the predicate and then disagree with it.
-- ---------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 1. The ledger.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS insight_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- What produced this, kept for the work feed and for answering "why did the
  -- platform write to my client". Nullable: a manual "do it now" from the
  -- insight card has no standing automation behind it.
  insight_id      UUID REFERENCES insights(id) ON DELETE SET NULL,
  automation_id   UUID,
  detector_id     TEXT,
  process_id      TEXT NOT NULL,

  -- The effect. One per template the sender can render.
  kind            TEXT NOT NULL
                  CHECK (kind IN ('chase_invoice', 'followup_nudge', 'booking_reminder')),

  -- What it acts on. Exactly one is set, enforced below: an action with no
  -- target cannot be sent, and one with two is ambiguous about who it reaches.
  contact_id      UUID REFERENCES crm_contacts(id) ON DELETE CASCADE,
  invoice_id      UUID REFERENCES payment_invoices(id) ON DELETE CASCADE,
  booking_id      UUID REFERENCES scheduling_bookings(id) ON DELETE CASCADE,

  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'sent', 'skipped', 'failed')),

  -- Owner-chosen parameters for this run: tone, how many days overdue, and so
  -- on. Frozen at enqueue so a setting changed afterwards cannot retroactively
  -- alter a message already promised.
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,

  claimed_by      UUID,
  claimed_at      TIMESTAMPTZ,
  attempts        INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,

  skip_reason     TEXT,
  error_message   TEXT,
  sent_at         TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  /*
   * The anti-double-send guarantee, in the database rather than in someone
   * remembering to check.
   *
   * Delivery is at-least-once, so the effect has to be safe twice. The terminal
   * status covers the ordinary case — the claim only ever selects 'pending' —
   * and this covers the one it cannot: two enqueuers, a retried cron and a
   * manual trigger all deciding to chase the same invoice within the same
   * window. An email to a real client in the owner's name is not something to
   * be relaxed about sending twice.
   *
   * The key is composed by the enqueuer from the target and the period, so
   * "chase invoice X this week" collides with itself and not with next week.
   */
  dedupe_key      TEXT NOT NULL,

  CONSTRAINT insight_actions_dedupe UNIQUE (dedupe_key),

  CONSTRAINT insight_actions_one_target CHECK (
    (contact_id IS NOT NULL)::int
  + (invoice_id IS NOT NULL)::int
  + (booking_id IS NOT NULL)::int = 1
  )
);

COMMENT ON TABLE insight_actions IS
  'Queued actions the platform takes on a business''s behalf in response to an insight. Service-role only; drained by /api/cron/insight-actions.';

-- The claim's hot path: only pending rows are ever scanned.
CREATE INDEX IF NOT EXISTS idx_insight_actions_due
  ON insight_actions (next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_insight_actions_user
  ON insight_actions (user_id, created_at DESC);

-- Readable by the owner so the dashboard can show what is queued and let them
-- cancel it before it goes. Writes are service-role only: nothing in a browser
-- should be able to mark a send as done.
ALTER TABLE insight_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS insight_actions_read_own ON insight_actions;
CREATE POLICY insight_actions_read_own
  ON insight_actions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 2. Business ownership.
--
--    Deleting a business removes what it queued along with everything else it
--    owned — see 20260916_business_data_ownership.sql. NOT VALID for the same
--    reason as the rest: it enforces every new row without demanding the
--    existing ones be reconciled first.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'insight_actions_business_fk'
  ) THEN
    ALTER TABLE insight_actions
      ADD CONSTRAINT insight_actions_business_fk
      FOREIGN KEY (user_id) REFERENCES business_profiles(user_id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Claim — batched, skip-locked, one runner wins.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_due_insight_actions(p_runner UUID, p_batch INT)
RETURNS SETOF insight_actions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE insight_actions
     SET status = 'processing',
         claimed_by = p_runner,
         claimed_at = now(),
         attempts = attempts + 1
   WHERE id IN (
     SELECT id
       FROM insight_actions
      WHERE status = 'pending'
        AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      ORDER BY next_attempt_at NULLS FIRST, created_at
      LIMIT p_batch
      FOR UPDATE SKIP LOCKED
   )
  RETURNING *;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Reaper — recover rows whose runner died mid-send.
--
--    The lease must exceed the route's maxDuration, or a row still being worked
--    on is reclaimed and the client is written to twice. maxDuration is 60s;
--    lease is 90s.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reap_stale_insight_actions(p_lease_seconds INT, p_max_attempts INT)
RETURNS SETOF insight_actions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A permanently failing address stops being retried forever. Kept rather than
  -- deleted, so a real delivery problem can be found and replayed.
  UPDATE insight_actions
     SET status = 'failed',
         error_message = 'dead-letter: max attempts',
         claimed_by = NULL,
         claimed_at = NULL,
         next_attempt_at = NULL
   WHERE status = 'processing'
     AND claimed_at < now() - make_interval(secs => p_lease_seconds)
     AND attempts >= p_max_attempts;

  RETURN QUERY
  UPDATE insight_actions
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
-- 5. Lock down: service-role only, never anon/authenticated.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION claim_due_insight_actions(UUID, INT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION reap_stale_insight_actions(INT, INT) FROM anon, authenticated;
