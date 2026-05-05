-- Add calibration status tracking to agents table
-- This prevents redundant calibration iterations when workflow is already fully functional

-- Add new columns for tracking calibration state
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS last_calibration_status TEXT DEFAULT NULL CHECK (last_calibration_status IN ('success', 'failed', 'needs_review', NULL)),
ADD COLUMN IF NOT EXISTS last_calibration_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
ADD COLUMN IF NOT EXISTS workflow_hash TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS calibration_metadata JSONB DEFAULT '{}' NOT NULL;

-- Create index for efficient calibration status queries
CREATE INDEX IF NOT EXISTS idx_agents_calibration_status
ON agents(id, last_calibration_status, workflow_hash);

-- Add comments explaining the new columns
COMMENT ON COLUMN agents.last_calibration_status IS 'Status of last calibration: success (0 issues, 0 failures), failed (runtime errors), needs_review (semantic issues), or NULL';
COMMENT ON COLUMN agents.last_calibration_at IS 'Timestamp when last_calibration_status was set';
COMMENT ON COLUMN agents.workflow_hash IS 'SHA-256 hash of pilot_steps JSON - used to detect workflow changes that invalidate calibration';
COMMENT ON COLUMN agents.calibration_metadata IS 'Metadata from last calibration: {iterations, autoFixesApplied, issuesFixed, sessionId}';
