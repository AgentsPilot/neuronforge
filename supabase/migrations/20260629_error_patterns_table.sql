-- Error Patterns Table
-- Phase 1 of Memory System Enhancement
--
-- Purpose: Learn from recurring errors and enable auto-recovery
-- This table tracks error patterns per agent and stores successful recovery methods.
--
-- Privacy: Only stores error metadata (codes, plugin names, action names)
-- NO client data (email content, CRM records, etc.)

-- Create error_patterns table
CREATE TABLE IF NOT EXISTS error_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Error identification (composite key for deduplication)
  error_code TEXT NOT NULL,               -- "429", "503", "401", "TIMEOUT", etc.
  plugin TEXT NOT NULL,                   -- "gmail", "airtable", "google-sheets"
  action TEXT,                            -- "search_emails", "create_record", null for general plugin errors

  -- Occurrence tracking
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  first_seen TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- Recovery history (JSONB array of attempts)
  -- Each entry: {method: string, success: boolean, timestamp: string, execution_id: string}
  recovery_attempts JSONB NOT NULL DEFAULT '[]',

  -- Auto-fix configuration
  auto_fix_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  auto_fix_method TEXT,                   -- "retry_with_backoff", "skip", "fallback", "wait_and_retry"
  auto_fix_config JSONB DEFAULT '{}',     -- Method-specific config (e.g., {max_retries: 3, backoff_ms: 1000})
  auto_fix_success_rate DECIMAL(5,4),     -- 0.0000 to 1.0000
  auto_fix_applied_count INTEGER NOT NULL DEFAULT 0,
  auto_fix_success_count INTEGER NOT NULL DEFAULT 0,

  -- Metadata
  error_message_sample TEXT,              -- Sample error message (sanitized, no PII)
  step_type TEXT,                         -- "action", "llm_decision", etc.

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Unique constraint: one pattern per agent + error_code + plugin + action combo
CREATE UNIQUE INDEX idx_error_patterns_unique
ON error_patterns(user_id, COALESCE(agent_id, '00000000-0000-0000-0000-000000000000'::UUID), error_code, plugin, COALESCE(action, ''));

-- Query patterns: Get patterns for a specific agent
CREATE INDEX idx_error_patterns_agent_id
ON error_patterns(agent_id, occurrence_count DESC);

-- Query patterns: Get patterns by plugin (for global learning)
CREATE INDEX idx_error_patterns_plugin
ON error_patterns(plugin, action, error_code);

-- Query patterns: Get high-occurrence patterns
CREATE INDEX idx_error_patterns_occurrence
ON error_patterns(user_id, occurrence_count DESC)
WHERE occurrence_count >= 3;

-- Query patterns: Get patterns eligible for auto-fix
CREATE INDEX idx_error_patterns_auto_fix_eligible
ON error_patterns(user_id, auto_fix_enabled, auto_fix_success_rate DESC)
WHERE auto_fix_enabled = TRUE;

-- Row Level Security
ALTER TABLE error_patterns ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own patterns
CREATE POLICY error_patterns_select_own
ON error_patterns FOR SELECT
USING (auth.uid() = user_id);

-- Policy: Users can insert their own patterns
CREATE POLICY error_patterns_insert_own
ON error_patterns FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own patterns
CREATE POLICY error_patterns_update_own
ON error_patterns FOR UPDATE
USING (auth.uid() = user_id);

-- Policy: Users can delete their own patterns
CREATE POLICY error_patterns_delete_own
ON error_patterns FOR DELETE
USING (auth.uid() = user_id);

-- Comments
COMMENT ON TABLE error_patterns IS 'Tracks recurring error patterns per agent for auto-recovery learning';
COMMENT ON COLUMN error_patterns.error_code IS 'HTTP status code or error type (429, 503, TIMEOUT, AUTH_FAILED)';
COMMENT ON COLUMN error_patterns.plugin IS 'Plugin identifier (gmail, airtable, google-sheets)';
COMMENT ON COLUMN error_patterns.action IS 'Plugin action that failed (search_emails, create_record) - null for general errors';
COMMENT ON COLUMN error_patterns.recovery_attempts IS 'JSONB array: [{method, success, timestamp, execution_id}]';
COMMENT ON COLUMN error_patterns.auto_fix_method IS 'Recovery method to auto-apply: retry_with_backoff, skip, fallback, wait_and_retry';
COMMENT ON COLUMN error_patterns.auto_fix_config IS 'Method-specific config: {max_retries, backoff_ms, fallback_value}';
COMMENT ON COLUMN error_patterns.auto_fix_success_rate IS 'Success rate of auto-fix (auto_fix_success_count / auto_fix_applied_count)';

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_error_patterns_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
CREATE TRIGGER trigger_error_patterns_updated_at
  BEFORE UPDATE ON error_patterns
  FOR EACH ROW
  EXECUTE FUNCTION update_error_patterns_updated_at();

-- Function to upsert error pattern (increment if exists, create if not)
CREATE OR REPLACE FUNCTION upsert_error_pattern(
  p_user_id UUID,
  p_agent_id UUID,
  p_error_code TEXT,
  p_plugin TEXT,
  p_action TEXT,
  p_error_message TEXT,
  p_step_type TEXT,
  p_recovery_attempt JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_pattern_id UUID;
  v_safe_agent_id UUID;
  v_safe_action TEXT;
BEGIN
  -- Handle nulls for unique index
  v_safe_agent_id := COALESCE(p_agent_id, '00000000-0000-0000-0000-000000000000'::UUID);
  v_safe_action := COALESCE(p_action, '');

  -- Try to update existing pattern
  UPDATE error_patterns
  SET
    occurrence_count = occurrence_count + 1,
    last_seen = NOW(),
    error_message_sample = COALESCE(p_error_message, error_message_sample),
    recovery_attempts = CASE
      WHEN p_recovery_attempt IS NOT NULL
      THEN recovery_attempts || p_recovery_attempt
      ELSE recovery_attempts
    END
  WHERE user_id = p_user_id
    AND COALESCE(agent_id, '00000000-0000-0000-0000-000000000000'::UUID) = v_safe_agent_id
    AND error_code = p_error_code
    AND plugin = p_plugin
    AND COALESCE(action, '') = v_safe_action
  RETURNING id INTO v_pattern_id;

  -- If not found, insert new pattern
  IF v_pattern_id IS NULL THEN
    INSERT INTO error_patterns (
      user_id, agent_id, error_code, plugin, action,
      error_message_sample, step_type,
      recovery_attempts
    ) VALUES (
      p_user_id, p_agent_id, p_error_code, p_plugin, p_action,
      p_error_message, p_step_type,
      CASE WHEN p_recovery_attempt IS NOT NULL THEN jsonb_build_array(p_recovery_attempt) ELSE '[]'::jsonb END
    )
    RETURNING id INTO v_pattern_id;
  END IF;

  RETURN v_pattern_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to record auto-fix result and update success rate
CREATE OR REPLACE FUNCTION record_auto_fix_result(
  p_pattern_id UUID,
  p_success BOOLEAN
)
RETURNS VOID AS $$
BEGIN
  UPDATE error_patterns
  SET
    auto_fix_applied_count = auto_fix_applied_count + 1,
    auto_fix_success_count = auto_fix_success_count + CASE WHEN p_success THEN 1 ELSE 0 END,
    auto_fix_success_rate = (auto_fix_success_count + CASE WHEN p_success THEN 1 ELSE 0 END)::DECIMAL
                            / (auto_fix_applied_count + 1)::DECIMAL
  WHERE id = p_pattern_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Analytics view: Error patterns summary by plugin
CREATE OR REPLACE VIEW error_pattern_summary AS
SELECT
  plugin,
  action,
  error_code,
  COUNT(*) as pattern_count,
  SUM(occurrence_count) as total_occurrences,
  AVG(auto_fix_success_rate) FILTER (WHERE auto_fix_enabled) as avg_auto_fix_success_rate,
  COUNT(*) FILTER (WHERE auto_fix_enabled) as auto_fix_enabled_count
FROM error_patterns
GROUP BY plugin, action, error_code
ORDER BY total_occurrences DESC;

COMMENT ON VIEW error_pattern_summary IS 'Aggregate view of error patterns by plugin/action - for platform-wide analysis';
