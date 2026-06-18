-- Migration: Create group_metrics_rollup table
-- Date: 2026-06-15
-- Purpose: Aggregate metrics per workflow group for "By Category" dashboard section

CREATE TABLE IF NOT EXISTS group_metrics_rollup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES workflow_groups ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  org_id UUID REFERENCES organizations ON DELETE CASCADE,

  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  -- Execution metrics
  total_executions INTEGER DEFAULT 0,
  successful_executions INTEGER DEFAULT 0,
  success_rate NUMERIC(5,2),

  -- Value metrics
  total_time_saved_seconds NUMERIC DEFAULT 0,
  total_money_saved_usd NUMERIC(10,2) DEFAULT 0,
  items_processed INTEGER DEFAULT 0,

  -- Trend vs previous period
  time_saved_change_pct NUMERIC(5,2),

  -- Workflow count in this group at snapshot time
  workflow_count INTEGER DEFAULT 0,

  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure unique rollup per group/period
  UNIQUE(group_id, period_start)
);

-- Enable RLS
ALTER TABLE group_metrics_rollup ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own group metrics"
  ON group_metrics_rollup FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own group metrics"
  ON group_metrics_rollup FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own group metrics"
  ON group_metrics_rollup FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own group metrics"
  ON group_metrics_rollup FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX idx_group_metrics_group_period
  ON group_metrics_rollup(group_id, period_start DESC);

CREATE INDEX idx_group_metrics_user_period
  ON group_metrics_rollup(user_id, period_start DESC);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_group_metrics_rollup_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER group_metrics_rollup_updated_at
  BEFORE UPDATE ON group_metrics_rollup
  FOR EACH ROW
  EXECUTE FUNCTION update_group_metrics_rollup_updated_at();
