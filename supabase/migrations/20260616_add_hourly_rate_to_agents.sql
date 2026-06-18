-- Migration: Add hourly_rate_usd to agents table
-- Purpose: Per-agent hourly rate for ROI calculation (different automations have different costs)
-- Date: 2026-06-16

-- Step 1: Add hourly_rate_usd column to agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS hourly_rate_usd NUMERIC;

-- Step 2: Create partial index for fast lookups (only index non-null values)
CREATE INDEX IF NOT EXISTS idx_agents_hourly_rate ON agents(hourly_rate_usd) WHERE hourly_rate_usd IS NOT NULL;

-- Step 3: Add comment for documentation
COMMENT ON COLUMN agents.hourly_rate_usd IS 'Per-agent hourly rate for ROI calculation. Different automations may have different costs based on who performs the task.';
