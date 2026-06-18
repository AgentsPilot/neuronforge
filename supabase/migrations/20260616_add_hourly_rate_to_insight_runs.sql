-- Migration: Add hourly_rate_usd to execution_insight_runs table
-- Purpose: Capture the hourly rate used at execution time for accurate historical ROI tracking
-- Date: 2026-06-16
--
-- Problem: If a user changes their hourly rate, historical ROI calculations become inaccurate
-- because we only store the calculated cost_saved_usd_per_week, not the rate used to calculate it.
--
-- Solution: Store hourly_rate_usd at execution time so historical data remains auditable.

-- Step 1: Add hourly_rate_usd column to execution_insight_runs
ALTER TABLE execution_insight_runs ADD COLUMN IF NOT EXISTS hourly_rate_usd NUMERIC;

-- Step 2: Add comment for documentation
COMMENT ON COLUMN execution_insight_runs.hourly_rate_usd IS 'Hourly rate (USD) used to calculate cost_saved_usd_per_week at execution time. Captures agent-level rate if set, otherwise org/profile rate.';

-- Note: We don't backfill existing rows because we don't know what rate was used.
-- Historical rows without hourly_rate_usd should use the current agent/org rate as a fallback.
