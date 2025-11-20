-- Add execution_id column to token_usage table for token reconciliation
-- This enables tracking all tokens by execution for revenue integrity verification

-- Add execution_id column (nullable to support existing records)
ALTER TABLE token_usage
ADD COLUMN IF NOT EXISTS execution_id UUID;

-- Add index for fast lookups by execution_id (critical for reconciliation queries)
CREATE INDEX IF NOT EXISTS idx_token_usage_execution_id
ON token_usage(execution_id);

-- Add composite index for agent + execution queries
CREATE INDEX IF NOT EXISTS idx_token_usage_agent_execution
ON token_usage(agent_id, execution_id);

-- Add comment explaining the column
COMMENT ON COLUMN token_usage.execution_id IS 'Links token usage to specific workflow execution for reconciliation and auditing';
