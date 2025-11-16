-- ============================================================================
-- Per-Step AIS Routing Tracking Migration
-- ============================================================================
-- Purpose: Extend workflow_step_executions with routing intelligence
-- Author: AIS System Enhancement
-- Date: 2025-11-15
--
-- Changes:
-- 1. Add routing decision columns to workflow_step_executions
-- 2. Add complexity analysis columns (6 factors + 4 AIS dimensions)
-- 3. Add indexes for performance analysis queries
-- 4. Backward compatible - all new columns are nullable
-- ============================================================================

-- ============================================================================
-- STEP 1: Add Complexity Analysis Columns (6 RoutingService Factors)
-- ============================================================================

ALTER TABLE workflow_step_executions
  ADD COLUMN IF NOT EXISTS complexity_score DECIMAL(4,2),  -- Overall 0-10 score
  ADD COLUMN IF NOT EXISTS prompt_length_score DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS data_size_score DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS condition_count_score DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS context_depth_score DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS reasoning_depth_score DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS output_complexity_score DECIMAL(4,2);

COMMENT ON COLUMN workflow_step_executions.complexity_score IS 'Overall step complexity (0-10) calculated by RoutingService';
COMMENT ON COLUMN workflow_step_executions.prompt_length_score IS 'Prompt length factor (0-10)';
COMMENT ON COLUMN workflow_step_executions.data_size_score IS 'Data size factor (0-10)';
COMMENT ON COLUMN workflow_step_executions.condition_count_score IS 'Conditional branching factor (0-10)';
COMMENT ON COLUMN workflow_step_executions.context_depth_score IS 'Variable reference depth factor (0-10)';
COMMENT ON COLUMN workflow_step_executions.reasoning_depth_score IS 'Estimated reasoning complexity (0-10)';
COMMENT ON COLUMN workflow_step_executions.output_complexity_score IS 'Estimated output complexity (0-10)';

-- ============================================================================
-- STEP 2: Add AIS-Mapped Dimensions (for consistency with agent-level AIS)
-- ============================================================================

ALTER TABLE workflow_step_executions
  ADD COLUMN IF NOT EXISTS ais_token_complexity DECIMAL(4,2),      -- (prompt + data) / 2
  ADD COLUMN IF NOT EXISTS ais_execution_complexity DECIMAL(4,2),  -- (reasoning + output) / 2
  ADD COLUMN IF NOT EXISTS ais_workflow_complexity DECIMAL(4,2),   -- condition_count
  ADD COLUMN IF NOT EXISTS ais_memory_complexity DECIMAL(4,2);     -- context_depth

COMMENT ON COLUMN workflow_step_executions.ais_token_complexity IS 'AIS dimension: Token complexity mapped from prompt + data';
COMMENT ON COLUMN workflow_step_executions.ais_execution_complexity IS 'AIS dimension: Execution complexity mapped from reasoning + output';
COMMENT ON COLUMN workflow_step_executions.ais_workflow_complexity IS 'AIS dimension: Workflow complexity from conditionals';
COMMENT ON COLUMN workflow_step_executions.ais_memory_complexity IS 'AIS dimension: Memory complexity from context depth';

-- ============================================================================
-- STEP 3: Add Routing Decision Columns
-- ============================================================================

ALTER TABLE workflow_step_executions
  ADD COLUMN IF NOT EXISTS agent_ais_score DECIMAL(4,2),           -- From agent_intensity_metrics.combined_score
  ADD COLUMN IF NOT EXISTS effective_complexity DECIMAL(4,2),      -- (agent_ais * 0.6) + (step * 0.4)
  ADD COLUMN IF NOT EXISTS selected_tier TEXT,                     -- fast/balanced/powerful
  ADD COLUMN IF NOT EXISTS selected_model TEXT,                    -- e.g., claude-3-haiku-20240307
  ADD COLUMN IF NOT EXISTS selected_provider TEXT,                 -- e.g., anthropic
  ADD COLUMN IF NOT EXISTS routing_reason TEXT,                    -- Human-readable explanation
  ADD COLUMN IF NOT EXISTS estimated_cost_usd DECIMAL(10,6),       -- Pre-execution cost estimate
  ADD COLUMN IF NOT EXISTS estimated_latency_ms INTEGER;           -- Pre-execution latency estimate

COMMENT ON COLUMN workflow_step_executions.agent_ais_score IS 'Agent-level AIS combined score at routing time';
COMMENT ON COLUMN workflow_step_executions.effective_complexity IS 'Effective complexity: weighted avg of agent + step';
COMMENT ON COLUMN workflow_step_executions.selected_tier IS 'Routing tier: fast/balanced/powerful';
COMMENT ON COLUMN workflow_step_executions.selected_model IS 'Model selected by routing decision';
COMMENT ON COLUMN workflow_step_executions.selected_provider IS 'Provider selected by routing decision';
COMMENT ON COLUMN workflow_step_executions.routing_reason IS 'Human-readable routing explanation';
COMMENT ON COLUMN workflow_step_executions.estimated_cost_usd IS 'Estimated cost before execution';
COMMENT ON COLUMN workflow_step_executions.estimated_latency_ms IS 'Estimated latency before execution';

-- ============================================================================
-- STEP 4: Add Raw Measurements (for debugging/analysis)
-- ============================================================================

ALTER TABLE workflow_step_executions
  ADD COLUMN IF NOT EXISTS raw_prompt_length INTEGER,              -- Characters in prompt
  ADD COLUMN IF NOT EXISTS raw_data_size INTEGER,                  -- Bytes of data
  ADD COLUMN IF NOT EXISTS raw_condition_count INTEGER,            -- Number of conditions
  ADD COLUMN IF NOT EXISTS raw_context_depth INTEGER;              -- Number of variable refs

COMMENT ON COLUMN workflow_step_executions.raw_prompt_length IS 'Raw measurement: prompt length in characters';
COMMENT ON COLUMN workflow_step_executions.raw_data_size IS 'Raw measurement: data size in bytes';
COMMENT ON COLUMN workflow_step_executions.raw_condition_count IS 'Raw measurement: number of conditions';
COMMENT ON COLUMN workflow_step_executions.raw_context_depth IS 'Raw measurement: number of variable references';

-- ============================================================================
-- STEP 5: Add Routing Timestamp
-- ============================================================================

ALTER TABLE workflow_step_executions
  ADD COLUMN IF NOT EXISTS routed_at TIMESTAMPTZ;

COMMENT ON COLUMN workflow_step_executions.routed_at IS 'Timestamp when routing decision was made';

-- ============================================================================
-- STEP 6: Create Indexes for Analysis Queries
-- ============================================================================

-- Query: Find all steps routed to powerful tier
CREATE INDEX IF NOT EXISTS idx_step_routing_tier
  ON workflow_step_executions(selected_tier)
  WHERE selected_tier IS NOT NULL;

-- Query: Analyze complexity distribution
CREATE INDEX IF NOT EXISTS idx_step_complexity
  ON workflow_step_executions(complexity_score)
  WHERE complexity_score IS NOT NULL;

-- Query: Compare estimated vs actual cost
-- Note: tokens_used is stored in execution_metadata JSONB
CREATE INDEX IF NOT EXISTS idx_step_cost_comparison
  ON workflow_step_executions(estimated_cost_usd, ((execution_metadata->>'tokens_used')::INTEGER))
  WHERE estimated_cost_usd IS NOT NULL;

-- Query: Model performance analysis
-- Note: execution time is stored in execution_metadata, not as a separate column
CREATE INDEX IF NOT EXISTS idx_step_model_performance
  ON workflow_step_executions(selected_model, status)
  WHERE selected_model IS NOT NULL;

-- Query: Effective complexity analysis
CREATE INDEX IF NOT EXISTS idx_step_effective_complexity
  ON workflow_step_executions(effective_complexity, status)
  WHERE effective_complexity IS NOT NULL;

-- ============================================================================
-- STEP 7: Add Configuration Flag (Feature Toggle)
-- ============================================================================

INSERT INTO system_settings_config (key, value, category, description)
VALUES (
  'orchestration_per_step_tracking_enabled',
  'true'::jsonb,
  'orchestration',
  'Enable per-step routing tracking and complexity analysis'
) ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- VERIFICATION QUERIES (Run these to verify migration)
-- ============================================================================

-- Check new columns exist
DO $$
DECLARE
  missing_columns TEXT[];
BEGIN
  SELECT array_agg(column_name)
  INTO missing_columns
  FROM (
    SELECT 'complexity_score' AS column_name
    UNION ALL SELECT 'ais_token_complexity'
    UNION ALL SELECT 'selected_tier'
    UNION ALL SELECT 'routing_reason'
    UNION ALL SELECT 'routed_at'
  ) expected
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'workflow_step_executions'
    AND column_name = expected.column_name
  );

  IF array_length(missing_columns, 1) > 0 THEN
    RAISE EXCEPTION 'Migration incomplete. Missing columns: %', array_to_string(missing_columns, ', ');
  ELSE
    RAISE NOTICE '✅ All routing tracking columns created successfully';
  END IF;
END $$;

-- Check indexes exist
DO $$
DECLARE
  missing_indexes TEXT[];
BEGIN
  SELECT array_agg(index_name)
  INTO missing_indexes
  FROM (
    SELECT 'idx_step_routing_tier' AS index_name
    UNION ALL SELECT 'idx_step_complexity'
    UNION ALL SELECT 'idx_step_effective_complexity'
  ) expected
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE tablename = 'workflow_step_executions'
    AND indexname = expected.index_name
  );

  IF array_length(missing_indexes, 1) > 0 THEN
    RAISE NOTICE '⚠️  Some indexes missing: %', array_to_string(missing_indexes, ', ');
  ELSE
    RAISE NOTICE '✅ All routing indexes created successfully';
  END IF;
END $$;

-- ============================================================================
-- ROLLBACK SCRIPT (Save this for emergencies)
-- ============================================================================
/*
-- To rollback this migration, run:

ALTER TABLE workflow_step_executions
  DROP COLUMN IF EXISTS complexity_score,
  DROP COLUMN IF EXISTS prompt_length_score,
  DROP COLUMN IF EXISTS data_size_score,
  DROP COLUMN IF EXISTS condition_count_score,
  DROP COLUMN IF EXISTS context_depth_score,
  DROP COLUMN IF EXISTS reasoning_depth_score,
  DROP COLUMN IF EXISTS output_complexity_score,
  DROP COLUMN IF EXISTS ais_token_complexity,
  DROP COLUMN IF EXISTS ais_execution_complexity,
  DROP COLUMN IF EXISTS ais_workflow_complexity,
  DROP COLUMN IF EXISTS ais_memory_complexity,
  DROP COLUMN IF EXISTS agent_ais_score,
  DROP COLUMN IF EXISTS effective_complexity,
  DROP COLUMN IF EXISTS selected_tier,
  DROP COLUMN IF EXISTS selected_model,
  DROP COLUMN IF EXISTS selected_provider,
  DROP COLUMN IF EXISTS routing_reason,
  DROP COLUMN IF EXISTS estimated_cost_usd,
  DROP COLUMN IF EXISTS estimated_latency_ms,
  DROP COLUMN IF EXISTS raw_prompt_length,
  DROP COLUMN IF EXISTS raw_data_size,
  DROP COLUMN IF EXISTS raw_condition_count,
  DROP COLUMN IF EXISTS raw_context_depth,
  DROP COLUMN IF EXISTS routed_at;

DROP INDEX IF EXISTS idx_step_routing_tier;
DROP INDEX IF EXISTS idx_step_complexity;
DROP INDEX IF EXISTS idx_step_cost_comparison;
DROP INDEX IF EXISTS idx_step_model_performance;
DROP INDEX IF EXISTS idx_step_effective_complexity;

DELETE FROM system_settings_config WHERE key = 'orchestration_per_step_tracking_enabled';
*/
