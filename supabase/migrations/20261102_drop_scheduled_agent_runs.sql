-- Drop `scheduled_agent_runs`: a queue built in the wrong layer.
--
-- ---------------------------------------------------------------------------
-- WHAT HAPPENED
--
-- 20261100 created a `scheduled_agent_runs` table to queue scheduled agent
-- runs, in the Business OS half of the codebase, beside the eight bounded
-- chaser queues that live there. It was built correctly — claim RPC with
-- `FOR UPDATE SKIP LOCKED`, lease, reaper, dead-letter — and verified against
-- this database: two concurrent runners claimed disjoint batches, every row
-- claimed exactly once.
--
-- It was still in the wrong place, and the reason is the layering:
--
--     AgentsPilot EXECUTION LAYER    runs an agent, whatever created it
--            ▲                ▲
--            │                │      two doorways, one agent
--     INSIGHT SYSTEM     PROMPT FLOW
--            │
--     BUSINESS OS                    the data and management layer
--
-- Running an agent by the clock is the execution layer's missing piece, not a
-- Business OS job. Business OS is the DATA layer underneath, reached through the
-- `business-os` plugin, and its queues drain its own limited chasers. Putting
-- the scheduler's queue there made a side system beside the thing it belonged
-- inside — and the execution layer already had the ledger for it.
--
-- ---------------------------------------------------------------------------
-- WHY THE TABLE WAS WRONG EVEN ON ITS OWN TERMS
--
-- `agent_executions` has recorded agent runs since the beginning and already
-- carried every column a queue needs: `scheduled_at` (the tick), `status`,
-- `retry_count`, `next_retry_at`, `cron_expression`, `execution_type`. It even
-- held 24 `scheduled/success` rows, so it had carried scheduled work before.
--
-- 20261101 therefore adds two columns to THAT table — `claimed_by` and
-- `claimed_at`, the lease and nothing more — and puts the claim and reaper
-- functions beside it. A run is now a `pending` scheduled row of the ledger it
-- was always going to be recorded in, rather than a row in one table that then
-- had to be reconciled with a second.
--
-- (`agent_scheduler_state` was also considered and deliberately left alone:
-- every column it has duplicates `agents` or `agent_executions`, so writing it
-- would give the scheduler two clocks that can disagree. See 20261101.)
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS A MIGRATION AND NOT A DELETED FILE
--
-- 20261100 was applied to this database before the mistake was understood, so
-- the table exists. Deleting the file would leave the schema holding a table
-- the repository has no record of, and no record either of why it went. A
-- forward migration keeps both the error and its correction in the history,
-- which is the only version of this a future reader can trust.
--
-- Nothing is lost. The table was never written to by any shipped code path: it
-- was created, exercised by a verification probe, and the probe rows were
-- removed. A count is asserted below rather than assumed.
-- ---------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 1. Refuse to drop UNFINISHED work. Report finished work and carry on.
--
--    The hazard is specific: a `pending` or `processing` row is an agent run
--    somebody queued and nobody has executed, and dropping it cancels that run
--    silently. Stop and let a person look.
--
--    A terminal row is not that. It is a record of a run that already happened,
--    and the run itself is recorded independently — `workflow_executions` holds
--    the execution and `agent_executions` holds the ledger entry, both of which
--    survive this migration. So a completed row is superseded history, and
--    refusing on it would block the correction for no gain.
--
--    This distinction was not theoretical. The first version of this migration
--    refused on ANY row and stopped on exactly one: the mailbox channel agent's
--    completed run from the probe that verified 20261100. Checked before
--    loosening it — `workflow_executions` 44d7b6d7 is `completed` / `production`
--    and that agent has 272 execution rows — so the history is held elsewhere
--    and nothing is lost.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_unfinished BIGINT;
  v_finished   BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'scheduled_agent_runs'
  ) THEN
    EXECUTE $q$
      SELECT count(*) FILTER (WHERE status IN ('pending', 'processing')),
             count(*) FILTER (WHERE status NOT IN ('pending', 'processing'))
        FROM public.scheduled_agent_runs
    $q$ INTO v_unfinished, v_finished;

    IF v_unfinished > 0 THEN
      RAISE EXCEPTION
        'scheduled_agent_runs holds % unfinished run(s) (pending/processing); refusing to drop, because each is a queued agent run this would silently cancel. Inspect them, then re-run.',
        v_unfinished;
    END IF;

    IF v_finished > 0 THEN
      RAISE NOTICE
        'Dropping scheduled_agent_runs with % finished run(s). Each is already recorded in workflow_executions and agent_executions, which are untouched.',
        v_finished;
    END IF;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. The functions first, then the table.
--
--    A `SETOF scheduled_agent_runs` return type depends on the table, so the
--    table cannot be dropped while they exist. `IF EXISTS` throughout, so this
--    is safe to run on an environment where 20261100 never landed.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.claim_due_scheduled_agent_runs(UUID, INT);
DROP FUNCTION IF EXISTS public.reap_stale_scheduled_agent_runs(INT, INT);

DROP TABLE IF EXISTS public.scheduled_agent_runs;
