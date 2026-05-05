-- Migration: Add simple calibration flag to agents table
-- Created: 2026-04-28
-- Purpose: Replace complex hash-based fast path with simple boolean flag

-- Add is_calibrated flag to agents table
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS is_calibrated BOOLEAN DEFAULT false;

-- Create index for fast queries on calibrated agents
CREATE INDEX IF NOT EXISTS idx_agents_is_calibrated
ON agents(is_calibrated)
WHERE is_calibrated = true;

-- Add comment explaining the flag
COMMENT ON COLUMN agents.is_calibrated IS 'True when agent has completed successful calibration with 0 issues. Enables fast path verification on subsequent calibrations.';
