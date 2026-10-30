-- The scheduler's missing piece, on the execution layer's own table.
--
-- ---------------------------------------------------------------------------
-- WHERE THIS BELONGS, AND WHY IT IS HERE AND NOT IN A NEW TABLE
--
-- The platform is layered:
--
--     AgentsPilot EXECUTION LAYER    runs an agent, whatever created it
--            ▲                ▲
--            │                │      two doorways, one agent
--     INSIGHT SYSTEM     PROMPT FLOW
--            │
--     BUSINESS OS                    the data and management layer
--
-- An agent is an `agents` row with a compiled plan in `pilot_steps`, and
-- `WorkflowPilot.execute` is the only thing that reads it. That has run
-- thousands of times — but always because somebody ASKED, over HTTP at
-- /api/run-agent. Running one BY THE CLOCK is the one part of the execution
-- layer that was never built, and `/api/run-scheduled-agents` is its route:
-- retired, kept on disk, and unable to run a compiled plan in its old form
-- because it dispatched into a prompt-driven path.
--
-- So the queue goes on `agent_executions`, which is the execution layer's own
-- ledger and already carries every column this needs:
--
--     scheduled_at      the tick a run is for
--     status            pending → running → completed / failed
--     retry_count       attempts
--     next_retry_at     the backoff gate
--     cron_expression   what schedule produced it
--     execution_type    'scheduled' vs 'manual'
--
-- Measured before writing this: the table already holds 24 `scheduled/success`
-- and 4 `scheduled/failed` rows, so it has carried scheduled work before. It
-- holds NO pending, queued or running rows at all today, so a claim over
-- `status = 'pending'` starts on empty ground.
--
-- ---------------------------------------------------------------------------
-- WHY NOT `agent_scheduler_state`
--
-- There is a table of that name, with ten columns and zero rows, and it looks
-- purpose-built for this. It is deliberately left alone, because every column
-- it has is a denormalisation of something that already exists:
--
--     next_scheduled_at   ↔ agents.next_run
--     last_scheduled_at   ↔ agents.last_run
--     is_running          ↔ agent_executions.status = 'running'
--     last_execution_id   ↔ the newest agent_executions row
--     error_count         ↔ consecutive failed executions
--
-- Writing it would give the scheduler TWO clocks — `agents.next_run` and
-- `agent_scheduler_state.next_scheduled_at` — and two answers to "is this
-- running". One clock that is right beats two that can disagree. If a per-agent
-- summary is ever wanted for a screen, it can be built from these two tables
-- without a third being kept in step.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS REPLACES
--
-- An earlier attempt at this work (20261100) created a parallel
-- `scheduled_agent_runs` table in the Business OS half of the codebase,
-- alongside the eight §8.1 queues. That was the wrong layer: the Business OS is
-- the data layer UNDERNEATH the execution layer, and its queues drain its own
-- bounded chasers. A ninth queue there, for the execution layer's scheduler,
-- was a side system beside the thing it belonged inside. 20261102 drops it.
-- ---------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 1. The claim columns.
--
--    `retry_count` and `next_retry_at` are already here, so only the lease is
--    missing: who holds a row and since when. `is_running`-style booleans
--    cannot answer "is this claim dead", because a boolean has no clock.
-- ----------------------------------------------------------------------------
ALTER TABLE public.agent_executions
  ADD COLUMN IF NOT EXISTS claimed_by UUID,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.agent_executions.claimed_by IS
  'The scheduler invocation holding this row. NULL for a manual execution, which is never claimed.';
COMMENT ON COLUMN public.agent_executions.claimed_at IS
  'When the claim was taken. A row still ''running'' more than the lease past this is provably dead: the platform hard-kills the function at maxDuration.';

-- ----------------------------------------------------------------------------
-- 2. The claim's hot path.
--
--    Indexed on exactly the predicate the claim filters, and partial so the
--    thousand terminal rows are never scanned.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_agent_executions_claimable
  ON public.agent_executions (scheduled_at)
  WHERE status = 'pending' AND execution_type = 'scheduled';

-- ----------------------------------------------------------------------------
-- 3. One scheduled run per agent per tick.
--
--    The compare-and-swap on `agents.next_run` is what normally stops two
--    overlapping scheduler passes queueing the same tick — but that is an
--    application-level race, and this constraint does not have to trust it.
--
--    Keyed on the TICK, so Tuesday's run and Wednesday's are different rows
--    while two attempts at Tuesday's are the same one. Partial, because a
--    MANUAL execution may legitimately repeat: a person pressing run twice is
--    not a duplicate, it is two runs.
--
--    Verified safe before adding: zero duplicate (agent_id, scheduled_at)
--    pairs exist across the 1,000 rows that carry a scheduled_at.
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS agent_executions_one_scheduled_run_per_tick
  ON public.agent_executions (agent_id, scheduled_at)
  WHERE execution_type = 'scheduled' AND scheduled_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. Claim — batched, skip-locked, one runner wins.
--
--    `SKIP LOCKED` rather than a plain FOR UPDATE: two passes must never take
--    the same row, and must never BLOCK on each other either, or a second
--    runner spends its whole budget waiting for the first.
--
--    Scoped to `execution_type = 'scheduled'` so it can never touch a manual
--    run. `StateManager` writes its rows already-terminal and `process-queue`
--    writes 'manual', so neither is reachable from here.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_due_scheduled_executions(p_runner UUID, p_batch INT)
RETURNS SETOF public.agent_executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_runner IS NULL THEN
    RAISE EXCEPTION 'claim_due_scheduled_executions: a runner id is required';
  END IF;

  RETURN QUERY
  UPDATE public.agent_executions
     SET status = 'running',
         claimed_by = p_runner,
         claimed_at = now(),
         started_at = COALESCE(started_at, now()),
         retry_count = COALESCE(retry_count, 0) + 1,
         updated_at = now()
   WHERE id IN (
     SELECT id
       FROM public.agent_executions
      WHERE status = 'pending'
        AND execution_type = 'scheduled'
        AND (next_retry_at IS NULL OR next_retry_at <= now())
      /* Oldest missed tick first, so a backlog drains in the order it
         accumulated rather than newest-wins starving the oldest. */
      ORDER BY scheduled_at NULLS FIRST, created_at
      LIMIT LEAST(GREATEST(COALESCE(p_batch, 1), 1), 100)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING *;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Reaper — recover runs whose function was killed mid-execution.
--
--    The lease MUST exceed the route's maxDuration. The platform hard-kills at
--    maxDuration, which is what makes a claim older than the lease PROVABLY
--    dead rather than guessed at. Raising one without the other reclaims a LIVE
--    run and the agent runs twice.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reap_stale_scheduled_executions(p_lease_seconds INT, p_max_attempts INT)
RETURNS SETOF public.agent_executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  /*
   * An agent that fails every time stops being retried. Kept rather than
   * deleted: a dead-lettered row is the evidence that something is broken, and
   * the thing to replay once it is fixed.
   */
  UPDATE public.agent_executions
     SET status = 'failed',
         error_message = COALESCE(error_message, 'dead-letter: max attempts'),
         completed_at = now(),
         claimed_by = NULL,
         claimed_at = NULL,
         next_retry_at = NULL,
         updated_at = now()
   WHERE status = 'running'
     AND execution_type = 'scheduled'
     AND claimed_at IS NOT NULL
     AND claimed_at < now() - make_interval(secs => p_lease_seconds)
     AND COALESCE(retry_count, 0) >= p_max_attempts;

  RETURN QUERY
  UPDATE public.agent_executions
     SET status = 'pending',
         claimed_by = NULL,
         claimed_at = NULL,
         next_retry_at = now() + make_interval(secs => least(3600, 60 * power(2, COALESCE(retry_count, 0))::int)),
         updated_at = now()
   WHERE status = 'running'
     AND execution_type = 'scheduled'
     AND claimed_at IS NOT NULL
     AND claimed_at < now() - make_interval(secs => p_lease_seconds)
     AND COALESCE(retry_count, 0) < p_max_attempts
  RETURNING *;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Lock down: service-role only.
--
--    These claim and release work across EVERY tenant by row id — that is what
--    a scheduler is — so they must be unreachable from a browser session.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.claim_due_scheduled_executions(UUID, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reap_stale_scheduled_executions(INT, INT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_due_scheduled_executions(UUID, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reap_stale_scheduled_executions(INT, INT) TO service_role;

COMMENT ON FUNCTION public.claim_due_scheduled_executions(UUID, INT) IS
  'Atomically claim up to p_batch due scheduled executions for one runner, skip-locked so two passes never take the same row and never block each other.';

COMMENT ON FUNCTION public.reap_stale_scheduled_executions(INT, INT) IS
  'Reclaim scheduled executions whose runner died. p_lease_seconds must exceed the scheduler route maxDuration (60s), or a live run is reclaimed and the agent runs twice.';
