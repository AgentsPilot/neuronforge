-- Enhance behavior_rules Table
-- Phase 1 of Memory System Enhancement: Error Learning
--
-- Purpose: Add wildcard pattern matching and effectiveness tracking
-- to behavior_rules for smarter automatic error handling.
--
-- NOTE: This migration only runs if behavior_rules table exists.
-- If it doesn't exist, the functions are still created (no-op if table missing).

-- Wrap ALTER TABLE statements in a DO block to check table existence
DO $$
BEGIN
  -- Check if behavior_rules table exists
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'behavior_rules') THEN
    RAISE NOTICE 'behavior_rules table does not exist, skipping ALTER TABLE statements';
    RETURN;
  END IF;

  -- Add effectiveness tracking columns
  ALTER TABLE behavior_rules ADD COLUMN IF NOT EXISTS success_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE behavior_rules ADD COLUMN IF NOT EXISTS failure_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE behavior_rules ADD COLUMN IF NOT EXISTS effectiveness_rate DECIMAL(5,4);
  ALTER TABLE behavior_rules ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMP WITH TIME ZONE;
  ALTER TABLE behavior_rules ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMP WITH TIME ZONE;

  -- Add source tracking for rules created from error patterns
  ALTER TABLE behavior_rules ADD COLUMN IF NOT EXISTS created_from_error_pattern_id UUID;

  -- Add plugin/action wildcards for broader matching
  ALTER TABLE behavior_rules ADD COLUMN IF NOT EXISTS plugin_pattern TEXT;
  ALTER TABLE behavior_rules ADD COLUMN IF NOT EXISTS action_pattern TEXT;
  ALTER TABLE behavior_rules ADD COLUMN IF NOT EXISTS error_code_pattern TEXT;

  -- Add priority for rule ordering (higher = checked first)
  ALTER TABLE behavior_rules ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0;

  -- Comments
  COMMENT ON COLUMN behavior_rules.success_count IS 'Number of times this rule was applied and resulted in successful recovery';
  COMMENT ON COLUMN behavior_rules.failure_count IS 'Number of times this rule was applied but recovery still failed';
  COMMENT ON COLUMN behavior_rules.effectiveness_rate IS 'success_count / (success_count + failure_count)';
  COMMENT ON COLUMN behavior_rules.plugin_pattern IS 'Glob pattern for plugin matching (e.g., "google-*", "airtable")';
  COMMENT ON COLUMN behavior_rules.action_pattern IS 'Glob pattern for action matching (e.g., "search_*", "create_record")';
  COMMENT ON COLUMN behavior_rules.error_code_pattern IS 'Regex pattern for error code matching (e.g., "4[0-9]{2}", "TIMEOUT")';
  COMMENT ON COLUMN behavior_rules.priority IS 'Higher priority rules are checked first (default 0)';

  -- Index for pattern matching queries
  CREATE INDEX IF NOT EXISTS idx_behavior_rules_patterns
  ON behavior_rules(user_id, status, priority DESC)
  WHERE status = 'active';

  -- Index for effectiveness queries
  CREATE INDEX IF NOT EXISTS idx_behavior_rules_effectiveness
  ON behavior_rules(user_id, effectiveness_rate DESC)
  WHERE status = 'active' AND (success_count + failure_count) >= 5;

END $$;

-- Function to record behavior rule application result and update effectiveness
-- Created regardless of table existence (will no-op if table missing)
CREATE OR REPLACE FUNCTION record_behavior_rule_result(
  p_rule_id UUID,
  p_success BOOLEAN
)
RETURNS VOID AS $$
BEGIN
  -- Only execute if behavior_rules table exists
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'behavior_rules') THEN
    RETURN;
  END IF;

  UPDATE behavior_rules
  SET
    applied_count = applied_count + 1,
    success_count = success_count + CASE WHEN p_success THEN 1 ELSE 0 END,
    failure_count = failure_count + CASE WHEN p_success THEN 0 ELSE 1 END,
    effectiveness_rate = (success_count + CASE WHEN p_success THEN 1 ELSE 0 END)::DECIMAL
                          / (success_count + failure_count + 1)::DECIMAL,
    last_applied_at = NOW(),
    last_success_at = CASE WHEN p_success THEN NOW() ELSE last_success_at END,
    last_failure_at = CASE WHEN p_success THEN last_failure_at ELSE NOW() END,
    updated_at = NOW()
  WHERE id = p_rule_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to match behavior rules using patterns
-- Returns matching rules ordered by priority and specificity
CREATE OR REPLACE FUNCTION match_behavior_rules(
  p_user_id UUID,
  p_agent_id UUID,
  p_plugin TEXT,
  p_action TEXT,
  p_error_code TEXT,
  p_data_field TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  rule_type TEXT,
  action JSONB,
  priority INTEGER,
  effectiveness_rate DECIMAL
) AS $$
BEGIN
  -- Only execute if behavior_rules table exists
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'behavior_rules') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    br.id,
    br.rule_type,
    br.action,
    br.priority,
    br.effectiveness_rate
  FROM behavior_rules br
  WHERE br.user_id = p_user_id
    AND br.status = 'active'
    AND (br.expires_at IS NULL OR br.expires_at > NOW())
    -- Agent scope: either agent-specific or global (NULL)
    AND (br.agent_id IS NULL OR br.agent_id = p_agent_id)
    -- Pattern matching
    AND (
      br.plugin_pattern IS NULL
      OR p_plugin LIKE REPLACE(REPLACE(br.plugin_pattern, '*', '%'), '?', '_')
    )
    AND (
      br.action_pattern IS NULL
      OR p_action LIKE REPLACE(REPLACE(br.action_pattern, '*', '%'), '?', '_')
    )
    AND (
      br.error_code_pattern IS NULL
      OR p_error_code ~ br.error_code_pattern
    )
    -- Data field matching (from trigger_condition)
    AND (
      br.trigger_condition->'data_pattern' IS NULL
      OR br.trigger_condition->'data_pattern'->>'field' = p_data_field
    )
  ORDER BY
    -- Agent-specific rules first
    CASE WHEN br.agent_id IS NOT NULL THEN 0 ELSE 1 END,
    -- Higher priority first
    br.priority DESC,
    -- Higher effectiveness first
    COALESCE(br.effectiveness_rate, 0.5) DESC,
    -- More recently successful first
    br.last_success_at DESC NULLS LAST
  LIMIT 5;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to auto-disable ineffective rules (call from weekly cron)
CREATE OR REPLACE FUNCTION auto_disable_ineffective_behavior_rules(
  p_min_applications INTEGER DEFAULT 10,
  p_min_effectiveness DECIMAL DEFAULT 0.3
)
RETURNS INTEGER AS $$
DECLARE
  v_disabled_count INTEGER := 0;
BEGIN
  -- Only execute if behavior_rules table exists
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'behavior_rules') THEN
    RETURN 0;
  END IF;

  UPDATE behavior_rules
  SET
    status = 'inactive',
    updated_at = NOW()
  WHERE status = 'active'
    AND (success_count + failure_count) >= p_min_applications
    AND effectiveness_rate < p_min_effectiveness;

  GET DIAGNOSTICS v_disabled_count = ROW_COUNT;

  RETURN v_disabled_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
