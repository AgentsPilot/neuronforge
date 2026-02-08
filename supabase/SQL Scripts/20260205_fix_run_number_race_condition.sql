-- Fix race condition in run_number calculation
-- Creates a database function for atomic run_number generation

-- Create function to get next run_number atomically
CREATE OR REPLACE FUNCTION get_next_run_number(p_agent_id uuid)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  next_run_number integer;
  lock_key bigint;
  lock_acquired boolean;
BEGIN
  -- Convert UUID to a bigint for advisory lock
  -- Use hashtext to get a consistent numeric value from the UUID
  lock_key := hashtext(p_agent_id::text);

  -- Acquire session-level advisory lock (blocking)
  -- This ensures only one function call can execute at a time for this agent
  lock_acquired := pg_try_advisory_lock(lock_key);

  -- If we couldn't get the lock, wait for it
  IF NOT lock_acquired THEN
    PERFORM pg_advisory_lock(lock_key);
  END IF;

  -- Now safely get the next run_number while holding the lock
  SELECT COALESCE(MAX(run_number), 0) + 1
  INTO next_run_number
  FROM run_memories
  WHERE agent_id = p_agent_id;

  -- Release the lock before returning
  PERFORM pg_advisory_unlock(lock_key);

  RETURN next_run_number;
END;
$$;

-- Add comment to document the function
COMMENT ON FUNCTION get_next_run_number IS
  'Atomically generates the next run_number for an agent.
   Uses PostgreSQL advisory locks to prevent race conditions when multiple
   executions finish simultaneously for the same agent.
   The lock is automatically released at transaction end.';

-- Grant execute permission to authenticated users and service role
GRANT EXECUTE ON FUNCTION get_next_run_number TO authenticated;
GRANT EXECUTE ON FUNCTION get_next_run_number TO service_role;

-- Create function to increment usage_count atomically
CREATE OR REPLACE FUNCTION increment_memory_usage(p_memory_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE user_memory
  SET 
    usage_count = COALESCE(usage_count, 0) + 1,
    last_used_at = NOW()
  WHERE id = p_memory_id;
END;
$$;

-- Add comment to document the function
COMMENT ON FUNCTION increment_memory_usage IS
  'Atomically increments the usage_count for a user memory and updates last_used_at.';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION increment_memory_usage TO authenticated;
GRANT EXECUTE ON FUNCTION increment_memory_usage TO service_role;
