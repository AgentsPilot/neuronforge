-- Platform Learning Tables
-- Phase 3 of Memory System Enhancement: Platform Learning
--
-- Purpose: Extract anonymized patterns from successful workflows
-- and detect platform-wide failure spikes for early warning.
--
-- PRIVACY: These tables store structural patterns only, NO user data or PII.

-- ============================================================
-- Workflow Pattern Library (Privacy-Preserving)
-- ============================================================

CREATE TABLE IF NOT EXISTS workflow_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_hash TEXT UNIQUE NOT NULL,           -- SHA256 of plugin_sequence for deduplication
  plugin_sequence TEXT[] NOT NULL,              -- e.g., ["gmail", "google-sheets", "slack"]
  trigger_type TEXT,                            -- "schedule", "webhook", "manual"
  step_count INTEGER NOT NULL,
  category TEXT,                                -- "crm", "notification", "data-sync", "reporting"

  -- Aggregate metrics (no user identification)
  popularity INTEGER DEFAULT 1,                 -- How many users have this pattern
  total_executions INTEGER DEFAULT 0,
  successful_executions INTEGER DEFAULT 0,
  avg_success_rate DECIMAL(5,4),
  avg_execution_time_ms DECIMAL,
  avg_token_usage DECIMAL,

  -- Timestamps
  first_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for similarity search
CREATE INDEX IF NOT EXISTS idx_workflow_patterns_plugins
ON workflow_patterns USING GIN (plugin_sequence);

-- Index for category filtering
CREATE INDEX IF NOT EXISTS idx_workflow_patterns_category
ON workflow_patterns(category, popularity DESC);

-- Index for popularity ranking
CREATE INDEX IF NOT EXISTS idx_workflow_patterns_popularity
ON workflow_patterns(popularity DESC, avg_success_rate DESC);

-- Comments
COMMENT ON TABLE workflow_patterns IS 'Anonymized workflow patterns extracted from successful executions';
COMMENT ON COLUMN workflow_patterns.pattern_hash IS 'SHA256 hash of plugin_sequence for deduplication';
COMMENT ON COLUMN workflow_patterns.popularity IS 'Number of unique users with this pattern (not exposing who)';
COMMENT ON COLUMN workflow_patterns.avg_success_rate IS 'Aggregate success rate across all users';

-- ============================================================
-- Global Failure Registry (Platform-Wide Monitoring)
-- ============================================================

CREATE TABLE IF NOT EXISTS global_failure_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  error_signature TEXT UNIQUE NOT NULL,        -- Hash of error_code + plugin + action
  error_code TEXT NOT NULL,
  plugin TEXT NOT NULL,
  action TEXT,

  -- Aggregate metrics
  affected_workflows_count INTEGER DEFAULT 1,
  affected_users_count INTEGER DEFAULT 1,      -- Approximate, not exact tracking

  -- Timeline
  first_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  spike_detected_at TIMESTAMP WITH TIME ZONE,  -- When spike was detected
  resolved_at TIMESTAMP WITH TIME ZONE,

  -- Status tracking
  status TEXT DEFAULT 'active',                -- 'active', 'resolved', 'known_issue', 'investigating'
  severity TEXT DEFAULT 'normal',              -- 'normal', 'elevated', 'critical'

  -- Known fixes (from successful recoveries)
  known_fixes JSONB DEFAULT '[]',              -- [{fix: "retry", success_rate: 0.92}]

  -- Alerting
  platform_alert_sent BOOLEAN DEFAULT FALSE,
  last_alert_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for active failure lookup
CREATE INDEX IF NOT EXISTS idx_global_failures_active
ON global_failure_patterns(plugin, action, status)
WHERE status IN ('active', 'investigating');

-- Index for spike detection
CREATE INDEX IF NOT EXISTS idx_global_failures_recent
ON global_failure_patterns(last_seen DESC)
WHERE status = 'active';

-- Comments
COMMENT ON TABLE global_failure_patterns IS 'Platform-wide error patterns for early warning and spike detection';
COMMENT ON COLUMN global_failure_patterns.affected_users_count IS 'Approximate count, not linked to specific users';
COMMENT ON COLUMN global_failure_patterns.known_fixes IS 'Successful recovery methods aggregated from all users';

-- ============================================================
-- Helper Functions
-- ============================================================

-- Function to upsert workflow pattern (called after successful execution)
CREATE OR REPLACE FUNCTION upsert_workflow_pattern(
  p_plugin_sequence TEXT[],
  p_trigger_type TEXT,
  p_step_count INTEGER,
  p_category TEXT,
  p_success BOOLEAN,
  p_execution_time_ms DECIMAL,
  p_token_usage DECIMAL
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
  v_hash TEXT;
  v_existing RECORD;
BEGIN
  -- Generate hash from sorted plugin sequence for consistency
  v_hash := encode(sha256(array_to_string(p_plugin_sequence, ',')::bytea), 'hex');

  -- Try to get existing pattern
  SELECT id, popularity, total_executions, successful_executions,
         avg_execution_time_ms, avg_token_usage
  INTO v_existing
  FROM workflow_patterns
  WHERE pattern_hash = v_hash
  FOR UPDATE;

  IF FOUND THEN
    -- Update existing pattern with running averages
    UPDATE workflow_patterns
    SET
      popularity = popularity, -- Don't increment (would need user tracking)
      total_executions = v_existing.total_executions + 1,
      successful_executions = v_existing.successful_executions + CASE WHEN p_success THEN 1 ELSE 0 END,
      avg_success_rate = (v_existing.successful_executions + CASE WHEN p_success THEN 1 ELSE 0 END)::DECIMAL
                          / (v_existing.total_executions + 1)::DECIMAL,
      avg_execution_time_ms = (v_existing.avg_execution_time_ms * v_existing.total_executions + p_execution_time_ms)
                               / (v_existing.total_executions + 1),
      avg_token_usage = (v_existing.avg_token_usage * v_existing.total_executions + p_token_usage)
                         / (v_existing.total_executions + 1),
      last_seen = NOW(),
      updated_at = NOW()
    WHERE id = v_existing.id
    RETURNING id INTO v_id;
  ELSE
    -- Insert new pattern
    INSERT INTO workflow_patterns (
      pattern_hash, plugin_sequence, trigger_type, step_count, category,
      popularity, total_executions, successful_executions, avg_success_rate,
      avg_execution_time_ms, avg_token_usage
    )
    VALUES (
      v_hash, p_plugin_sequence, p_trigger_type, p_step_count, p_category,
      1, 1, CASE WHEN p_success THEN 1 ELSE 0 END, CASE WHEN p_success THEN 1.0 ELSE 0.0 END,
      p_execution_time_ms, p_token_usage
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to record global failure (called on step failure)
CREATE OR REPLACE FUNCTION record_global_failure(
  p_error_code TEXT,
  p_plugin TEXT,
  p_action TEXT,
  p_recovery_method TEXT DEFAULT NULL,
  p_recovery_success BOOLEAN DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
  v_signature TEXT;
  v_existing RECORD;
  v_known_fixes JSONB;
BEGIN
  -- Generate signature
  v_signature := encode(sha256((p_error_code || ':' || p_plugin || ':' || COALESCE(p_action, ''))::bytea), 'hex');

  -- Try to get existing pattern
  SELECT id, affected_workflows_count, known_fixes, last_seen
  INTO v_existing
  FROM global_failure_patterns
  WHERE error_signature = v_signature
  FOR UPDATE;

  IF FOUND THEN
    -- Update known fixes if recovery info provided
    v_known_fixes := COALESCE(v_existing.known_fixes, '[]'::JSONB);
    IF p_recovery_method IS NOT NULL AND p_recovery_success IS NOT NULL THEN
      -- Add or update recovery method
      v_known_fixes := v_known_fixes || jsonb_build_object(
        'method', p_recovery_method,
        'success', p_recovery_success,
        'timestamp', NOW()
      );
      -- Keep only last 10 recovery attempts
      IF jsonb_array_length(v_known_fixes) > 10 THEN
        v_known_fixes := (SELECT jsonb_agg(elem) FROM (
          SELECT elem FROM jsonb_array_elements(v_known_fixes) AS elem
          ORDER BY elem->>'timestamp' DESC
          LIMIT 10
        ) sub);
      END IF;
    END IF;

    -- Detect spike (10x increase in last hour vs previous)
    UPDATE global_failure_patterns
    SET
      affected_workflows_count = v_existing.affected_workflows_count + 1,
      last_seen = NOW(),
      known_fixes = v_known_fixes,
      -- Set severity based on spike
      severity = CASE
        WHEN v_existing.affected_workflows_count > 50
             AND NOW() - v_existing.last_seen < INTERVAL '1 hour'
        THEN 'critical'
        WHEN v_existing.affected_workflows_count > 20
             AND NOW() - v_existing.last_seen < INTERVAL '1 hour'
        THEN 'elevated'
        ELSE 'normal'
      END,
      spike_detected_at = CASE
        WHEN v_existing.affected_workflows_count > 20
             AND NOW() - v_existing.last_seen < INTERVAL '1 hour'
             AND spike_detected_at IS NULL
        THEN NOW()
        ELSE spike_detected_at
      END,
      updated_at = NOW()
    WHERE id = v_existing.id
    RETURNING id INTO v_id;
  ELSE
    -- Insert new pattern
    INSERT INTO global_failure_patterns (
      error_signature, error_code, plugin, action,
      affected_workflows_count, affected_users_count
    )
    VALUES (
      v_signature, p_error_code, p_plugin, p_action,
      1, 1
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get similar workflow patterns (for V6 suggestions)
CREATE OR REPLACE FUNCTION get_similar_patterns(
  p_plugins TEXT[],
  p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  plugin_sequence TEXT[],
  trigger_type TEXT,
  step_count INTEGER,
  category TEXT,
  popularity INTEGER,
  avg_success_rate DECIMAL,
  similarity DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    wp.id,
    wp.plugin_sequence,
    wp.trigger_type,
    wp.step_count,
    wp.category,
    wp.popularity,
    wp.avg_success_rate,
    -- Calculate Jaccard similarity
    (
      SELECT COUNT(*)::DECIMAL FROM (
        SELECT unnest(wp.plugin_sequence) INTERSECT SELECT unnest(p_plugins)
      ) common
    ) / GREATEST(
      (SELECT COUNT(*)::DECIMAL FROM (
        SELECT unnest(wp.plugin_sequence) UNION SELECT unnest(p_plugins)
      ) total),
      1
    ) AS similarity
  FROM workflow_patterns wp
  WHERE wp.plugin_sequence && p_plugins  -- At least one common plugin
    AND wp.total_executions >= 5         -- Minimum sample size
  ORDER BY
    similarity DESC,
    wp.avg_success_rate DESC,
    wp.popularity DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get active global failures for a plugin
CREATE OR REPLACE FUNCTION get_active_failures(
  p_plugin TEXT,
  p_action TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  error_code TEXT,
  plugin TEXT,
  action TEXT,
  affected_workflows_count INTEGER,
  severity TEXT,
  known_fixes JSONB,
  first_seen TIMESTAMP WITH TIME ZONE,
  last_seen TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    gfp.id,
    gfp.error_code,
    gfp.plugin,
    gfp.action,
    gfp.affected_workflows_count,
    gfp.severity,
    gfp.known_fixes,
    gfp.first_seen,
    gfp.last_seen
  FROM global_failure_patterns gfp
  WHERE gfp.plugin = p_plugin
    AND (p_action IS NULL OR gfp.action = p_action)
    AND gfp.status IN ('active', 'investigating')
    AND gfp.last_seen > NOW() - INTERVAL '24 hours'
  ORDER BY gfp.severity DESC, gfp.affected_workflows_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
