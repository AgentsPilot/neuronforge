-- Add PostgreSQL advisory lock functions for distributed locking
-- These are wrappers around pg_advisory_lock to expose them via Supabase RPC

-- Function to try acquiring an advisory lock (non-blocking)
CREATE OR REPLACE FUNCTION pg_try_advisory_lock(lock_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN pg_try_advisory_lock(lock_id);
END;
$$;

-- Function to release an advisory lock
CREATE OR REPLACE FUNCTION pg_advisory_unlock(lock_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN pg_advisory_unlock(lock_id);
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION pg_try_advisory_lock(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_advisory_unlock(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_try_advisory_lock(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION pg_advisory_unlock(bigint) TO service_role;
