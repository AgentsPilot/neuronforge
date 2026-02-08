-- Fix race condition in run_number calculation
-- Creates a database function for atomic run_number generation

-- Create function to get next run_number atomically
CREATE OR REPLACE FUNCTION get_next_run_number(p_agent_id uuid)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  next_run_number integer;
BEGIN
  -- Lock the agent's memories for update to prevent race conditions
  -- This uses row-level locking to ensure atomicity
  SELECT COALESCE(MAX(run_number), 0) + 1
  INTO next_run_number
  FROM run_memories
  WHERE agent_id = p_agent_id
  FOR UPDATE;

  RETURN next_run_number;
END;
$$;

-- Add comment to document the function
COMMENT ON FUNCTION get_next_run_number IS
  'Atomically generates the next run_number for an agent.
   Uses FOR UPDATE locking to prevent race conditions when multiple
   executions finish simultaneously for the same agent.';

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
