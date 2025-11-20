-- ============================================================================
-- COMPLETE QUOTA SYSTEM MIGRATION
-- Run this entire file to set up storage and execution quota management
-- ============================================================================

-- ============================================================================
-- PART 1: Create/Update ais_system_config table
-- ============================================================================

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS ais_system_config (
  config_key TEXT PRIMARY KEY,
  config_value TEXT NOT NULL,  -- Changed from NUMERIC to TEXT to support 'null', numbers, and other values
  description TEXT,
  category TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add updated_at column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ais_system_config'
    AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE ais_system_config ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- Convert config_value from NUMERIC to TEXT if needed
-- First, we need to handle the calculator_config view that depends on this column
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ais_system_config'
    AND column_name = 'config_value'
    AND data_type = 'numeric'
  ) THEN
    -- Drop the view if it exists (we'll recreate it with TEXT casting)
    DROP VIEW IF EXISTS calculator_config CASCADE;

    -- Now we can safely alter the column type
    ALTER TABLE ais_system_config ALTER COLUMN config_value TYPE TEXT USING config_value::TEXT;
  END IF;
END $$;

-- Recreate calculator_config view with proper TEXT to NUMERIC casting
CREATE OR REPLACE VIEW calculator_config AS
SELECT
  MAX(CASE WHEN config_key = 'calculator_base_tokens' THEN config_value::NUMERIC ELSE NULL END) AS base_tokens,
  MAX(CASE WHEN config_key = 'calculator_tokens_per_plugin' THEN config_value::NUMERIC ELSE NULL END) AS tokens_per_plugin,
  MAX(CASE WHEN config_key = 'calculator_peak_multiplier' THEN config_value::NUMERIC ELSE NULL END) AS peak_multiplier,
  MAX(CASE WHEN config_key = 'calculator_base_iterations' THEN config_value::NUMERIC ELSE NULL END) AS base_iterations,
  MAX(CASE WHEN config_key = 'calculator_max_iterations' THEN config_value::NUMERIC ELSE NULL END) AS max_iterations,
  MAX(CASE WHEN config_key = 'calculator_plugin_usage_rate' THEN config_value::NUMERIC ELSE NULL END) AS plugin_usage_rate,
  MAX(CASE WHEN config_key = 'calculator_orchestration_overhead_ms' THEN config_value::NUMERIC ELSE NULL END) AS orchestration_overhead_ms,
  MAX(CASE WHEN config_key = 'calculator_estimated_duration_ms' THEN config_value::NUMERIC ELSE NULL END) AS estimated_duration_ms,
  MAX(CASE WHEN config_key = 'calculator_estimated_failure_rate' THEN config_value::NUMERIC ELSE NULL END) AS estimated_failure_rate,
  MAX(CASE WHEN config_key = 'calculator_estimated_retry_rate' THEN config_value::NUMERIC ELSE NULL END) AS estimated_retry_rate,
  MAX(CASE WHEN config_key = 'calculator_io_ratio' THEN config_value::NUMERIC ELSE NULL END) AS io_ratio,
  MAX(CASE WHEN config_key = 'ais_weight_tokens' THEN config_value::NUMERIC ELSE NULL END) AS weight_tokens,
  MAX(CASE WHEN config_key = 'ais_weight_execution' THEN config_value::NUMERIC ELSE NULL END) AS weight_execution,
  MAX(CASE WHEN config_key = 'ais_weight_plugins' THEN config_value::NUMERIC ELSE NULL END) AS weight_plugins,
  MAX(CASE WHEN config_key = 'ais_weight_workflow' THEN config_value::NUMERIC ELSE NULL END) AS weight_workflow,
  MAX(CASE WHEN config_key = 'ais_token_volume_weight' THEN config_value::NUMERIC ELSE NULL END) AS token_volume_weight,
  MAX(CASE WHEN config_key = 'ais_token_peak_weight' THEN config_value::NUMERIC ELSE NULL END) AS token_peak_weight,
  MAX(CASE WHEN config_key = 'ais_token_io_weight' THEN config_value::NUMERIC ELSE NULL END) AS token_io_weight,
  MAX(CASE WHEN config_key = 'ais_execution_iterations_weight' THEN config_value::NUMERIC ELSE NULL END) AS execution_iterations_weight,
  MAX(CASE WHEN config_key = 'ais_execution_duration_weight' THEN config_value::NUMERIC ELSE NULL END) AS execution_duration_weight,
  MAX(CASE WHEN config_key = 'ais_execution_failure_weight' THEN config_value::NUMERIC ELSE NULL END) AS execution_failure_weight,
  MAX(CASE WHEN config_key = 'ais_execution_retry_weight' THEN config_value::NUMERIC ELSE NULL END) AS execution_retry_weight,
  MAX(CASE WHEN config_key = 'ais_plugin_count_weight' THEN config_value::NUMERIC ELSE NULL END) AS plugin_count_weight,
  MAX(CASE WHEN config_key = 'ais_plugin_usage_weight' THEN config_value::NUMERIC ELSE NULL END) AS plugin_usage_weight,
  MAX(CASE WHEN config_key = 'ais_plugin_overhead_weight' THEN config_value::NUMERIC ELSE NULL END) AS plugin_overhead_weight,
  MAX(CASE WHEN config_key = 'ais_workflow_steps_weight' THEN config_value::NUMERIC ELSE NULL END) AS workflow_steps_weight,
  MAX(CASE WHEN config_key = 'ais_workflow_branches_weight' THEN config_value::NUMERIC ELSE NULL END) AS workflow_branches_weight,
  MAX(CASE WHEN config_key = 'ais_workflow_loops_weight' THEN config_value::NUMERIC ELSE NULL END) AS workflow_loops_weight,
  MAX(CASE WHEN config_key = 'ais_workflow_parallel_weight' THEN config_value::NUMERIC ELSE NULL END) AS workflow_parallel_weight,
  MAX(CASE WHEN config_key = 'runs_per_agent_per_month' THEN config_value::NUMERIC ELSE NULL END) AS runs_per_agent_per_month,
  MAX(CASE WHEN config_key = 'agent_creation_cost' THEN config_value::NUMERIC ELSE NULL END) AS agent_creation_cost,
  MAX(CASE WHEN config_key = 'pilot_credit_cost_usd' THEN config_value::NUMERIC ELSE NULL END) AS credit_cost_usd,
  MAX(CASE WHEN config_key = 'min_subscription_usd' THEN config_value::NUMERIC ELSE NULL END) AS minimum_monthly_cost_usd,
  MAX(CASE WHEN config_key = 'base_credits_per_run' THEN config_value::NUMERIC ELSE NULL END) AS base_credits_per_run,
  MAX(CASE WHEN config_key = 'plugin_overhead_per_run' THEN config_value::NUMERIC ELSE NULL END) AS plugin_overhead_per_run,
  MAX(CASE WHEN config_key = 'system_overhead_per_run' THEN config_value::NUMERIC ELSE NULL END) AS system_overhead_per_run,
  MAX(CASE WHEN config_key = 'execution_step_multiplier' THEN config_value::NUMERIC ELSE NULL END) AS execution_step_multiplier
FROM ais_system_config
WHERE category IN (
  'calculator_estimation',
  'ais_dimension_weights',
  'ais_token_subdimension',
  'ais_execution_subdimension',
  'ais_plugin_subdimension',
  'ais_workflow_subdimension',
  'pricing'
);

-- Add category column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ais_system_config'
    AND column_name = 'category'
  ) THEN
    ALTER TABLE ais_system_config ADD COLUMN category TEXT;
  END IF;
END $$;

-- Create index on category for faster lookups
CREATE INDEX IF NOT EXISTS idx_ais_system_config_category ON ais_system_config(category);

-- Create index on config_key pattern matching (for LIKE queries)
CREATE INDEX IF NOT EXISTS idx_ais_system_config_key_pattern ON ais_system_config(config_key text_pattern_ops);

-- ============================================================================
-- PART 2: Add Storage Quota Columns to user_subscriptions
-- ============================================================================

-- Add storage quota columns if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_subscriptions'
    AND column_name = 'storage_quota_mb'
  ) THEN
    ALTER TABLE user_subscriptions ADD COLUMN storage_quota_mb INTEGER DEFAULT 1000;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_subscriptions'
    AND column_name = 'storage_used_mb'
  ) THEN
    ALTER TABLE user_subscriptions ADD COLUMN storage_used_mb NUMERIC(10,2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_subscriptions'
    AND column_name = 'storage_alert_threshold'
  ) THEN
    ALTER TABLE user_subscriptions ADD COLUMN storage_alert_threshold NUMERIC(3,2) DEFAULT 0.90;
  END IF;
END $$;

-- Add comments for storage columns
COMMENT ON COLUMN user_subscriptions.storage_quota_mb IS 'Storage quota in megabytes';
COMMENT ON COLUMN user_subscriptions.storage_used_mb IS 'Storage used in megabytes (calculated from storage_usage table)';
COMMENT ON COLUMN user_subscriptions.storage_alert_threshold IS 'Threshold percentage (0-1) at which to alert user about storage usage';

-- Create index for storage performance
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_storage
ON user_subscriptions(storage_used_mb, storage_quota_mb);

-- Create storage_usage table to track individual file uploads
CREATE TABLE IF NOT EXISTS storage_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  file_type TEXT,
  bucket_name TEXT NOT NULL,
  metadata JSONB,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, file_path, bucket_name)
);

-- Create index on user_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_storage_usage_user_id ON storage_usage(user_id);

-- Create function to update storage_used_mb
CREATE OR REPLACE FUNCTION update_user_storage_used()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate total storage for the user and update user_subscriptions
  UPDATE user_subscriptions
  SET storage_used_mb = (
    SELECT COALESCE(SUM(file_size_bytes) / 1024.0 / 1024.0, 0)
    FROM storage_usage
    WHERE user_id = COALESCE(NEW.user_id, OLD.user_id)
  )
  WHERE user_id = COALESCE(NEW.user_id, OLD.user_id);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically update storage_used_mb
DROP TRIGGER IF EXISTS trigger_update_storage_used ON storage_usage;
CREATE TRIGGER trigger_update_storage_used
AFTER INSERT OR UPDATE OR DELETE ON storage_usage
FOR EACH ROW
EXECUTE FUNCTION update_user_storage_used();

-- ============================================================================
-- PART 3: Token-Based Storage Tiers
-- ============================================================================

-- Remove old tier-based configs if they exist
DELETE FROM ais_system_config WHERE config_key LIKE 'storage_tier_%';

-- Add token-based storage tiers (pilot tokens threshold → storage MB)
-- Format: storage_tokens_X where X is the minimum pilot tokens for that tier
INSERT INTO ais_system_config (config_key, config_value, category, description, updated_at) VALUES
  ('storage_tokens_0', '1000', 'storage', 'Storage quota (MB) for 0-10,000 pilot tokens', NOW()),
  ('storage_tokens_10000', '5000', 'storage', 'Storage quota (MB) for 10,000-50,000 pilot tokens', NOW()),
  ('storage_tokens_50000', '25000', 'storage', 'Storage quota (MB) for 50,000-100,000 pilot tokens', NOW()),
  ('storage_tokens_100000', '100000', 'storage', 'Storage quota (MB) for 100,000-500,000 pilot tokens', NOW()),
  ('storage_tokens_500000', '500000', 'storage', 'Storage quota (MB) for 500,000+ pilot tokens', NOW())
ON CONFLICT (config_key) DO UPDATE SET
  config_value = EXCLUDED.config_value,
  description = EXCLUDED.description,
  updated_at = NOW();

-- ============================================================================
-- PART 4: Add Execution Quota Columns to user_subscriptions
-- ============================================================================

-- Add execution quota columns
ALTER TABLE user_subscriptions
ADD COLUMN IF NOT EXISTS executions_quota INTEGER DEFAULT NULL,
ADD COLUMN IF NOT EXISTS executions_used INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS executions_alert_threshold NUMERIC(3,2) DEFAULT 0.90;

-- Add comments for execution columns
COMMENT ON COLUMN user_subscriptions.executions_quota IS 'Maximum number of workflow executions allowed (NULL = unlimited)';
COMMENT ON COLUMN user_subscriptions.executions_used IS 'Total number of workflow executions used';
COMMENT ON COLUMN user_subscriptions.executions_alert_threshold IS 'Threshold percentage (0-1) at which to alert user about execution quota';

-- Create index for execution performance
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_executions
ON user_subscriptions(executions_used, executions_quota)
WHERE executions_quota IS NOT NULL;

-- ============================================================================
-- PART 5: Token-Based Execution Tiers
-- ============================================================================

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

-- ============================================================================
-- PART 6: Create Database Functions
-- ============================================================================

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

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Verify the setup
DO $$
BEGIN
  RAISE NOTICE '✅ Quota system migration completed successfully!';
  RAISE NOTICE '📊 Storage tiers configured: % rows', (SELECT COUNT(*) FROM ais_system_config WHERE category = 'storage');
  RAISE NOTICE '⚡ Execution tiers configured: % rows', (SELECT COUNT(*) FROM ais_system_config WHERE category = 'executions');
END $$;
