-- Populate shared_agents table with realistic mockup quality scores
-- This script demonstrates the quality scoring system with varied score profiles

-- Script demonstrates 3 quality tiers:
-- 1. High Quality (70-100): Popular, reliable, efficient agents
-- 2. Good Quality (50-69): Solid agents with room for improvement
-- 3. Standard (0-49): New or basic agents

-- Example 1: High Quality Template - Popular Email Summarizer
-- Reliability: 92% (high success rate, low retries)
-- Efficiency: 78% (good token/time usage)
-- Adoption: 85% (43 imports, recently shared)
-- Complexity: 45% (moderate workflow)
UPDATE shared_agents
SET
  -- Reliability Score (40% weight) - 92/100
  reliability_score = 92.0,
  base_executions = 45,
  base_success_rate = 95.0,

  -- Efficiency Score (30% weight) - 78/100
  efficiency_score = 78.0,

  -- Adoption Score (20% weight) - 85/100
  -- Based on: 43 imports (excellent), shared recently
  adoption_score = 85.0,

  -- Complexity Score (10% weight) - 45/100
  -- 3 workflow steps, 2 plugins, no conditionals/loops
  complexity_score = 45.0,

  -- Overall Quality Score (weighted average)
  -- = (92 * 0.40) + (78 * 0.30) + (85 * 0.20) + (45 * 0.10)
  -- = 36.8 + 23.4 + 17.0 + 4.5 = 81.7
  quality_score = 81.70,

  -- Update metadata
  score_calculated_at = NOW(),
  import_count = 43,
  updated_at = NOW()
WHERE original_agent_id = 'f9bd640d-a637-49a4-b5f4-6a35fc733b0f'
  AND user_id = '08456106-aa50-4810-b12c-7ca84102da31';

-- Example 2: Create additional mockup templates with varied scores
-- (This would be for other shared agents if they exist)

-- High Quality Template Profile (Score: 75-90)
-- - High reliability (85-95%)
-- - Good efficiency (70-85%)
-- - Strong adoption (15+ imports)
-- - Moderate complexity (40-60%)
UPDATE shared_agents
SET
  reliability_score = CASE
    WHEN quality_score = 0 AND import_count >= 15 THEN 88.0 + (RANDOM() * 7)
    ELSE reliability_score
  END,
  efficiency_score = CASE
    WHEN quality_score = 0 AND import_count >= 15 THEN 72.0 + (RANDOM() * 13)
    ELSE efficiency_score
  END,
  adoption_score = CASE
    WHEN quality_score = 0 AND import_count >= 15 THEN 70.0 + (RANDOM() * 20)
    ELSE adoption_score
  END,
  complexity_score = CASE
    WHEN quality_score = 0 AND import_count >= 15 THEN 40.0 + (RANDOM() * 20)
    ELSE complexity_score
  END,
  base_executions = CASE
    WHEN quality_score = 0 AND import_count >= 15 THEN 30 + FLOOR(RANDOM() * 30)::INTEGER
    ELSE base_executions
  END,
  base_success_rate = CASE
    WHEN quality_score = 0 AND import_count >= 15 THEN 85.0 + (RANDOM() * 10)
    ELSE base_success_rate
  END,
  score_calculated_at = NOW(),
  updated_at = NOW()
WHERE quality_score = 0
  AND import_count >= 15;

-- Calculate overall quality score for high quality templates
UPDATE shared_agents
SET quality_score = (
  COALESCE(reliability_score, 0) * 0.40 +
  COALESCE(efficiency_score, 0) * 0.30 +
  COALESCE(adoption_score, 0) * 0.20 +
  COALESCE(complexity_score, 0) * 0.10
)
WHERE quality_score = 0
  AND import_count >= 15
  AND reliability_score IS NOT NULL;

-- Good Quality Template Profile (Score: 55-74)
-- - Decent reliability (70-84%)
-- - Fair efficiency (60-75%)
-- - Moderate adoption (5-14 imports)
-- - Variable complexity (30-50%)
UPDATE shared_agents
SET
  reliability_score = CASE
    WHEN quality_score = 0 AND import_count >= 5 AND import_count < 15 THEN 72.0 + (RANDOM() * 12)
    ELSE reliability_score
  END,
  efficiency_score = CASE
    WHEN quality_score = 0 AND import_count >= 5 AND import_count < 15 THEN 62.0 + (RANDOM() * 13)
    ELSE efficiency_score
  END,
  adoption_score = CASE
    WHEN quality_score = 0 AND import_count >= 5 AND import_count < 15 THEN 45.0 + (RANDOM() * 25)
    ELSE adoption_score
  END,
  complexity_score = CASE
    WHEN quality_score = 0 AND import_count >= 5 AND import_count < 15 THEN 30.0 + (RANDOM() * 20)
    ELSE complexity_score
  END,
  base_executions = CASE
    WHEN quality_score = 0 AND import_count >= 5 AND import_count < 15 THEN 15 + FLOOR(RANDOM() * 25)::INTEGER
    ELSE base_executions
  END,
  base_success_rate = CASE
    WHEN quality_score = 0 AND import_count >= 5 AND import_count < 15 THEN 70.0 + (RANDOM() * 14)
    ELSE base_success_rate
  END,
  score_calculated_at = NOW(),
  updated_at = NOW()
WHERE quality_score = 0
  AND import_count >= 5
  AND import_count < 15;

-- Calculate overall quality score for good quality templates
UPDATE shared_agents
SET quality_score = (
  COALESCE(reliability_score, 0) * 0.40 +
  COALESCE(efficiency_score, 0) * 0.30 +
  COALESCE(adoption_score, 0) * 0.20 +
  COALESCE(complexity_score, 0) * 0.10
)
WHERE quality_score = 0
  AND import_count >= 5
  AND import_count < 15
  AND reliability_score IS NOT NULL;

-- Standard Quality Template Profile (Score: 30-54)
-- - Basic reliability (60-75%)
-- - Lower efficiency (50-65%)
-- - Low adoption (0-4 imports)
-- - Simple complexity (20-40%)
UPDATE shared_agents
SET
  reliability_score = CASE
    WHEN quality_score = 0 AND import_count < 5 THEN 60.0 + (RANDOM() * 15)
    ELSE reliability_score
  END,
  efficiency_score = CASE
    WHEN quality_score = 0 AND import_count < 5 THEN 52.0 + (RANDOM() * 13)
    ELSE efficiency_score
  END,
  adoption_score = CASE
    WHEN quality_score = 0 AND import_count < 5 THEN 15.0 + (RANDOM() * 30)
    ELSE adoption_score
  END,
  complexity_score = CASE
    WHEN quality_score = 0 AND import_count < 5 THEN 20.0 + (RANDOM() * 20)
    ELSE complexity_score
  END,
  base_executions = CASE
    WHEN quality_score = 0 AND import_count < 5 THEN 5 + FLOOR(RANDOM() * 15)::INTEGER
    ELSE base_executions
  END,
  base_success_rate = CASE
    WHEN quality_score = 0 AND import_count < 5 THEN 60.0 + (RANDOM() * 15)
    ELSE base_success_rate
  END,
  score_calculated_at = NOW(),
  updated_at = NOW()
WHERE quality_score = 0
  AND import_count < 5;

-- Calculate overall quality score for standard templates
UPDATE shared_agents
SET quality_score = (
  COALESCE(reliability_score, 0) * 0.40 +
  COALESCE(efficiency_score, 0) * 0.30 +
  COALESCE(adoption_score, 0) * 0.20 +
  COALESCE(complexity_score, 0) * 0.10
)
WHERE quality_score = 0
  AND import_count < 5
  AND reliability_score IS NOT NULL;

-- Display summary of updated templates
SELECT
  'Quality Score Distribution' as summary_type,
  COUNT(*) as total_templates,
  COUNT(*) FILTER (WHERE quality_score >= 70) as high_quality,
  COUNT(*) FILTER (WHERE quality_score >= 50 AND quality_score < 70) as good_quality,
  COUNT(*) FILTER (WHERE quality_score < 50) as standard_quality,
  ROUND(AVG(quality_score), 2) as avg_quality_score,
  ROUND(MIN(quality_score), 2) as min_quality_score,
  ROUND(MAX(quality_score), 2) as max_quality_score
FROM shared_agents
WHERE quality_score > 0;

-- Display component score breakdown
SELECT
  'Component Score Averages' as summary_type,
  ROUND(AVG(reliability_score), 2) as avg_reliability,
  ROUND(AVG(efficiency_score), 2) as avg_efficiency,
  ROUND(AVG(adoption_score), 2) as avg_adoption,
  ROUND(AVG(complexity_score), 2) as avg_complexity
FROM shared_agents
WHERE quality_score > 0;

-- Show top 10 templates by quality score
SELECT
  LEFT(COALESCE(agent_name, 'Unnamed Agent'), 40) as agent_name,
  import_count,
  ROUND(quality_score, 1) as quality,
  ROUND(reliability_score, 1) as reliability,
  ROUND(efficiency_score, 1) as efficiency,
  ROUND(adoption_score, 1) as adoption,
  ROUND(complexity_score, 1) as complexity,
  base_executions as executions,
  ROUND(base_success_rate, 1) as success_rate
FROM shared_agents
WHERE quality_score > 0
ORDER BY quality_score DESC
LIMIT 10;

-- Verification: Show the specific Email Summary Agent record
SELECT
  agent_name,
  import_count,
  ROUND(quality_score, 2) as quality,
  ROUND(reliability_score, 2) as reliability,
  ROUND(efficiency_score, 2) as efficiency,
  ROUND(adoption_score, 2) as adoption,
  ROUND(complexity_score, 2) as complexity,
  base_executions,
  ROUND(base_success_rate, 2) as success_rate,
  score_calculated_at
FROM shared_agents
WHERE original_agent_id = 'f9bd640d-a637-49a4-b5f4-6a35fc733b0f';
