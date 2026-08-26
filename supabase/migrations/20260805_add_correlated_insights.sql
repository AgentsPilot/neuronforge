-- Correlated Insights & Business Health Summary
-- Transforms individual detector signals into unified, story-driven insights
-- Creates the "WOW" factor by showing how issues are interconnected

-- ============================================
-- 1. Add correlation fields to insights table
-- ============================================

-- Mark insights as part of a correlation pattern
ALTER TABLE insights ADD COLUMN IF NOT EXISTS is_correlated BOOLEAN DEFAULT false;

-- Link to the parent correlated insight
ALTER TABLE insights ADD COLUMN IF NOT EXISTS correlation_parent_id UUID REFERENCES insights(id) ON DELETE SET NULL;

-- The pattern that matched (e.g., 'revenue_at_risk', 'pipeline_stall')
ALTER TABLE insights ADD COLUMN IF NOT EXISTS correlation_pattern_id TEXT;

-- IDs of contributing child insights (for correlated parent insights)
ALTER TABLE insights ADD COLUMN IF NOT EXISTS contributing_insight_ids UUID[];

-- Total combined impact across all correlated signals
ALTER TABLE insights ADD COLUMN IF NOT EXISTS total_correlated_impact_usd DECIMAL(10, 2);

-- The unified story text (LLM-generated narrative)
ALTER TABLE insights ADD COLUMN IF NOT EXISTS story TEXT;

-- Week-over-week trend for context
ALTER TABLE insights ADD COLUMN IF NOT EXISTS trend_direction TEXT CHECK (trend_direction IN ('improving', 'stable', 'worsening'));
ALTER TABLE insights ADD COLUMN IF NOT EXISTS trend_percent_change DECIMAL(8, 4);
ALTER TABLE insights ADD COLUMN IF NOT EXISTS previous_week_value DECIMAL(15, 4);

-- Language for localized content
ALTER TABLE insights ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';

-- Index for finding correlated insights
CREATE INDEX IF NOT EXISTS idx_insights_correlated ON insights(user_id, is_correlated, created_at DESC) WHERE is_correlated = true;
CREATE INDEX IF NOT EXISTS idx_insights_correlation_parent ON insights(correlation_parent_id) WHERE correlation_parent_id IS NOT NULL;

-- ============================================
-- 2. Business Health Summary Table
-- ============================================

CREATE TABLE IF NOT EXISTS business_health_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Time period
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  period_type TEXT NOT NULL DEFAULT 'weekly' CHECK (period_type IN ('daily', 'weekly', 'monthly')),

  -- Overall health score (0-100)
  health_score INTEGER NOT NULL CHECK (health_score >= 0 AND health_score <= 100),
  previous_health_score INTEGER CHECK (previous_health_score >= 0 AND previous_health_score <= 100),
  score_change INTEGER, -- Difference from previous period

  -- Category breakdown scores (0-100 each)
  acquisition_score INTEGER DEFAULT 50,
  conversion_score INTEGER DEFAULT 50,
  sales_score INTEGER DEFAULT 50,
  cash_flow_score INTEGER DEFAULT 50,
  retention_score INTEGER DEFAULT 50,
  operations_score INTEGER DEFAULT 50,
  pricing_score INTEGER DEFAULT 50,

  -- Executive summary (LLM-generated narrative)
  summary_title TEXT NOT NULL, -- e.g., "Your business is growing but cash flow needs attention"
  summary_narrative TEXT NOT NULL, -- Full paragraph explanation
  summary_language TEXT DEFAULT 'en',

  -- Key highlights (top 3 things to know)
  highlights JSONB DEFAULT '[]', -- Array of {type: 'positive'|'negative'|'neutral', text: '...'}

  -- Top priorities (what to focus on)
  priorities JSONB DEFAULT '[]', -- Array of {rank: 1, category: '...', title: '...', insight_id: '...'}

  -- Linked insights for this period
  insight_count INTEGER DEFAULT 0,
  critical_count INTEGER DEFAULT 0,
  high_count INTEGER DEFAULT 0,
  total_impact_usd DECIMAL(10, 2) DEFAULT 0,

  -- Detection run reference
  detection_run_id UUID,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Only one summary per user per period
CREATE UNIQUE INDEX idx_business_health_user_period
ON business_health_summaries(user_id, period_type, period_start);

-- Performance indexes
CREATE INDEX idx_business_health_user_recent
ON business_health_summaries(user_id, period_type, created_at DESC);

-- RLS policies
ALTER TABLE business_health_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own health summaries"
  ON business_health_summaries
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role has full access to health summaries"
  ON business_health_summaries
  FOR ALL
  USING (auth.role() = 'service_role');

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_business_health_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER business_health_summaries_updated_at
  BEFORE UPDATE ON business_health_summaries
  FOR EACH ROW
  EXECUTE FUNCTION update_business_health_updated_at();

-- ============================================
-- Comments
-- ============================================

COMMENT ON COLUMN insights.is_correlated IS 'True if this insight is a unified correlated insight combining multiple signals';
COMMENT ON COLUMN insights.correlation_parent_id IS 'For child insights, links to the parent correlated insight';
COMMENT ON COLUMN insights.correlation_pattern_id IS 'Pattern that matched (e.g., revenue_at_risk, pipeline_stall)';
COMMENT ON COLUMN insights.story IS 'LLM-generated narrative that tells the business story';
COMMENT ON COLUMN insights.trend_direction IS 'Week-over-week trend: improving, stable, or worsening';

COMMENT ON TABLE business_health_summaries IS 'Executive-level business health summary with scores and narrative';
COMMENT ON COLUMN business_health_summaries.health_score IS 'Overall business health 0-100, calculated from category scores';
COMMENT ON COLUMN business_health_summaries.summary_narrative IS 'LLM-generated paragraph explaining business health state';
