-- One queue for every scheduled agent run, however the agent was created.
--
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS
--
-- An agent is an `agents` row with a compiled plan in `pilot_steps`, and
-- `WorkflowPilot.execute` is the only code that reads that column. It has run
-- thousands of times — but always because somebody ASKED, over HTTP at
-- /api/run-agent. Nothing has ever run one by the clock.
--
-- Three half-mechanisms grew in that gap:
--
--   /api/run-scheduled-agents   the generic scheduler. Retired on the owner's
--                               instruction; its own guard test pins both its
--                               absence from vercel.json and the fact its code
--                               is kept. It also CANNOT run a compiled plan:
--                               it dispatches into runAgentWithContext, which
--                               contains no reference to `pilot_steps`, starts
--                               from `agent.user_prompt`, and therefore dies on
--                               `null.trim()` for any generated agent.
--
--   inboxChannelRunner          the mailbox channel's own runner. Works, and
--                               proves the shape — but claims on `last_run`
--                               while the generic one claims on `next_run`, so
--                               neither claim excludes the other.
--
--   (nothing)                   for the Business OS automation agents, which
--                               an owner can switch on from an insight card and
--                               which have never executed once.
--
-- This table is the single mechanism that replaces all three. Not a Business OS
-- side system: the scheduler selects on the SCHEDULING CONTRACT
-- (`mode='scheduled'` AND `schedule_enabled` AND `status='active'` AND
-- `next_run <= now()`), which both setup paths already write, so a
-- prompt-created agent and a generated one travel the identical road. The only
-- thing that differs is a value — the prompt is passed where there is one, and
-- `''` where there is not, and `userInput` reaches nothing in the pilot but the
-- memory injector anyway.
--
-- ---------------------------------------------------------------------------
-- WHY A QUEUE AND NOT JUST A CLAIM ON THE AGENT ROW
--
-- The mailbox runner claims by compare-and-swapping `last_run`, which is enough
-- to stop two ticks colliding and nothing more. It has no attempts counter, no
-- backoff and no dead-letter, and the consequence is written into its own
-- source: it DELIBERATELY holds a failed claim so a permanently broken mailbox
-- is not retried every tick. That is a workaround for the missing queue.
--
-- A row per run gives a run the three things that workaround stands in for:
-- attempts, exponential backoff, and a terminal state that keeps the evidence.
-- A permanently failing agent stops and says so, instead of either hammering
-- every five minutes or being quietly abandoned.
--
-- ---------------------------------------------------------------------------
-- WHY IN THE DATABASE AND NOT QSTASH
--
-- QStash is wired in this codebase and was the old dispatch path. It is not
-- used here, and the reason is not preference:
--
--   * The claim is required EITHER WAY. QStash delivers at-least-once, so two
--     deliveries of one job would run the same agent twice unless a row says
--     "mine". There is no version of this without the table below.
--   * Its callback URL in development is http://localhost:3000, which a cloud
--     service cannot reach — so a run could not be tested locally at all.
--   * /api/cron/process-queue verifies its signature ONLY in production;
--     outside it the endpoint is unauthenticated and accepts an arbitrary
--     agent_id and user_id.
--
-- Parallel dispatch stays available and additive: `FOR UPDATE SKIP LOCKED` is
-- precisely what lets several concurrent drains claim disjoint batches with no
-- coordination. If execution wall-clock ever becomes the measured ceiling, more
-- drainers is a configuration change, not a rewrite.
--
-- Modelled line for line on 20260917_insight_actions.sql — the eighth of these
-- queues, and the closest in kind. @see docs/architecture/
--   BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md §8.1
-- ---------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 1. The queue.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduled_agent_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  /*
   * The owner, copied from the agent row so a drain never has to join to find
   * out whose clients it is about to write to.
   *
   * DELIBERATELY NOT `REFERENCES business_profiles(user_id)`, which is what the
   * eight sibling queues all carry. They are Business OS tables and every row
   * in them belongs to a business. This queue serves EVERY agent, including the
   * eighty-three prompt-created ones, and an AgentsPilot user need not have a
   * business profile at all — that FK would make their agents unschedulable
   * for a reason nobody would find. Tenancy is still explicit: the column is
   * NOT NULL, it is copied from `agents.user_id`, and `agent_id` cascades.
   */
  user_id         UUID NOT NULL,

  /*
   * The agent this run belongs to. CASCADE because a run is meaningless
   * without it, and a deleted agent's queued work must not fire afterwards —
   * removal from the owner's ledger is a soft delete on `agents`, which the
   * enqueue query already excludes, but a hard delete must not leave a row
   * here pointing at nothing.
   */
  agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,

  /*
   * The tick this row is FOR — the `next_run` the scheduler saw, not the
   * moment the row was written. Two things need it: the claim orders by it so
   * the oldest missed tick runs first, and a human reading the table can tell
   * a late run from a slow one.
   */
  scheduled_for   TIMESTAMPTZ NOT NULL,

  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'completed', 'skipped', 'failed')),

  claimed_by      UUID,
  claimed_at      TIMESTAMPTZ,
  attempts        INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,

  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,

  skip_reason     TEXT,
  error_message   TEXT,

  /*
   * What the run did, in the pilot's own words — the execution id it created
   * and the step outcomes. Kept so a failed run can be understood without
   * joining three tables, and so a completed one can be shown to the owner.
   *
   * NOT the place for client-identifying detail. The execution tables hold the
   * full record; this is the summary a cron report and an admin queue page
   * read.
   */
  result          JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  /*
   * One row per agent per tick.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * THE ANTI-DOUBLE-RUN GUARANTEE, IN THE DATABASE.
   *
   * The enqueue is a read-then-write: select the agents whose `next_run` has
   * passed, then insert a row for each. Two overlapping cron ticks both see
   * the same agent, and the compare-and-swap on `agents.next_run` is what
   * normally stops the second — but a CAS is an application-level race that
   * this constraint does not have to trust.
   *
   * Keyed on the TICK rather than on the agent, so Tuesday's run and
   * Wednesday's run are different rows while two attempts at Tuesday's are
   * the same one. An agent that sends email in its owner's name is not
   * something to be relaxed about running twice.
   * ─────────────────────────────────────────────────────────────────────────
   */
  CONSTRAINT scheduled_agent_runs_one_per_tick UNIQUE (agent_id, scheduled_for)
);

COMMENT ON TABLE scheduled_agent_runs IS
  'One row per scheduled agent run, for every agent however it was created. Service-role only; drained by /api/cron/scheduled-agents.';

-- The claim's hot path: only pending rows are ever scanned.
CREATE INDEX IF NOT EXISTS idx_scheduled_agent_runs_due
  ON scheduled_agent_runs (next_attempt_at)
  WHERE status = 'pending';

-- The owner's own history, newest first.
CREATE INDEX IF NOT EXISTS idx_scheduled_agent_runs_user
  ON scheduled_agent_runs (user_id, created_at DESC);

-- "Has this agent run, and how did it go" — the question the ledger card asks.
CREATE INDEX IF NOT EXISTS idx_scheduled_agent_runs_agent
  ON scheduled_agent_runs (agent_id, created_at DESC);

/*
 * Readable by the owner so the agents ledger can say when something last ran
 * and whether it worked. Writes are service-role only: nothing in a browser
 * may mark a run as done, or claim one.
 */
ALTER TABLE scheduled_agent_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scheduled_agent_runs_read_own ON scheduled_agent_runs;
CREATE POLICY scheduled_agent_runs_read_own
  ON scheduled_agent_runs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 2. Claim — batched, skip-locked, one runner wins.
--
--    `SKIP LOCKED` rather than a plain FOR UPDATE: two runners must never grab
--    the same row and must never BLOCK on each other either, or a second
--    drainer spends its whole budget waiting for the first.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_due_scheduled_agent_runs(p_runner UUID, p_batch INT)
RETURNS SETOF scheduled_agent_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_runner IS NULL THEN
    RAISE EXCEPTION 'claim_due_scheduled_agent_runs: a runner id is required';
  END IF;

  RETURN QUERY
  UPDATE scheduled_agent_runs
     SET status = 'processing',
         claimed_by = p_runner,
         claimed_at = now(),
         started_at = COALESCE(started_at, now()),
         attempts = attempts + 1
   WHERE id IN (
     SELECT id
       FROM scheduled_agent_runs
      WHERE status = 'pending'
        AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      /* Oldest missed tick first, so a backlog drains in the order it
         accumulated rather than newest-wins. */
      ORDER BY scheduled_for, created_at
      LIMIT LEAST(GREATEST(COALESCE(p_batch, 1), 1), 100)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING *;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Reaper — recover runs whose runner died mid-execution.
--
--    The lease MUST exceed the route's maxDuration. The platform hard-kills the
--    function at maxDuration, so a row still 'processing' past the lease is
--    PROVABLY dead rather than guessed-at. maxDuration is 60s; lease is 90s.
--    Raising one without the other is how a live run gets reclaimed and an
--    agent runs twice.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reap_stale_scheduled_agent_runs(p_lease_seconds INT, p_max_attempts INT)
RETURNS SETOF scheduled_agent_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  /*
   * An agent that fails every time stops being retried forever. Kept rather
   * than deleted: this is the evidence that something is actually broken, and
   * the row can be replayed once it is fixed.
   *
   * This is what replaces the mailbox runner's deliberate "hold the claim on
   * failure" — same intent, but it ends in a state that says so.
   */
  UPDATE scheduled_agent_runs
     SET status = 'failed',
         error_message = COALESCE(error_message, 'dead-letter: max attempts'),
         finished_at = now(),
         claimed_by = NULL,
         claimed_at = NULL,
         next_attempt_at = NULL
   WHERE status = 'processing'
     AND claimed_at < now() - make_interval(secs => p_lease_seconds)
     AND attempts >= p_max_attempts;

  RETURN QUERY
  UPDATE scheduled_agent_runs
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
-- 4. Lock down: service-role only, never anon/authenticated.
--
--    These functions claim and release work across EVERY tenant by row id —
--    that is what a cron drain is — so they must be unreachable from a browser
--    session. The table's RLS policy gives an owner read access to their own
--    rows and nothing more.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION claim_due_scheduled_agent_runs(UUID, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reap_stale_scheduled_agent_runs(INT, INT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION claim_due_scheduled_agent_runs(UUID, INT) TO service_role;
GRANT EXECUTE ON FUNCTION reap_stale_scheduled_agent_runs(INT, INT) TO service_role;

REVOKE ALL ON TABLE scheduled_agent_runs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE scheduled_agent_runs TO service_role;

COMMENT ON FUNCTION claim_due_scheduled_agent_runs(UUID, INT) IS
  'Atomically claim up to p_batch due runs for one runner. FOR UPDATE SKIP LOCKED: two drains never take the same row and never block each other.';

COMMENT ON FUNCTION reap_stale_scheduled_agent_runs(INT, INT) IS
  'Reclaim runs whose runner died. p_lease_seconds must exceed the drain route maxDuration (60s) or a live run is reclaimed and the agent runs twice.';
