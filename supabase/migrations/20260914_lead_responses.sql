-- Answering a lead, durably.
--
-- ---------------------------------------------------------------------------
-- WHY A LEDGER AND NOT A FIRE-AND-FORGET SEND
--
-- Two of the three things this table carries cannot be done in the request that
-- creates them:
--
--   the delay   the invitation goes out ~15 minutes after the owner is told, so
--               they have a window to change or cancel it
--   the chase   one reminder, two days later, if nobody booked
--
-- Both are "do this later, exactly once, even if the server that promised it
-- has since died" — which is the problem the claim/lease/reaper pattern in
-- §8.1 of BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md exists to solve. This is
-- its third application, after payment reminders and the daily briefing; the
-- shape is deliberately identical so there is one thing to learn rather than
-- three.
--
-- WHY NOT THE INSIGHT KERNEL
--
-- `KernelTrigger.executeProcess()` throws by design — every insight action and
-- standing automation currently refuses, and wiring it to BizQL is an unstarted
-- piece of work that would touch all 28 detectors. This runs on the pattern
-- that already works.
--
-- THE DELAY LIVES IN next_attempt_at
--
-- Not a second `scheduled_at` column. The claim below already filters
-- `next_attempt_at IS NULL OR next_attempt_at <= now()`, which IS "not before",
-- and the reaper writes the same column for backoff — only ever pushing it
-- further out, so the two compose. A separate column would duplicate the
-- predicate and then disagree with it.
-- ---------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 1. The opt-in for automatic sending.
--
--    OFF by default, unlike the alert beside it. Being told is something every
--    business wants; having the platform write to a client on their behalf is a
--    decision they should make deliberately.
-- ----------------------------------------------------------------------------
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS lead_autosend_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN business_profiles.lead_autosend_enabled IS
  'Send a booking link to a new lead automatically, ~15 minutes after the owner is alerted. Off by default: writing to a client on the business''s behalf is an opt-in.';

CREATE INDEX IF NOT EXISTS idx_business_profiles_lead_autosend
  ON business_profiles (user_id)
  WHERE lead_autosend_enabled;

-- ----------------------------------------------------------------------------
-- 2. The ledger.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_responses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,

  -- 'invite' is the first reply; 'chase' is the single reminder two days later.
  kind            TEXT NOT NULL CHECK (kind IN ('invite', 'chase')),

  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'sent', 'skipped', 'failed')),

  -- What the recommender chose, and why. Written BEFORE the owner is alerted,
  -- so the alert email and the dashboard can both name it while there is still
  -- time to change it.
  recommendation  JSONB,
  service_id      UUID,

  claimed_by      UUID,
  claimed_at      TIMESTAMPTZ,
  attempts        INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,

  skip_reason     TEXT,
  error_message   TEXT,
  sent_at         TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The whole anti-double-send guarantee, and the chase's stamp: one invitation
  -- and one reminder per person, enforced by the database rather than by
  -- remembering to check. Same doctrine as IntakeReminderService's single
  -- stamp, expressed as a constraint.
  UNIQUE (contact_id, kind)
);

COMMENT ON TABLE lead_responses IS
  'Queued replies to people who got in touch: one invitation and at most one chase per contact. Service-role only; drained by /api/cron/lead-response.';

-- Only pending rows are ever scanned.
CREATE INDEX IF NOT EXISTS idx_lead_responses_due
  ON lead_responses (next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_lead_responses_contact
  ON lead_responses (contact_id);

-- Readable by the owner so the dashboard can show what is queued and let them
-- cancel it. Writes are service-role only: nothing in the browser should be
-- able to mark a send as done.
ALTER TABLE lead_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_responses_read_own ON lead_responses;
CREATE POLICY lead_responses_read_own
  ON lead_responses FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 3. Claim — batched, skip-locked, one runner wins.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_due_lead_responses(p_runner UUID, p_batch INT)
RETURNS SETOF lead_responses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE lead_responses
     SET status = 'processing',
         claimed_by = p_runner,
         claimed_at = now(),
         attempts = attempts + 1
   WHERE id IN (
     SELECT id
       FROM lead_responses
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
CREATE OR REPLACE FUNCTION reap_stale_lead_responses(p_lease_seconds INT, p_max_attempts INT)
RETURNS SETOF lead_responses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A permanently failing address stops being retried forever.
  UPDATE lead_responses
     SET status = 'failed',
         error_message = 'dead-letter: max attempts',
         claimed_by = NULL,
         claimed_at = NULL,
         next_attempt_at = NULL
   WHERE status = 'processing'
     AND claimed_at < now() - make_interval(secs => p_lease_seconds)
     AND attempts >= p_max_attempts;

  RETURN QUERY
  UPDATE lead_responses
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
REVOKE ALL ON FUNCTION claim_due_lead_responses(UUID, INT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION reap_stale_lead_responses(INT, INT) FROM anon, authenticated;
