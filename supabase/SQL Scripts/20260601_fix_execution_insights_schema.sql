-- Fix execution_insights and execution_insight_runs schema issues
-- Created: 2026-06-01
-- Purpose: Align database schema with code expectations after failed commit

-- ============================================================================
-- PART 1: Fix execution_insights table
-- ============================================================================

-- Issue #1: Change execution_ids from text[] to uuid[]
ALTER TABLE public.execution_insights
  ALTER COLUMN execution_ids TYPE uuid[]
  USING execution_ids::uuid[];

-- Issue #2: Migrate to 3-category system (data_insight, business_insight, technical_insight)
-- Step 2a: Update existing data to new category names
UPDATE public.execution_insights SET category = 'data_insight' WHERE category = 'data_quality';
UPDATE public.execution_insights SET category = 'business_insight' WHERE category = 'business_intelligence';

-- Step 2b: Split 'growth' category based on insight_type
-- Technical insights: reliability_risk, performance_degradation, cost_optimization, schedule_optimization
UPDATE public.execution_insights SET category = 'technical_insight'
WHERE category = 'growth' AND insight_type IN (
  'reliability_risk', 'performance_degradation', 'cost_optimization', 'schedule_optimization'
);

-- Business insights: automation_opportunity (rare - mostly LLM generates business insights)
UPDATE public.execution_insights SET category = 'business_insight'
WHERE category = 'growth' AND insight_type NOT IN (
  'reliability_risk', 'performance_degradation', 'cost_optimization', 'schedule_optimization'
);

-- Step 2c: Update constraint to new category names
ALTER TABLE public.execution_insights
  DROP CONSTRAINT IF EXISTS execution_insights_category_check;

ALTER TABLE public.execution_insights
  ADD CONSTRAINT execution_insights_category_check CHECK (
    category = ANY (ARRAY[
      'data_insight'::text,
      'business_insight'::text,
      'technical_insight'::text
    ])
  );

-- Issue #3: Update insight types to align with 3-category system
ALTER TABLE public.execution_insights
  DROP CONSTRAINT IF EXISTS execution_insights_insight_type_check;

ALTER TABLE public.execution_insights
  ADD CONSTRAINT execution_insights_insight_type_check CHECK (
    insight_type = ANY (ARRAY[
      -- Data Insight Types
      'data_unavailable'::text,
      'data_malformed'::text,
      'data_missing_fields'::text,
      'data_type_mismatch'::text,
      'data_validation_failed'::text,
      -- Technical Insight Types
      'reliability_risk'::text,
      'performance_degradation'::text,
      'cost_optimization'::text,
      'schedule_optimization'::text,
      -- Business Insight Types
      'automation_opportunity'::text,
      'volume_trend'::text,
      'category_shift'::text,
      'operational_anomaly'::text,
      'scale_opportunity'::text
    ])
  );

-- Issue #4: Fix confidence column to support numeric values
-- CRITICAL: This fixes the failed commit issue where LLM returns numeric confidence

-- Step 4a: Drop the generated confidence_mode column if it exists (required before altering confidence type)
ALTER TABLE public.execution_insights
  DROP COLUMN IF EXISTS confidence_mode;

-- Step 4b: Drop the restrictive constraint (if it exists)
ALTER TABLE public.execution_insights
  DROP CONSTRAINT IF EXISTS execution_insights_confidence_check;

-- Step 4c: Change column type to numeric with conversion
-- This handles both string enum values and already-numeric values
ALTER TABLE public.execution_insights
  ALTER COLUMN confidence TYPE numeric(4,3)
  USING (
    CASE confidence::text
      WHEN 'observation' THEN 0.15
      WHEN 'early_signals' THEN 0.30
      WHEN 'emerging_patterns' THEN 0.50
      WHEN 'confirmed' THEN 0.80
      ELSE confidence::numeric  -- Already numeric
    END
  );

-- Step 4d: Add constraint for valid range
ALTER TABLE public.execution_insights
  DROP CONSTRAINT IF EXISTS execution_insights_confidence_range_check;

ALTER TABLE public.execution_insights
  ADD CONSTRAINT execution_insights_confidence_range_check
  CHECK (confidence >= 0.0 AND confidence <= 1.0);

-- Step 4e: Add computed column for confidence mode (for queries)
ALTER TABLE public.execution_insights
  ADD COLUMN confidence_mode text GENERATED ALWAYS AS (
    CASE
      WHEN confidence < 0.20 THEN 'observation'
      WHEN confidence < 0.35 THEN 'early_signals'
      WHEN confidence < 0.50 THEN 'emerging_patterns'
      ELSE 'confirmed'
    END
  ) STORED;

-- Add index for confidence queries
CREATE INDEX IF NOT EXISTS idx_execution_insights_confidence
  ON public.execution_insights(confidence_mode, severity);

-- ============================================================================
-- PART 2: Fix execution_insight_runs table
-- ============================================================================

-- Issue #5: Fix foreign key to reference workflow_executions instead of agent_executions
ALTER TABLE public.execution_insight_runs
  DROP CONSTRAINT IF EXISTS execution_insight_runs_execution_id_fkey;

ALTER TABLE public.execution_insight_runs
  ADD CONSTRAINT execution_insight_runs_execution_id_fkey
  FOREIGN KEY (execution_id) REFERENCES workflow_executions (id) ON DELETE SET NULL;

-- Issue #6: Add agent_id column for better querying
ALTER TABLE public.execution_insight_runs
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES agents(id) ON DELETE CASCADE;

-- Backfill agent_id from execution_id
UPDATE public.execution_insight_runs r
SET agent_id = e.agent_id
FROM workflow_executions e
WHERE r.execution_id = e.id
  AND r.agent_id IS NULL;

-- Add index for agent_id queries
CREATE INDEX IF NOT EXISTS idx_execution_insight_runs_agent_id
  ON public.execution_insight_runs(agent_id, created_at DESC);

-- Issue #7: Make insight_id nullable to enable dual-table population pattern
-- CRITICAL FIX: Allows storing per-execution snapshots in execution_insight_runs
-- before (or without) creating a corresponding record in execution_insights.
--
-- Use case:
-- 1. WorkflowPilot stores run snapshot to execution_insight_runs (insight_id = null)
-- 2. WorkflowPilot checks if active insight exists in execution_insights
-- 3. If exists: update it; if not: create new one
-- 4. execution_insight_runs.insight_id can be linked later for queries
--
-- This pattern enables anomaly detection by comparing current run vs historical runs
-- while keeping the two tables independent (execution_insight_runs = time-series,
-- execution_insights = current active state).
ALTER TABLE public.execution_insight_runs
  ALTER COLUMN insight_id DROP NOT NULL;

-- ============================================================================
-- PART 3: Add missing indexes for performance
-- ============================================================================

-- Deduplication queries (findExistingInsight)
CREATE INDEX IF NOT EXISTS idx_execution_insights_dedup
  ON public.execution_insights(agent_id, category, created_at DESC)
  WHERE status IN ('new', 'viewed');

-- Title-based deduplication (findExistingByTitle)
CREATE INDEX IF NOT EXISTS idx_execution_insights_title_dedup
  ON public.execution_insights(agent_id, title, created_at DESC)
  WHERE status IN ('new', 'viewed');

-- Category + severity filtering (common UI query)
CREATE INDEX IF NOT EXISTS idx_execution_insights_category_severity
  ON public.execution_insights(category, severity, created_at DESC);

-- ============================================================================
-- PART 4: Update helper functions for numeric confidence
-- ============================================================================

-- Drop existing function first (fixes: cannot change return type of existing function)
DROP FUNCTION IF EXISTS get_top_insights(INTEGER);

-- Recreate get_top_insights to handle numeric confidence
CREATE FUNCTION get_top_insights(p_limit INTEGER DEFAULT 5)
RETURNS SETOF execution_insights AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM execution_insights
  WHERE user_id = auth.uid()
    AND status IN ('new', 'viewed')
  ORDER BY
    CASE severity
      WHEN 'critical' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 4
    END,
    confidence DESC,  -- Higher confidence first
    created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- PART 5: Add comments for documentation
-- ============================================================================

COMMENT ON COLUMN public.execution_insights.confidence IS
  'Numeric confidence score (0.0-1.0). Lower values = less certain, higher = more confident. LLM-generated insights typically return 0.3-0.9.';

COMMENT ON COLUMN public.execution_insights.confidence_mode IS
  'Computed confidence mode derived from numeric confidence: observation (<0.20), early_signals (<0.35), emerging_patterns (<0.50), confirmed (>=0.50)';

COMMENT ON COLUMN public.execution_insights.execution_ids IS
  'Array of workflow_execution UUIDs that contributed to this insight. One insight can aggregate patterns from multiple runs.';

COMMENT ON COLUMN public.execution_insights.category IS
  'Insight category: data_insight (fix data quality problems), business_insight (understand business operations, growth opportunities), technical_insight (fix system issues: failures, performance, costs, scheduling)';

COMMENT ON COLUMN public.execution_insights.time_saved_hours_per_week IS
  'Estimated weekly time savings from this automation (business value metric)';

COMMENT ON COLUMN public.execution_insights.cost_saved_usd_per_week IS
  'Estimated weekly cost savings in USD (ROI metric)';

COMMENT ON COLUMN public.execution_insights.revenue_at_risk_usd IS
  'Potential revenue loss if this issue is not addressed (for high-severity data quality issues)';

COMMENT ON COLUMN public.execution_insights.automation_potential_percentage IS
  'Percentage of this workflow that could be further automated (0-100)';

-- ============================================================================
-- Verification queries
-- ============================================================================

-- Verify changes (uncomment to run)
-- SELECT
--   column_name,
--   data_type,
--   udt_name
-- FROM information_schema.columns
-- WHERE table_name = 'execution_insights'
--   AND column_name IN ('execution_ids', 'confidence', 'confidence_mode')
-- ORDER BY ordinal_position;

-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'execution_insights'::regclass
--   AND conname LIKE '%confidence%' OR conname LIKE '%category%' OR conname LIKE '%insight_type%';
