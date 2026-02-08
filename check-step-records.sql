-- Query to check step execution records for a specific execution
-- Replace EXECUTION_ID with your actual execution ID

SELECT
  step_id,
  step_name,
  status,
  started_at,
  completed_at,
  failed_at,
  error_message
FROM workflow_step_executions
WHERE workflow_execution_id = 'EXECUTION_ID'
ORDER BY created_at ASC;

-- Also check the execution record
SELECT
  id,
  status,
  current_step,
  completed_steps_count,
  failed_steps_count,
  total_steps
FROM workflow_executions
WHERE id = 'EXECUTION_ID';
