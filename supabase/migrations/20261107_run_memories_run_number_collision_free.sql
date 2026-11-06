-- run_memories: hand out a run_number under a lock that is still held when the row commits.
--
-- ---------------------------------------------------------------------------
-- THE BUG THIS CLOSES
--
-- Production, agent 2216fc3c:
--
--   duplicate key value violates unique constraint "run_memories_agent_id_run_number_key"
--   Key (agent_id, run_number)=(2216fc3c-…, 1) already exists.
--
-- `get_next_run_number` (supabase/SQL Scripts/20260205_fix_run_number_race_condition.sql)
-- was written to stop exactly this, and cannot. It takes an advisory lock,
-- reads MAX(run_number), and then RELEASES THE LOCK BEFORE IT RETURNS:
--
--     PERFORM pg_advisory_lock(lock_key);
--     SELECT COALESCE(MAX(run_number), 0) + 1 INTO next_run_number …;
--     PERFORM pg_advisory_unlock(lock_key);   -- the insert has not happened yet
--     RETURN next_run_number;
--
-- The caller (lib/memory/MemorySummarizer.ts) then inserts in a SEPARATE
-- round trip, so the window that matters — between reading MAX and the row
-- becoming visible — is not covered by any lock at all:
--
--     A: rpc -> MAX = 0 -> 1   (lock taken and released)
--     B: rpc -> MAX = 0 -> 1   (A has not inserted yet)
--     A: insert run_number = 1 -> commits
--     B: insert run_number = 1 -> 23505, and B's memory is lost
--
-- Two summarizations are in flight at once often enough: WorkflowPilot fires
-- summarizeForMemory fire-and-forget from both its execute path (line ~765)
-- and its resume path (line ~3340), runAgentKit has a third call site
-- (line ~695), and the scheduled runner can execute one agent in overlapping
-- windows. On a brand-new agent all of them compute 1.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES INSTEAD
--
-- A BEFORE INSERT trigger numbers the row inside the inserting transaction,
-- holding a per-agent transaction advisory lock. `pg_advisory_xact_lock` is
-- released at COMMIT, not at the end of the function, so the number and the
-- row land together and the second writer blocks until the first is visible.
-- Same pattern as 20261030 (boost cap) and 20261066 (price proposal lines).
--
-- It fires when the number WOULD COLLIDE or is absent, and otherwise leaves a
-- caller-supplied number alone. That choice is what makes this safe to apply
-- under the currently deployed build: today's code still sends run_number = 1,
-- and the trigger silently corrects it instead of raising. No app deploy has
-- to land first, and a caller that means a specific free number still gets it.
--
-- It also unbreaks memory consolidation as a side effect:
-- MemoryConsolidationScheduler inserts a consolidated row carrying the oldest
-- member's run_number and only THEN deletes the originals, so its insert
-- always collided with a live row. It now gets a fresh number.
--
-- SECURITY INVOKER, deliberately: every writer of run_memories is the service
-- role (MemorySummarizer builds its own service-role client;
-- MemoryConsolidationScheduler is passed one), so the trigger needs no
-- elevation and stays off the SECURITY DEFINER surface that 20261044 and its
-- slices are shrinking. If a client-role insert path is ever added, its RLS
-- would narrow the MAX() read and it would need revisiting.
--
-- `get_next_run_number` is left in place — the deployed build calls it, and
-- its answer is still a good starting guess. Its comment is rewritten to say
-- it is advisory, so the next reader does not trust it again.
--
-- ---------------------------------------------------------------------------
-- TIMING: apply before or after the deploy, either way. The currently
-- deployed code works unchanged against this (test 1 in the supabase-ops
-- timing test), and the app-side retry that ships with it is belt, not brace.
--
-- Pre-check: scripts/precheck-run-memories-run-number.sql
-- Checker:   scripts/check-run-memories-run-number-migration.sql
-- Rollback:  supabase/SQL Scripts/20261106_run_memories_run_number_collision_free_rollback.sql
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.run_memories_assign_run_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  -- stamp 20261106 a7f20c53d1b84e69
  v_taken boolean;
BEGIN
  -- Nothing to number without an agent; the column's own constraints judge it.
  IF NEW.agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Held until COMMIT. This is the whole point: the next writer for this agent
  -- waits until our row is visible, instead of reading MAX() behind our back.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('run_memories_run_number' || chr(58) || NEW.agent_id::text, 0)
  );

  -- A free number the caller chose is honoured.
  IF NEW.run_number IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.run_memories AS m
      WHERE m.agent_id = NEW.agent_id
        AND m.run_number = NEW.run_number
    )
    INTO v_taken;

    IF NOT v_taken THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Absent or already taken: number it here, under the lock.
  SELECT coalesce(max(m.run_number), 0) + 1
  INTO NEW.run_number
  FROM public.run_memories AS m
  WHERE m.agent_id = NEW.agent_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.run_memories_assign_run_number() IS
  'BEFORE INSERT on run_memories: assigns run_number as MAX+1 per agent when the
   incoming value is NULL or already taken, under a per-agent
   pg_advisory_xact_lock that is held until COMMIT. Closes the 23505 duplicate
   on run_memories_agent_id_run_number_key that get_next_run_number cannot
   close, because that function releases its lock before the caller inserts.';

DROP TRIGGER IF EXISTS run_memories_assign_run_number ON public.run_memories;

CREATE TRIGGER run_memories_assign_run_number
  BEFORE INSERT ON public.run_memories
  FOR EACH ROW
  EXECUTE FUNCTION public.run_memories_assign_run_number();

-- Hygiene only: PostgreSQL checks EXECUTE on a trigger function at
-- CREATE TRIGGER, never when the trigger fires (20261044 §D1), so no write
-- path changes here.
REVOKE EXECUTE ON FUNCTION public.run_memories_assign_run_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_memories_assign_run_number() TO service_role;

-- Tell the next reader what this one really is.
COMMENT ON FUNCTION public.get_next_run_number(uuid) IS
  'ADVISORY ONLY. Returns MAX(run_number)+1 for an agent, but releases its
   advisory lock before returning, so it does NOT make a caller''s later INSERT
   safe: two callers can both be handed the same number. The row is numbered
   for real by the run_memories_assign_run_number BEFORE INSERT trigger
   (20261106). Kept because the deployed build still calls it and its answer is
   a reasonable starting guess.';

COMMIT;
