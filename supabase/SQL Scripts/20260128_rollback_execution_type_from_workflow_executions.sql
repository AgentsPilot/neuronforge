-- Rollback: Remove execution_type column from workflow_executions table
-- This column was accidentally added before we realized execution_type already exists
-- in agent_executions for 'manual' vs 'scheduled'. We're using run_mode instead.

-- Drop the column if it exists
ALTER TABLE workflow_executions
DROP COLUMN IF EXISTS execution_type;

-- Drop related indexes if they exist
DROP INDEX IF EXISTS idx_workflow_executions_execution_type;
DROP INDEX IF EXISTS idx_workflow_executions_agent_execution_type;
