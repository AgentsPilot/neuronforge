-- Migration: Add execution quota columns to user_subscriptions
-- Similar to storage quota system

-- Add execution quota columns
ALTER TABLE user_subscriptions
ADD COLUMN IF NOT EXISTS executions_quota INTEGER DEFAULT NULL,
ADD COLUMN IF NOT EXISTS executions_used INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS executions_alert_threshold NUMERIC(3,2) DEFAULT 0.90;

-- Add comments for documentation
COMMENT ON COLUMN user_subscriptions.executions_quota IS 'Maximum number of workflow executions allowed (NULL = unlimited)';
COMMENT ON COLUMN user_subscriptions.executions_used IS 'Total number of workflow executions used';
COMMENT ON COLUMN user_subscriptions.executions_alert_threshold IS 'Threshold percentage (0-1) at which to alert user about execution quota';

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_executions
ON user_subscriptions(executions_used, executions_quota)
WHERE executions_quota IS NOT NULL;

-- Add execution quota tier configs to ais_system_config
-- Format: executions_tokens_X where X is the minimum pilot tokens for that tier
INSERT INTO ais_system_config (config_key, config_value, category, description, updated_at) VALUES
  ('executions_tokens_0', 'null', 'executions', 'Execution quota (unlimited) for 0-10,000 pilot tokens', NOW()),
  ('executions_tokens_10000', 'null', 'executions', 'Execution quota (unlimited) for 10,000-50,000 pilot tokens', NOW()),
  ('executions_tokens_50000', 'null', 'executions', 'Execution quota (unlimited) for 50,000-100,000 pilot tokens', NOW()),
  ('executions_tokens_100000', 'null', 'executions', 'Execution quota (unlimited) for 100,000-500,000 pilot tokens', NOW()),
  ('executions_tokens_500000', 'null', 'executions', 'Execution quota (unlimited) for 500,000+ pilot tokens', NOW())
ON CONFLICT (config_key) DO UPDATE SET
  config_value = EXCLUDED.config_value,
  description = EXCLUDED.description,
  updated_at = NOW();

-- Create function to increment executions_used
CREATE OR REPLACE FUNCTION increment_executions_used(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE user_subscriptions
  SET executions_used = executions_used + 1
  WHERE user_id = p_user_id;
END;
$$;
