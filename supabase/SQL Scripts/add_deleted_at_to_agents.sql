-- Migration: Add deleted_at column to agents table for soft delete functionality
-- This enables the AgentRepository to soft-delete agents instead of hard-deleting them

-- Add deleted_at column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'agents'
        AND column_name = 'deleted_at'
    ) THEN
        ALTER TABLE public.agents
        ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;

        RAISE NOTICE 'Added deleted_at column to agents table';
    ELSE
        RAISE NOTICE 'deleted_at column already exists in agents table';
    END IF;
END $$;

-- Create index for efficient queries on non-deleted agents
CREATE INDEX IF NOT EXISTS idx_agents_deleted_at
ON public.agents (deleted_at)
WHERE deleted_at IS NULL;

-- Create index for querying deleted agents (for recovery/admin purposes)
CREATE INDEX IF NOT EXISTS idx_agents_deleted_at_not_null
ON public.agents (deleted_at)
WHERE deleted_at IS NOT NULL;

-- Add comment to column
COMMENT ON COLUMN public.agents.deleted_at IS 'Timestamp when agent was soft-deleted. NULL means agent is active.';

-- Verify the column was added
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
    AND table_name = 'agents'
    AND column_name = 'deleted_at';
