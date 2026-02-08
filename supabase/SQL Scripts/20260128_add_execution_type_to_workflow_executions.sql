-- Add run_mode column to workflow_executions and agent_executions tables
-- This allows us to separate calibration runs from production executions
-- NOTE: execution_type already exists for 'manual' vs 'scheduled', so we use run_mode instead

-- ========================================
-- workflow_executions table
-- ========================================

-- Add the column with default value 'production'
ALTER TABLE workflow_executions
ADD COLUMN IF NOT EXISTS run_mode TEXT DEFAULT 'production'
CHECK (run_mode IN ('calibration', 'production'));

-- Create index for filtering by run mode
CREATE INDEX IF NOT EXISTS idx_workflow_executions_run_mode
ON workflow_executions(run_mode);

-- Create composite index for common query patterns (agent + run mode + date)
CREATE INDEX IF NOT EXISTS idx_workflow_executions_agent_run_mode
ON workflow_executions(agent_id, run_mode, created_at DESC);

-- Backfill existing rows to ensure they're marked as production
UPDATE workflow_executions
SET run_mode = 'production'
WHERE run_mode IS NULL;

-- Add comment to document the column
COMMENT ON COLUMN workflow_executions.run_mode IS
'Run mode: calibration (test runs before agent is ready) or production (live runs after agent is deployed)';

-- ========================================
-- agent_executions table
-- ========================================

-- Add the column with default value 'production'
ALTER TABLE agent_executions
ADD COLUMN IF NOT EXISTS run_mode TEXT DEFAULT 'production'
CHECK (run_mode IN ('calibration', 'production'));

-- Create index for filtering by run mode
CREATE INDEX IF NOT EXISTS idx_agent_executions_run_mode
ON agent_executions(run_mode);

-- Create composite index for common query patterns (agent + run mode + date)
CREATE INDEX IF NOT EXISTS idx_agent_executions_agent_run_mode
ON agent_executions(agent_id, run_mode, started_at DESC);

-- Backfill existing rows to ensure they're marked as production
UPDATE agent_executions
SET run_mode = 'production'
WHERE run_mode IS NULL;

-- Add comment to document the column
COMMENT ON COLUMN agent_executions.run_mode IS
'Run mode: calibration (test runs before agent is ready) or production (live runs after agent is deployed)';
