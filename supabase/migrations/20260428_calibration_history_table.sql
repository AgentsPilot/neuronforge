-- Create calibration history table for analytics and tracking
-- This table stores EVERY calibration run, enabling:
-- 1. Historical trend analysis
-- 2. V6 quality metrics
-- 3. Pattern detection for common issues
-- 4. Product improvement insights

-- Drop existing incomplete columns from agents table
ALTER TABLE agents
DROP COLUMN IF EXISTS last_calibration_status,
DROP COLUMN IF EXISTS last_calibration_at,
DROP COLUMN IF EXISTS calibration_metadata,
DROP COLUMN IF EXISTS validation_metadata;

-- Keep workflow_hash in agents table (it's useful for change detection)
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS workflow_hash TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS last_successful_calibration_id UUID DEFAULT NULL;

-- Create calibration_history table
CREATE TABLE IF NOT EXISTS calibration_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  session_id UUID REFERENCES calibration_sessions(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Workflow snapshot at calibration time
  workflow_hash TEXT NOT NULL,
  workflow_step_count INTEGER NOT NULL,

  -- Calibration results
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'needs_review', 'verification_only')),
  iterations INTEGER NOT NULL DEFAULT 1,
  auto_fixes_applied INTEGER NOT NULL DEFAULT 0,

  -- Issue tracking
  issues_found JSONB NOT NULL DEFAULT '[]', -- Array of issues detected
  issues_fixed JSONB NOT NULL DEFAULT '[]', -- Array of issues auto-fixed
  issues_remaining JSONB NOT NULL DEFAULT '[]', -- Issues requiring user action

  -- Execution metrics
  execution_time_ms INTEGER,
  steps_completed INTEGER NOT NULL DEFAULT 0,
  steps_failed INTEGER NOT NULL DEFAULT 0,
  steps_skipped INTEGER NOT NULL DEFAULT 0,

  -- V6 metadata for quality tracking
  v6_version TEXT, -- e.g., "v6.2.1" - helps track generation improvements
  model_used TEXT, -- e.g., "claude-sonnet-4-5" - model quality correlation

  -- Additional context
  metadata JSONB DEFAULT '{}', -- Flexible field for future analytics

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for efficient querying

-- Most common query: Get calibration history for an agent
CREATE INDEX idx_calibration_history_agent_id
ON calibration_history(agent_id, created_at DESC);

-- Analytics query: Success rate by status
CREATE INDEX idx_calibration_history_status
ON calibration_history(status, created_at DESC);

-- Analytics query: Issues by category
CREATE INDEX idx_calibration_history_issues_found
ON calibration_history USING GIN(issues_found);

-- Performance tracking: Workflow hash patterns
CREATE INDEX idx_calibration_history_workflow_hash
ON calibration_history(workflow_hash, status);

-- User-specific analytics
CREATE INDEX idx_calibration_history_user_id
ON calibration_history(user_id, created_at DESC);

-- Session lookup
CREATE INDEX idx_calibration_history_session_id
ON calibration_history(session_id) WHERE session_id IS NOT NULL;

-- Add foreign key from agents to last successful calibration
ALTER TABLE agents
ADD CONSTRAINT fk_agents_last_calibration
FOREIGN KEY (last_successful_calibration_id)
REFERENCES calibration_history(id)
ON DELETE SET NULL;

-- Create index on agents for quick calibration status lookup
CREATE INDEX IF NOT EXISTS idx_agents_calibration_status
ON agents(id, workflow_hash, last_successful_calibration_id);

-- Row Level Security (RLS)
ALTER TABLE calibration_history ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own calibration history
CREATE POLICY calibration_history_select_own
ON calibration_history
FOR SELECT
USING (auth.uid() = user_id);

-- Policy: Users can insert their own calibration history
CREATE POLICY calibration_history_insert_own
ON calibration_history
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own calibration history
CREATE POLICY calibration_history_update_own
ON calibration_history
FOR UPDATE
USING (auth.uid() = user_id);

-- Comments for documentation
COMMENT ON TABLE calibration_history IS 'Historical record of all calibration runs for analytics and quality tracking';
COMMENT ON COLUMN calibration_history.workflow_hash IS 'SHA-256 hash of pilot_steps at calibration time - enables regression detection';
COMMENT ON COLUMN calibration_history.status IS 'Outcome: success (0 issues), failed (runtime errors), needs_review (user action needed), verification_only (fast path)';
COMMENT ON COLUMN calibration_history.issues_found IS 'JSONB array of all issues detected during calibration';
COMMENT ON COLUMN calibration_history.issues_fixed IS 'JSONB array of issues automatically repaired';
COMMENT ON COLUMN calibration_history.v6_version IS 'Version of V6 generation system - for tracking quality improvements';
COMMENT ON COLUMN calibration_history.model_used IS 'LLM model used for generation - correlate model with calibration success';

-- Analytics view: Calibration success rate by workflow type
CREATE OR REPLACE VIEW calibration_success_metrics AS
SELECT
  DATE_TRUNC('day', created_at) as date,
  status,
  COUNT(*) as count,
  AVG(iterations) as avg_iterations,
  AVG(auto_fixes_applied) as avg_fixes,
  AVG(execution_time_ms) as avg_execution_time_ms,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY iterations) as median_iterations
FROM calibration_history
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', created_at), status
ORDER BY date DESC, status;

COMMENT ON VIEW calibration_success_metrics IS 'Daily calibration metrics for the last 30 days - success rates and performance';
