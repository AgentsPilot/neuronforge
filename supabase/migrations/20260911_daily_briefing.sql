-- ============================================================================
-- Daily Briefing
--
-- Three things:
--   1. `daily_briefings`      — the rendered story, cached one row per business
--                               day so a reload does not pay for another LLM call.
--   2. `daily_briefing_sends` — the send ledger for the opt-in morning email,
--                               following the durable-queue claim pattern in
--                               BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md §8.1.
--   3. `business_profiles.daily_briefing_email_enabled` — the opt-in itself.
--
-- Why the ledger rather than "select users and send": the cron wakes hourly to
-- catch every timezone, so it evaluates each business up to 24 times a day when
-- exactly one send is correct. Email is not idempotent. UNIQUE(user_id,
-- briefing_date) is what makes the other 23 wake-ups no-ops, and the claim RPC
-- is what stops two overlapping runs both dispatching.
--
-- Date: 2026-09-11
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The opt-in.
--
-- Lives on business_profiles rather than user_preferences: user_preferences has
-- no DDL anywhere in this repo, so a migration against it would fail on a fresh
-- environment. (The business timezone this feature reads DOES live there, which
-- is a pre-existing inconsistency, not one introduced here.)
-- ----------------------------------------------------------------------------
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS daily_briefing_email_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN business_profiles.daily_briefing_email_enabled IS
  'Opt-in for the morning briefing email. Off by default; requires a timezone on user_preferences to be meaningful.';

-- The cron reads only the opted-in minority, so a partial index keeps that scan
-- proportional to the subscribers rather than to the user table.
CREATE INDEX IF NOT EXISTS idx_business_profiles_briefing_enabled
  ON business_profiles(user_id)
  WHERE daily_briefing_email_enabled;

-- ----------------------------------------------------------------------------
-- 2. The rendered briefing, cached per business day.
--
-- `facts_hash` is what makes this a cache rather than a daily snapshot: when a
-- booking is cancelled at 11am the facts change, the hash changes, and the text
-- is re-rendered. An idle reload leaves both alone and costs nothing.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The business's own local date, not a UTC date. Two businesses reading the
  -- same instant can legitimately hold different values here.
  briefing_date DATE NOT NULL,
  timezone TEXT NOT NULL,

  -- Fingerprint of the BriefingFacts the text was rendered from.
  facts_hash TEXT NOT NULL,
  facts JSONB NOT NULL,

  -- The rendered story, and how it was produced. 'fallback' means the provider
  -- failed and the deterministic templates ran instead — worth being able to
  -- count, because a day of all-fallback is an outage nobody would otherwise see.
  narrative TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'llm' CHECK (source IN ('llm', 'fallback')),
  language TEXT NOT NULL DEFAULT 'en',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, briefing_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_briefings_user_date
  ON daily_briefings(user_id, briefing_date DESC);

ALTER TABLE daily_briefings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their own briefings" ON daily_briefings;
CREATE POLICY "Users read their own briefings"
  ON daily_briefings FOR SELECT
  USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 3. The send ledger.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_briefing_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  briefing_date DATE NOT NULL,
  timezone TEXT NOT NULL,

  -- pending → processing → sent | skipped | failed
  -- 'skipped' is terminal and expected: a quiet day is not emailed.
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'skipped', 'failed')),

  claimed_by UUID,
  claimed_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,

  error_message TEXT,
  skip_reason TEXT,
  sent_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The whole anti-double-send guarantee in one constraint.
  UNIQUE (user_id, briefing_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_briefing_sends_pending
  ON daily_briefing_sends(created_at)
  WHERE status = 'pending';

ALTER TABLE daily_briefing_sends ENABLE ROW LEVEL SECURITY;
-- No policy: the dispatcher runs as service-role. Nothing user-facing reads it.

-- ----------------------------------------------------------------------------
-- 4. Claim RPC — batched FOR UPDATE SKIP LOCKED, so two overlapping cron runs
--    cannot both take the same row.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_due_daily_briefings(p_runner UUID, p_batch INT)
RETURNS SETOF daily_briefing_sends
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE daily_briefing_sends
     SET status = 'processing',
         claimed_by = p_runner,
         claimed_at = now(),
         attempts = attempts + 1
   WHERE id IN (
     SELECT id
       FROM daily_briefing_sends
      WHERE status = 'pending'
        AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      ORDER BY created_at
      LIMIT p_batch
      FOR UPDATE SKIP LOCKED
   )
  RETURNING *;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Reaper — recover rows whose runner died mid-send.
--
--    The lease must exceed the function's maxDuration, or a row still being
--    worked on gets reclaimed and sent twice. maxDuration is 60s; lease is 90s.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reap_stale_daily_briefings(p_lease_seconds INT, p_max_attempts INT)
RETURNS SETOF daily_briefing_sends
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Dead-letter rows that have exhausted their attempts, so a permanently
  -- failing address stops being retried forever.
  UPDATE daily_briefing_sends
     SET status = 'failed',
         error_message = 'dead-letter: max attempts',
         claimed_by = NULL,
         claimed_at = NULL,
         next_attempt_at = NULL
   WHERE status = 'processing'
     AND claimed_at < now() - make_interval(secs => p_lease_seconds)
     AND attempts >= p_max_attempts;

  RETURN QUERY
  UPDATE daily_briefing_sends
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
-- 6. Lock down: service-role only, never anon/authenticated.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION claim_due_daily_briefings(UUID, INT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION reap_stale_daily_briefings(INT, INT) FROM anon, authenticated;
