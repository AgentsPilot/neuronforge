-- Check what data is available in agent_executions for the latest run
-- This will show us all fields we can potentially display in the UI

SELECT
  id,
  agent_id,
  user_id,
  execution_type,  -- manual, scheduled, api
  run_mode,        -- production, calibration, test
  status,          -- completed, failed, running
  scheduled_at,
  started_at,
  completed_at,
  execution_duration_ms,

  -- Check what's in the logs JSONB field
  logs->'success' as success,
  logs->'pilot' as is_pilot_workflow,
  logs->'workflowExecution' as is_workflow,
  logs->'model' as model_used,
  logs->'provider' as provider_used,
  logs->'executionTime' as execution_time_ms,
  logs->'tokensUsed' as tokens_used,
  logs->'stepsCompleted' as steps_completed,
  logs->'stepsFailed' as steps_failed,
  logs->'stepsSkipped' as steps_skipped,
  logs->'response' as response_message,

  -- Check if metrics are already merged (from API)
  logs->'metrics' as metrics_in_logs,
  logs->'metrics'->'time_saved_seconds' as time_saved_in_logs,
  logs->'metrics'->'total_items' as total_items_in_logs,

  created_at,
  updated_at

FROM agent_executions
WHERE agent_id = '955d35c3-32a3-4fb5-a922-1fb798f4a349'
ORDER BY created_at DESC
LIMIT 1;

-- Also check execution_metrics table
SELECT
  execution_id,
  agent_id,
  executed_at,
  duration_ms,
  total_items,
  time_saved_seconds,
  manual_time_per_item_seconds,
  items_by_field,
  field_names,
  has_empty_results,
  failed_step_count,
  step_metrics
FROM execution_metrics
WHERE agent_id = '955d35c3-32a3-4fb5-a922-1fb798f4a349'
ORDER BY executed_at DESC
LIMIT 1;
