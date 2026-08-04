-- Derived Metrics Table
-- Pre-computed metrics from business_events for efficient querying
-- Used by detectors to compare current values against baselines

CREATE TABLE IF NOT EXISTS derived_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Metric identification
  metric_key TEXT NOT NULL,
  period_type TEXT NOT NULL, -- daily, weekly, monthly
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,

  -- Metric value
  value DECIMAL(15, 4) NOT NULL,
  unit TEXT NOT NULL, -- count, usd, percentage, seconds, days

  -- Baseline comparison
  baseline_value DECIMAL(15, 4),
  baseline_period TEXT, -- e.g., "previous_7d", "previous_month"
  percent_change DECIMAL(8, 4),

  -- Statistical context
  sample_size INTEGER NOT NULL,
  std_deviation DECIMAL(15, 4),

  -- Breakdown for drill-down (optional)
  breakdown JSONB, -- e.g., { "monday": 12, "tuesday": 8 }

  -- Metadata
  computed_at TIMESTAMPTZ DEFAULT now(),

  -- Ensure uniqueness per metric/period
  UNIQUE(user_id, metric_key, period_type, period_start)
);

-- Performance indexes
CREATE INDEX idx_derived_metrics_user_key ON derived_metrics(user_id, metric_key);
CREATE INDEX idx_derived_metrics_user_period ON derived_metrics(user_id, period_type, period_start DESC);
CREATE INDEX idx_derived_metrics_computed ON derived_metrics(computed_at DESC);

-- RLS policies
ALTER TABLE derived_metrics ENABLE ROW LEVEL SECURITY;

-- Users can only read their own metrics
CREATE POLICY "Users can view own derived metrics"
  ON derived_metrics
  FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can do everything (for cron jobs)
CREATE POLICY "Service role has full access to derived metrics"
  ON derived_metrics
  FOR ALL
  USING (auth.role() = 'service_role');

-- Add comments for documentation
COMMENT ON TABLE derived_metrics IS 'Pre-computed metrics from business_events. Computed daily by cron job for efficient detector queries.';
COMMENT ON COLUMN derived_metrics.metric_key IS 'Metric identifier, e.g., acquisition.page_views, cashflow.revenue_mtd';
COMMENT ON COLUMN derived_metrics.baseline_value IS 'Historical average for comparison';
COMMENT ON COLUMN derived_metrics.sample_size IS 'Number of data points used to compute this metric';
