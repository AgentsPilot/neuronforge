-- Backfill quality scores for existing shared agents
-- This script calculates scores for agents that were shared before the quality score system was implemented

-- Update existing shared agents with calculated scores based on their original agent's metrics
UPDATE shared_agents sa
SET
  -- Calculate reliability score (40% weight)
  reliability_score = COALESCE(
    (
      COALESCE(aim.success_rate, 0) * 0.60 +
      (100 - COALESCE(aim.retry_rate, 0)) * 0.20 +
      LEAST(
        (COALESCE(aim.error_recovery_count, 0)::DECIMAL / NULLIF(aim.failed_executions, 0)::DECIMAL) * 100,
        100
      ) * 0.20
    ) * LEAST(COALESCE(aim.total_executions, 0)::DECIMAL / 20, 1),
    0
  ),

  -- Calculate efficiency score (30% weight)
  efficiency_score = COALESCE(
    GREATEST(0, LEAST(100, 100 - ((COALESCE(aim.avg_tokens_per_run, 2000) - 2000)::DECIMAL / 2000 * 50))) * 0.50 +
    GREATEST(0, LEAST(100, 100 - ((COALESCE(aim.avg_execution_duration_ms, 30000) - 30000)::DECIMAL / 30000 * 50))) * 0.30 +
    CASE
      WHEN COALESCE(aim.unique_plugins_used, 0) > 0 AND COALESCE(aim.avg_plugins_per_run, 0) > 0
      THEN LEAST((aim.unique_plugins_used::DECIMAL / aim.avg_plugins_per_run::DECIMAL) * 100, 100) * 0.20
      ELSE 50 * 0.20
    END,
    0
  ),

  -- Calculate complexity score (10% weight)
  complexity_score = COALESCE(
    LEAST(
      (
        COALESCE(aim.workflow_steps_count, 0) * 10 +
        COALESCE(aim.unique_plugins_used, 0) * 15 +
        CASE WHEN COALESCE(aim.conditional_branches_count, 0) > 0 THEN 20 ELSE 0 END +
        CASE WHEN COALESCE(aim.loop_iterations_count, 0) > 0 THEN 15 ELSE 0 END +
        CASE WHEN COALESCE(aim.parallel_execution_count, 0) > 0 THEN 25 ELSE 0 END
      ),
      100
    ),
    0
  ),

  -- Calculate adoption score (20% weight)
  adoption_score = COALESCE(
    -- Logarithmic import score (70%)
    LEAST(LOG(COALESCE(sa.import_count, 0) + 1) * 25, 100) * 0.70 +
    -- Freshness score (30%)
    GREATEST(0, 100 - (EXTRACT(EPOCH FROM (NOW() - sa.shared_at)) / 86400 / 90 * 100)) * 0.30,
    0
  ),

  -- Store base metrics (snapshot)
  base_executions = COALESCE(aim.total_executions, 0),
  base_success_rate = COALESCE(aim.success_rate, 0),

  -- Mark as calculated
  score_calculated_at = NOW()
FROM agent_intensity_metrics aim
WHERE sa.original_agent_id = aim.agent_id
  AND sa.quality_score IS NULL; -- Only update agents without scores

-- Calculate overall quality score from components
UPDATE shared_agents
SET quality_score = (
  COALESCE(reliability_score, 0) * 0.40 +
  COALESCE(efficiency_score, 0) * 0.30 +
  COALESCE(adoption_score, 0) * 0.20 +
  COALESCE(complexity_score, 0) * 0.10
)
WHERE quality_score IS NULL
  AND score_calculated_at IS NOT NULL;

-- Apply age decay for templates older than 6 months
UPDATE shared_agents
SET quality_score = quality_score * GREATEST(
  0.7,
  1 - (EXTRACT(MONTH FROM AGE(NOW(), shared_at)) - 6) * 0.05
)
WHERE EXTRACT(MONTH FROM AGE(NOW(), shared_at)) > 6
  AND quality_score IS NOT NULL;

-- For agents without intensity metrics, set default scores based on ai_confidence
UPDATE shared_agents
SET
  reliability_score = COALESCE(ai_confidence * 100, 50),
  efficiency_score = COALESCE(ai_confidence * 100, 50),
  complexity_score = COALESCE(ai_confidence * 100, 50),
  adoption_score = COALESCE(
    LEAST(LOG(COALESCE(import_count, 0) + 1) * 25, 100) * 0.70 +
    GREATEST(0, 100 - (EXTRACT(EPOCH FROM (NOW() - shared_at)) / 86400 / 90 * 100)) * 0.30,
    0
  ),
  quality_score = (
    COALESCE(ai_confidence * 100, 50) * 0.80 +
    COALESCE(
      LEAST(LOG(COALESCE(import_count, 0) + 1) * 25, 100) * 0.70 +
      GREATEST(0, 100 - (EXTRACT(EPOCH FROM (NOW() - shared_at)) / 86400 / 90 * 100)) * 0.30,
      0
    ) * 0.20
  ),
  base_executions = 0,
  base_success_rate = 0,
  score_calculated_at = NOW()
WHERE quality_score IS NULL;

-- Show summary of updated records
SELECT
  COUNT(*) as total_shared_agents,
  COUNT(*) FILTER (WHERE quality_score IS NOT NULL) as agents_with_scores,
  ROUND(AVG(quality_score), 2) as avg_quality_score,
  ROUND(MIN(quality_score), 2) as min_quality_score,
  ROUND(MAX(quality_score), 2) as max_quality_score,
  COUNT(*) FILTER (WHERE quality_score >= 70) as high_quality_count,
  COUNT(*) FILTER (WHERE quality_score >= 50 AND quality_score < 70) as good_quality_count,
  COUNT(*) FILTER (WHERE quality_score < 50) as standard_quality_count
FROM shared_agents;
