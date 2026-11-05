-- Rollback for 20261106_run_memories_run_number_collision_free.sql
--
-- Additive and DDL-only, so this is a clean undo: it drops the trigger and its
-- function and puts get_next_run_number's old comment back. Rows already
-- numbered by the trigger keep their numbers — they are valid run numbers, and
-- nothing about them depends on the trigger existing.
--
-- After pasting this, the 23505 duplicate on run_memories_agent_id_run_number_key
-- is open again, and the app-side retry in MemorySummarizer.saveMemory is the
-- only thing standing between a race and a lost memory.

BEGIN;

DROP TRIGGER IF EXISTS run_memories_assign_run_number ON public.run_memories;

DROP FUNCTION IF EXISTS public.run_memories_assign_run_number();

COMMENT ON FUNCTION public.get_next_run_number(uuid) IS
  'Atomically generates the next run_number for an agent.
   Uses PostgreSQL advisory locks to prevent race conditions when multiple
   executions finish simultaneously for the same agent.
   The lock is automatically released at transaction end.';

COMMIT;
