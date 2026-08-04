-- Insights Table
-- Stores detected business insights with prioritization and lifecycle tracking
-- Used by the Insight System to surface actionable recommendations

CREATE TABLE IF NOT EXISTS insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Detection source
  detector_id TEXT NOT NULL,
  detection_run_id UUID, -- Links to the cron run that detected this

  -- Classification
  category TEXT NOT NULL, -- acquisition, conversion, sales, cash_flow, retention, operations, pricing
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),

  -- Content (generated)
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  business_impact TEXT,
  recommendation TEXT,

  -- Evidence & metrics
  metric_key TEXT,
  current_value DECIMAL(15, 4),
  baseline_value DECIMAL(15, 4),
  threshold_value DECIMAL(15, 4),
  percent_change DECIMAL(8, 4),
  direction TEXT CHECK (direction IN ('above', 'below')),

  -- Affected entities
  affected_entity_type TEXT,
  affected_entity_ids UUID[],
  affected_count INTEGER DEFAULT 0,

  -- Money impact
  estimated_impact_usd DECIMAL(10, 2),
  impact_direction TEXT CHECK (impact_direction IN ('loss', 'opportunity', 'savings')),
  impact_period TEXT CHECK (impact_period IN ('daily', 'weekly', 'monthly')),

  -- Paired action
  paired_process_id TEXT,
  process_parameters JSONB DEFAULT '{}',
  eligible_for_automation BOOLEAN DEFAULT false,

  -- Prioritization
  priority_score DECIMAL(5, 2) DEFAULT 0,

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'viewed', 'snoozed', 'dismissed', 'acted', 'automated')),
  snoozed_until TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  dismiss_reason TEXT,
  acted_at TIMESTAMPTZ,
  action_execution_id UUID,

  -- Cooldown tracking
  last_surfaced_at TIMESTAMPTZ,
  surface_count INTEGER DEFAULT 0,

  -- Timestamps
  detected_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Performance indexes
CREATE INDEX idx_insights_user_status ON insights(user_id, status, created_at DESC);
CREATE INDEX idx_insights_user_priority ON insights(user_id, priority_score DESC) WHERE status = 'new';
CREATE INDEX idx_insights_detector ON insights(user_id, detector_id, created_at DESC);
CREATE INDEX idx_insights_category ON insights(user_id, category, created_at DESC);
CREATE INDEX idx_insights_cooldown ON insights(user_id, detector_id, last_surfaced_at DESC);

-- RLS policies
ALTER TABLE insights ENABLE ROW LEVEL SECURITY;

-- Users can only read their own insights
CREATE POLICY "Users can view own insights"
  ON insights
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can update their own insights (for status changes)
CREATE POLICY "Users can update own insights"
  ON insights
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Service role can do everything (for cron jobs)
CREATE POLICY "Service role has full access to insights"
  ON insights
  FOR ALL
  USING (auth.role() = 'service_role');

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_insights_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER insights_updated_at
  BEFORE UPDATE ON insights
  FOR EACH ROW
  EXECUTE FUNCTION update_insights_updated_at();

-- Owner insight history for learning preferences
CREATE TABLE IF NOT EXISTS owner_insight_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  insight_id UUID NOT NULL REFERENCES insights(id) ON DELETE CASCADE,

  action TEXT NOT NULL CHECK (action IN ('viewed', 'acted', 'dismissed', 'snoozed', 'automated')),
  detector_id TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,

  -- For learning
  time_to_action_seconds INTEGER, -- How long between surfacing and action
  was_helpful BOOLEAN, -- User feedback if provided

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_owner_insight_history_user ON owner_insight_history(user_id, created_at DESC);
CREATE INDEX idx_owner_insight_history_detector ON owner_insight_history(user_id, detector_id);

-- RLS for history
ALTER TABLE owner_insight_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own insight history"
  ON owner_insight_history
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role has full access to insight history"
  ON owner_insight_history
  FOR ALL
  USING (auth.role() = 'service_role');

-- Add comments
COMMENT ON TABLE insights IS 'Detected business insights with prioritization and lifecycle tracking';
COMMENT ON COLUMN insights.detector_id IS 'Which detector found this insight (e.g., cash_ar_overdue, ret_no_show_spike)';
COMMENT ON COLUMN insights.priority_score IS 'Computed score for ranking (0-100) based on severity, money impact, recency, actionability';
COMMENT ON COLUMN insights.paired_process_id IS 'Kernel process that can address this insight (e.g., chase_overdue_invoices)';
COMMENT ON TABLE owner_insight_history IS 'Tracks user interactions with insights for preference learning';
