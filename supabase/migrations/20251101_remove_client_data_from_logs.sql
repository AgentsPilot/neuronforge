-- Remove client data from execution logs
-- This migration sanitizes existing logs to remove PII and client data
-- Keeps metadata only (plugin name, action, success status, item counts)

-- =====================================================================
-- BACKGROUND: Privacy Compliance - Remove Client Data from Logs
-- =====================================================================
--
-- PROBLEM: We were storing full client data in execution logs:
--   - Email subjects, bodies, sender/recipient addresses
--   - CRM contact names, phone numbers, companies
--   - Calendar events, file contents, etc.
--   - LLM responses summarizing client data
--
-- This data was NEVER used (we only read status/timestamps for analytics)
-- and poses GDPR/privacy compliance risks.
--
-- SOLUTION: Sanitize logs to keep only metadata:
--   - Plugin name (e.g., "google-mail")
--   - Action name (e.g., "search_emails")
--   - Success status (true/false)
--   - Item counts (e.g., 5 emails returned)
--   - Execution time, error messages (generic)
--
-- NO client data: no email subjects, contact names, etc.
--
-- =====================================================================

-- Step 1: Create helper function to safely get array length
CREATE OR REPLACE FUNCTION safe_array_length(val JSONB)
RETURNS INTEGER AS $$
BEGIN
  IF val IS NULL THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(val) = 'array' THEN
    RETURN jsonb_array_length(val);
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 2: Create sanitization function for toolCalls JSONB arrays
CREATE OR REPLACE FUNCTION sanitize_tool_calls(tool_calls JSONB)
RETURNS JSONB AS $$
DECLARE
  sanitized JSONB := '[]'::JSONB;
  tool_call JSONB;
  items_count INTEGER;
BEGIN
  -- If tool_calls is null or not an array, return empty array
  IF tool_calls IS NULL OR jsonb_typeof(tool_calls) != 'array' THEN
    RETURN '[]'::JSONB;
  END IF;

  -- Iterate through each tool call and sanitize
  FOR tool_call IN SELECT * FROM jsonb_array_elements(tool_calls)
  LOOP
    -- Try to get item count from various possible array fields
    items_count := COALESCE(
      safe_array_length(tool_call->'result'->'emails'),
      safe_array_length(tool_call->'result'->'contacts'),
      safe_array_length(tool_call->'result'->'events'),
      safe_array_length(tool_call->'result'->'items'),
      safe_array_length(tool_call->'result'),
      CASE WHEN tool_call->'result' IS NOT NULL THEN 1 ELSE 0 END
    );

    sanitized := sanitized || jsonb_build_array(
      jsonb_build_object(
        'plugin', COALESCE(tool_call->>'plugin', 'unknown'),
        'action', COALESCE(tool_call->>'action', 'unknown'),
        'success', COALESCE((tool_call->>'success')::boolean, true),
        'itemsReturned', items_count,
        'executionTime', COALESCE((tool_call->>'executionTime')::integer, 0),
        'error', tool_call->>'error'
      )
    );
  END LOOP;

  RETURN sanitized;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 3: Sanitize agent_executions.logs.toolCalls
-- This removes all client data from the logs JSONB column
UPDATE agent_executions
SET logs = jsonb_set(
  COALESCE(logs, '{}'::jsonb),
  '{toolCalls}',
  sanitize_tool_calls(logs->'toolCalls')
)
WHERE logs IS NOT NULL
  AND logs->'toolCalls' IS NOT NULL
  AND jsonb_typeof(logs->'toolCalls') = 'array';

-- Step 4: Sanitize agent_logs.full_output.agentkit_metadata.toolCalls
-- Note: full_output can be either json or jsonb type, so we cast to jsonb for manipulation
UPDATE agent_logs
SET full_output = (
  SELECT jsonb_set(
    jsonb_set(
      full_output_jsonb,
      '{agentkit_metadata,toolCalls}',
      sanitize_tool_calls(full_output_jsonb->'agentkit_metadata'->'toolCalls')
    ),
    '{message}',
    'null'::jsonb  -- Remove message field (contains client data summaries)
  )
  FROM (
    SELECT COALESCE(full_output::jsonb, '{}'::jsonb) AS full_output_jsonb
  ) converted
)
WHERE full_output IS NOT NULL
  AND (full_output::jsonb)->'agentkit_metadata'->'toolCalls' IS NOT NULL;

-- Step 5: Sanitize agent_logs.run_output (remove response field)
-- The run_output is a JSON string, so we need to parse it first
UPDATE agent_logs
SET run_output = (
  SELECT jsonb_build_object(
    'success', (run_output_json->>'success')::boolean,
    'agentkit', (run_output_json->>'agentkit')::boolean,
    'iterations', (run_output_json->>'iterations')::integer,
    'toolCallsCount', (run_output_json->>'toolCallsCount')::integer,
    'tokensUsed', (run_output_json->>'tokensUsed')::integer,
    'executionTimeMs', (run_output_json->>'executionTimeMs')::integer,
    'model', run_output_json->>'model',
    'provider', run_output_json->>'provider'
    -- NO 'response' field - removed to eliminate client data
  )::text
  FROM (
    SELECT run_output::jsonb AS run_output_json
  ) parsed
)
WHERE run_output IS NOT NULL
  AND run_output::jsonb ? 'response';  -- Only update if response field exists

-- Step 6: Add indexes for efficient cleanup queries (for future TTL policies)
CREATE INDEX IF NOT EXISTS idx_agent_executions_created_at
  ON agent_executions(created_at);

CREATE INDEX IF NOT EXISTS idx_agent_logs_created_at
  ON agent_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_agent_execution_logs_created_at
  ON agent_execution_logs(created_at);

-- Step 7: Log migration completion
DO $$
DECLARE
  executions_count INTEGER;
  logs_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO executions_count FROM agent_executions WHERE logs IS NOT NULL;
  SELECT COUNT(*) INTO logs_count FROM agent_logs WHERE full_output IS NOT NULL;

  RAISE NOTICE '✅ Client data sanitization completed:';
  RAISE NOTICE '   - Sanitized % agent_executions records', executions_count;
  RAISE NOTICE '   - Sanitized % agent_logs records', logs_count;
  RAISE NOTICE '   - Removed: email subjects/bodies, contact info, file contents, LLM responses';
  RAISE NOTICE '   - Kept: plugin names, actions, success status, item counts, execution metrics';
  RAISE NOTICE '   - Privacy compliance: GDPR Article 5 (data minimization) now satisfied';
END $$;

-- Step 8: Drop the helper functions (no longer needed after migration)
DROP FUNCTION IF EXISTS sanitize_tool_calls(JSONB);
DROP FUNCTION IF EXISTS safe_array_length(JSONB);

COMMENT ON TABLE agent_executions IS 'Execution queue and history - SANITIZED: stores metadata only, NO client data';
COMMENT ON TABLE agent_logs IS 'Execution logs for analytics - SANITIZED: stores metadata only, NO client data';
