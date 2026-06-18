-- Migration: Create metric_baselines table
-- Date: 2026-06-15
-- Purpose: Store historical snapshots for trend comparisons (% change vs last month)

CREATE TABLE IF NOT EXISTS metric_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  org_id UUID REFERENCES organizations ON DELETE CASCADE,

  period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  -- Core execution metrics
  total_executions INTEGER DEFAULT 0,
  successful_executions INTEGER DEFAULT 0,
  failed_executions INTEGER DEFAULT 0,
  success_rate NUMERIC(5,2),

  -- Value metrics
  total_items_processed INTEGER DEFAULT 0,
  total_time_saved_seconds NUMERIC DEFAULT 0,
  total_money_saved_usd NUMERIC(10,2) DEFAULT 0,

  -- Performance metrics
  avg_execution_duration_ms NUMERIC,

  -- Trend vs previous period (calculated when storing)
  executions_change_pct NUMERIC(5,2),
  time_saved_change_pct NUMERIC(5,2),
  money_saved_change_pct NUMERIC(5,2),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure unique baseline per user/period/date
  UNIQUE(user_id, period_type, period_start)
);

-- Enable RLS
ALTER TABLE metric_baselines ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own baselines"
  ON metric_baselines FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own baselines"
  ON metric_baselines FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own baselines"
  ON metric_baselines FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own baselines"
  ON metric_baselines FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX idx_metric_baselines_user_period
  ON metric_baselines(user_id, period_type, period_start DESC);

CREATE INDEX idx_metric_baselines_org_period
  ON metric_baselines(org_id, period_type, period_start DESC)
  WHERE org_id IS NOT NULL;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_metric_baselines_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER metric_baselines_updated_at
  BEFORE UPDATE ON metric_baselines
  FOR EACH ROW
  EXECUTE FUNCTION update_metric_baselines_updated_at();
