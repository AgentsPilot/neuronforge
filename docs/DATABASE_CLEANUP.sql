-- ============================================================================
-- DATABASE CLEANUP SCRIPT
-- Purpose: Remove obsolete routing system settings after consolidation
-- Date: 2025-11-11
-- Related: ROUTING_CONSOLIDATION_COMPLETE.md, ADMIN_UI_REORGANIZATION.md
-- ============================================================================

-- IMPORTANT: Backup your database before running this script!
-- pg_dump neuronforge > backup_before_cleanup_$(date +%Y%m%d).sql

BEGIN;

-- ============================================================================
-- 1. Remove Obsolete System Settings (System 1 - Old Intelligent Routing)
-- ============================================================================

DELETE FROM system_settings_config
WHERE key IN (
  'intelligent_routing_enabled',
  'routing_low_threshold',
  'routing_medium_threshold',
  'routing_min_success_rate',
  'anthropic_provider_enabled'
);

-- Check result
DO $$
DECLARE
  deleted_count INTEGER;
BEGIN
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % obsolete system settings (System 1)', deleted_count;
END $$;

-- ============================================================================
-- 2. Remove Obsolete Pilot Settings (System 2 - Per-Step Routing)
-- ============================================================================

DELETE FROM system_settings_config
WHERE key IN (
  'pilot_per_step_routing_enabled',
  'pilot_routing_default_strategy'
);

-- Check result
DO $$
DECLARE
  deleted_count INTEGER;
BEGIN
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % obsolete pilot settings (System 2)', deleted_count;
END $$;

-- ============================================================================
-- 3. Drop Obsolete Table (Phase 3 - Model Routing Config)
-- ============================================================================

-- Check if table exists
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'model_routing_config') THEN
    DROP TABLE IF EXISTS model_routing_config;
    RAISE NOTICE 'Dropped obsolete table: model_routing_config';
  ELSE
    RAISE NOTICE 'Table model_routing_config does not exist (already removed or never created)';
  END IF;
END $$;

-- ============================================================================
-- 4. Verify Orchestration Settings Exist
-- ============================================================================

-- Check if orchestration settings are present
DO $$
DECLARE
  orchestration_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orchestration_count
  FROM system_settings_config
  WHERE key LIKE 'orchestration_%';

  IF orchestration_count > 0 THEN
    RAISE NOTICE 'Found % orchestration settings (unified system)', orchestration_count;
  ELSE
    RAISE WARNING 'No orchestration settings found! You may need to initialize them.';
  END IF;
END $$;

-- ============================================================================
-- 5. Insert Default Orchestration Settings (If Missing)
-- ============================================================================

-- Only insert if they don't exist
INSERT INTO system_settings_config (key, value, category, description, updated_at) VALUES
('orchestration_enabled', 'false', 'orchestration', 'Master switch for orchestration system', NOW()),
('orchestration_compression_enabled', 'false', 'orchestration', 'Enable intelligent context compression', NOW()),
('orchestration_ais_routing_enabled', 'false', 'orchestration', 'Enable AIS-based model routing', NOW()),
('orchestration_routing_model_fast', '"claude-3-haiku-20240307"', 'orchestration', 'Model for fast tier (score < 3.0)', NOW()),
('orchestration_routing_model_balanced', '"gpt-4o-mini"', 'orchestration', 'Model for balanced tier (score 3.0-6.5)', NOW()),
('orchestration_routing_model_powerful', '"claude-3-5-sonnet-20241022"', 'orchestration', 'Model for powerful tier (score > 6.5)', NOW()),
('orchestration_routing_fast_tier_max_score', '3.0', 'orchestration', 'Maximum complexity score for fast tier', NOW()),
('orchestration_routing_balanced_tier_max_score', '6.5', 'orchestration', 'Maximum complexity score for balanced tier', NOW()),
('orchestration_routing_strategy_balanced', '{"aisWeight":0.6,"stepWeight":0.4}', 'orchestration', 'Routing strategy weights (AIS vs step complexity)', NOW())
ON CONFLICT (key) DO NOTHING;

-- Check result
DO $$
DECLARE
  inserted_count INTEGER;
BEGIN
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count > 0 THEN
    RAISE NOTICE 'Inserted % default orchestration settings', inserted_count;
  ELSE
    RAISE NOTICE 'All orchestration settings already exist';
  END IF;
END $$;

-- ============================================================================
-- 6. Insert Default Complexity Configuration in ais_system_config
-- ============================================================================

-- Complexity weights per intent type
INSERT INTO ais_system_config (config_key, config_value, updated_at) VALUES
('pilot_complexity_weights_generate', '{"promptLength":0.15,"dataSize":0.1,"conditionCount":0.15,"contextDepth":0.15,"reasoningDepth":0.3,"outputComplexity":0.15}', NOW()),
('pilot_complexity_weights_llm_decision', '{"promptLength":0.15,"dataSize":0.1,"conditionCount":0.15,"contextDepth":0.15,"reasoningDepth":0.3,"outputComplexity":0.15}', NOW()),
('pilot_complexity_weights_transform', '{"promptLength":0.15,"dataSize":0.3,"conditionCount":0.1,"contextDepth":0.15,"reasoningDepth":0.15,"outputComplexity":0.15}', NOW()),
('pilot_complexity_weights_conditional', '{"promptLength":0.15,"dataSize":0.1,"conditionCount":0.3,"contextDepth":0.15,"reasoningDepth":0.2,"outputComplexity":0.1}', NOW()),
('pilot_complexity_weights_action', '{"promptLength":0.2,"dataSize":0.15,"conditionCount":0.15,"contextDepth":0.15,"reasoningDepth":0.2,"outputComplexity":0.15}', NOW()),
('pilot_complexity_weights_default', '{"promptLength":0.2,"dataSize":0.15,"conditionCount":0.15,"contextDepth":0.15,"reasoningDepth":0.2,"outputComplexity":0.15}', NOW())
ON CONFLICT (config_key) DO NOTHING;

-- Complexity thresholds
INSERT INTO ais_system_config (config_key, config_value, updated_at) VALUES
('pilot_complexity_thresholds_prompt_length', '{"low":200,"medium":500,"high":1000}', NOW()),
('pilot_complexity_thresholds_data_size', '{"low":1024,"medium":10240,"high":51200}', NOW()),
('pilot_complexity_thresholds_condition_count', '{"low":2,"medium":5,"high":10}', NOW()),
('pilot_complexity_thresholds_context_depth', '{"low":2,"medium":5,"high":10}', NOW())
ON CONFLICT (config_key) DO NOTHING;

-- Check result
DO $$
DECLARE
  inserted_count INTEGER;
BEGIN
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count > 0 THEN
    RAISE NOTICE 'Inserted % default complexity configuration entries', inserted_count;
  ELSE
    RAISE NOTICE 'All complexity configuration already exists';
  END IF;
END $$;

-- ============================================================================
-- 7. Verification Queries
-- ============================================================================

-- Show remaining routing-related settings
DO $$
DECLARE
  rec RECORD;
BEGIN
  RAISE NOTICE '=== Remaining Routing Settings ===';
  FOR rec IN
    SELECT key, value, category
    FROM system_settings_config
    WHERE key LIKE '%routing%' OR category = 'routing'
    ORDER BY key
  LOOP
    RAISE NOTICE 'Key: %, Value: %, Category: %', rec.key, rec.value, rec.category;
  END LOOP;
END $$;

-- Show orchestration settings
DO $$
DECLARE
  rec RECORD;
BEGIN
  RAISE NOTICE '=== Orchestration Settings ===';
  FOR rec IN
    SELECT key, value, category
    FROM system_settings_config
    WHERE key LIKE 'orchestration_%'
    ORDER BY key
  LOOP
    RAISE NOTICE 'Key: %, Value: %, Category: %', rec.key, rec.value, rec.category;
  END LOOP;
END $$;

-- Show complexity configuration
DO $$
DECLARE
  rec RECORD;
  count INTEGER := 0;
BEGIN
  RAISE NOTICE '=== Complexity Configuration ===';
  FOR rec IN
    SELECT config_key, LEFT(config_value, 50) || '...' as value_preview
    FROM ais_system_config
    WHERE config_key LIKE 'pilot_complexity_%'
    ORDER BY config_key
  LOOP
    RAISE NOTICE 'Key: %, Value: %', rec.config_key, rec.value_preview;
    count := count + 1;
  END LOOP;
  RAISE NOTICE 'Total complexity config entries: %', count;
END $$;

-- ============================================================================
-- 8. Commit or Rollback
-- ============================================================================

-- Review the output above before committing
-- If everything looks good, commit:
COMMIT;

-- If something is wrong, rollback:
-- ROLLBACK;

-- ============================================================================
-- Post-Cleanup Steps
-- ============================================================================

/*
After running this script:

1. Restart your application server
2. Test the new Orchestration Config page: /admin/orchestration-config
3. Verify System Config page works without obsolete sections
4. Verify AIS Config page works without per-step routing
5. Test orchestration functionality with a sample workflow

Enable orchestration for testing:
*/

-- Enable orchestration (optional - for testing)
-- UPDATE system_settings_config SET value = 'true' WHERE key = 'orchestration_enabled';
-- UPDATE system_settings_config SET value = 'true' WHERE key = 'orchestration_ais_routing_enabled';

/*
Monitor routing decisions:
*/

-- View recent orchestration executions
-- SELECT
--   created_at,
--   entity_id as step_id,
--   details->>'tier' as tier,
--   details->>'model' as model,
--   details->>'routingReason' as reason
-- FROM audit_trail
-- WHERE action = 'ORCHESTRATION_STEP_EXECUTED'
-- ORDER BY created_at DESC
-- LIMIT 10;
