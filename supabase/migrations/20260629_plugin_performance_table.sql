-- Plugin Performance Tracking Table
-- Phase 2 of Memory System Enhancement: Personalization
--
-- Purpose: Track per-agent plugin execution metrics for
-- anomaly detection and optimization suggestions.

CREATE TABLE IF NOT EXISTS plugin_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  plugin TEXT NOT NULL,
  action TEXT NOT NULL,
  time_window TEXT DEFAULT '30d',  -- renamed from 'window' (reserved keyword)
  execution_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  avg_duration_ms DECIMAL NOT NULL DEFAULT 0,
  avg_tokens DECIMAL NOT NULL DEFAULT 0,
  error_breakdown JSONB DEFAULT '{}',
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(agent_id, plugin, action, time_window)
);

-- Index for agent queries
CREATE INDEX IF NOT EXISTS idx_plugin_performance_agent
ON plugin_performance(agent_id, plugin);

-- Index for user-wide aggregation
CREATE INDEX IF NOT EXISTS idx_plugin_performance_user
ON plugin_performance(user_id, plugin, action);

-- Index for finding error-prone plugins
CREATE INDEX IF NOT EXISTS idx_plugin_performance_errors
ON plugin_performance(user_id, execution_count DESC)
WHERE execution_count >= 10;

-- RLS Policy
ALTER TABLE plugin_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY plugin_performance_user_isolation ON plugin_performance
  FOR ALL
  USING (user_id = auth.uid());

-- Service role bypass for background jobs
CREATE POLICY plugin_performance_service_role ON plugin_performance
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Comments
COMMENT ON TABLE plugin_performance IS 'Per-agent plugin execution metrics for anomaly detection';
COMMENT ON COLUMN plugin_performance.time_window IS 'Time window for metrics (default: 30d rolling)';
COMMENT ON COLUMN plugin_performance.avg_duration_ms IS 'Running average of execution duration';
COMMENT ON COLUMN plugin_performance.avg_tokens IS 'Running average of tokens consumed';
COMMENT ON COLUMN plugin_performance.error_breakdown IS 'Count of errors by error code (e.g., {"429": 5, "503": 2})';

-- Atomic upsert function for recording executions
CREATE OR REPLACE FUNCTION upsert_plugin_performance(
  p_agent_id UUID,
  p_user_id UUID,
  p_plugin TEXT,
  p_action TEXT,
  p_success BOOLEAN,
  p_duration_ms DECIMAL,
  p_tokens DECIMAL DEFAULT 0,
  p_error_code TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
  v_existing RECORD;
  v_new_count INTEGER;
  v_new_avg_duration DECIMAL;
  v_new_avg_tokens DECIMAL;
  v_error_breakdown JSONB;
BEGIN
  -- Try to get existing record
  SELECT id, execution_count, avg_duration_ms, avg_tokens, error_breakdown
  INTO v_existing
  FROM plugin_performance
  WHERE agent_id = p_agent_id
    AND plugin = p_plugin
    AND action = p_action
    AND time_window = '30d'
  FOR UPDATE;

  IF FOUND THEN
    -- Update existing record with running averages
    v_new_count := v_existing.execution_count + 1;
    v_new_avg_duration := (v_existing.avg_duration_ms * v_existing.execution_count + p_duration_ms) / v_new_count;
    v_new_avg_tokens := (v_existing.avg_tokens * v_existing.execution_count + p_tokens) / v_new_count;

    -- Update error breakdown if error occurred
    v_error_breakdown := COALESCE(v_existing.error_breakdown, '{}'::JSONB);
    IF p_error_code IS NOT NULL THEN
      v_error_breakdown := jsonb_set(
        v_error_breakdown,
        ARRAY[p_error_code],
        to_jsonb(COALESCE((v_error_breakdown->>p_error_code)::INTEGER, 0) + 1)
      );
    END IF;

    UPDATE plugin_performance
    SET
      execution_count = v_new_count,
      success_count = success_count + CASE WHEN p_success THEN 1 ELSE 0 END,
      avg_duration_ms = v_new_avg_duration,
      avg_tokens = v_new_avg_tokens,
      error_breakdown = v_error_breakdown,
      last_updated = NOW()
    WHERE id = v_existing.id
    RETURNING id INTO v_id;
  ELSE
    -- Insert new record
    v_error_breakdown := '{}'::JSONB;
    IF p_error_code IS NOT NULL THEN
      v_error_breakdown := jsonb_build_object(p_error_code, 1);
    END IF;

    INSERT INTO plugin_performance (
      agent_id, user_id, plugin, action, time_window,
      execution_count, success_count, avg_duration_ms, avg_tokens, error_breakdown
    )
    VALUES (
      p_agent_id, p_user_id, p_plugin, p_action, '30d',
      1, CASE WHEN p_success THEN 1 ELSE 0 END, p_duration_ms, p_tokens, v_error_breakdown
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
