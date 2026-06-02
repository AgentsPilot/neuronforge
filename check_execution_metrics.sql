-- Check latest execution metrics for agent 955d35c3-32a3-4fb5-a922-1fb798f4a349
-- This will show us what values are actually stored and when they were created

-- 1. Show agent configuration
SELECT
  id,
  agent_name,
  manual_time_per_item_seconds,
  agent_config->'roi_estimate' as roi_estimate,
  updated_at as config_last_updated
FROM agents
WHERE id = '955d35c3-32a3-4fb5-a922-1fb798f4a349';

-- 2. Show latest executions with their metrics
SELECT
  ae.id as execution_id,
  ae.created_at as execution_time,
  ae.status,
  em.total_items,
  em.time_saved_seconds,
  em.manual_time_per_item_seconds,
  em.executed_at as metrics_calculated_at,
  -- Calculate what the value would be at $100/hour
  CASE
    WHEN em.time_saved_seconds IS NOT NULL
    THEN ROUND((em.time_saved_seconds / 3600.0 * 100)::numeric, 2)
    ELSE NULL
  END as value_saved_usd
FROM agent_executions ae
LEFT JOIN execution_metrics em ON em.execution_id = ae.id
WHERE ae.agent_id = '955d35c3-32a3-4fb5-a922-1fb798f4a349'
ORDER BY ae.created_at DESC
LIMIT 5;

-- 3. Show what the API would return (simulating the logs.metrics merge)
SELECT
  ae.id,
  ae.created_at,
  ae.logs->'metrics' as logs_metrics_before,
  jsonb_build_object(
    'total_items', em.total_items,
    'time_saved_seconds', em.time_saved_seconds,
    'manual_time_per_item_seconds', em.manual_time_per_item_seconds
  ) as execution_metrics_data,
  -- This is what should appear in execution.logs.metrics after API merge
  ae.logs || jsonb_build_object(
    'metrics',
    COALESCE(ae.logs->'metrics', '{}'::jsonb) || jsonb_build_object(
      'total_items', em.total_items,
      'time_saved_seconds', em.time_saved_seconds,
      'manual_time_per_item_seconds', em.manual_time_per_item_seconds
    )
  ) as merged_logs
FROM agent_executions ae
LEFT JOIN execution_metrics em ON em.execution_id = ae.id
WHERE ae.agent_id = '955d35c3-32a3-4fb5-a922-1fb798f4a349'
ORDER BY ae.created_at DESC
LIMIT 1;
