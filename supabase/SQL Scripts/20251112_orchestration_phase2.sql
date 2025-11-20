-- ============================================================================
-- Phase 2: Orchestration Compression & Routing Configuration
-- ============================================================================
-- Date: 2025-11-12
-- Purpose: Add Phase 2 configuration for compression and AIS-based routing
-- Dependencies: 20251111_orchestration_foundation.sql
--
-- This migration adds:
-- - Compression feature flags and settings
-- - AIS routing configuration
-- - Memory compression settings
-- - Model routing tier thresholds
-- ============================================================================

-- ============================================================================
-- 1. COMPRESSION FEATURE FLAGS
-- ============================================================================

INSERT INTO system_settings_config (key, value, category, description, data_type, is_sensitive, created_at, updated_at)
VALUES
  (
    'orchestration_compression_enabled',
    'false'::jsonb,
    'orchestration_compression',
    'Enable content compression for token optimization',
    'boolean',
    false,
    NOW(),
    NOW()
  ),
  (
    'orchestration_ais_routing_enabled',
    'false'::jsonb,
    'orchestration_routing',
    'Enable AIS-based model routing',
    'boolean',
    false,
    NOW(),
    NOW()
  )
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = NOW();

-- ============================================================================
-- 2. COMPRESSION STRATEGIES PER INTENT
-- ============================================================================

-- Compression strategies for each intent type
INSERT INTO system_settings_config (key, value, category, description, data_type, is_sensitive, created_at, updated_at)
VALUES
  ('orchestration_compression_strategy_extract', '"structural"'::jsonb, 'orchestration_compression', 'Compression strategy for extract intent', 'string', false, NOW(), NOW()),
  ('orchestration_compression_strategy_summarize', '"semantic"'::jsonb, 'orchestration_compression', 'Compression strategy for summarize intent', 'string', false, NOW(), NOW()),
  ('orchestration_compression_strategy_generate', '"template"'::jsonb, 'orchestration_compression', 'Compression strategy for generate intent', 'string', false, NOW(), NOW()),
  ('orchestration_compression_strategy_validate', '"structural"'::jsonb, 'orchestration_compression', 'Compression strategy for validate intent', 'string', false, NOW(), NOW()),
  ('orchestration_compression_strategy_send', '"template"'::jsonb, 'orchestration_compression', 'Compression strategy for send intent', 'string', false, NOW(), NOW()),
  ('orchestration_compression_strategy_transform', '"structural"'::jsonb, 'orchestration_compression', 'Compression strategy for transform intent', 'string', false, NOW(), NOW()),
  ('orchestration_compression_strategy_conditional', '"structural"'::jsonb, 'orchestration_compression', 'Compression strategy for conditional intent', 'string', false, NOW(), NOW()),
  ('orchestration_compression_strategy_aggregate', '"structural"'::jsonb, 'orchestration_compression', 'Compression strategy for aggregate intent', 'string', false, NOW(), NOW()),
  ('orchestration_compression_strategy_filter', '"structural"'::jsonb, 'orchestration_compression', 'Compression strategy for filter intent', 'string', false, NOW(), NOW()),
  ('orchestration_compression_strategy_enrich', '"structural"'::jsonb, 'orchestration_compression', 'Compression strategy for enrich intent', 'string', false, NOW(), NOW())
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = NOW();

-- ============================================================================
-- 3. COMPRESSION TARGET RATIOS PER INTENT
-- ============================================================================

-- Target compression ratios (0.3 = 30% reduction)
INSERT INTO system_settings_config (key, value, category, description, data_type, is_sensitive, created_at, updated_at)
VALUES
  ('orchestration_compression_target_ratio_extract', '0.3'::jsonb, 'orchestration_compression', 'Target compression ratio for extract (0.3 = 30% reduction)', 'number', false, NOW(), NOW()),
  ('orchestration_compression_target_ratio_summarize', '0.5'::jsonb, 'orchestration_compression', 'Target compression ratio for summarize', 'number', false, NOW(), NOW()),
  ('orchestration_compression_target_ratio_generate', '0.2'::jsonb, 'orchestration_compression', 'Target compression ratio for generate', 'number', false, NOW(), NOW()),
  ('orchestration_compression_target_ratio_validate', '0.3'::jsonb, 'orchestration_compression', 'Target compression ratio for validate', 'number', false, NOW(), NOW()),
  ('orchestration_compression_target_ratio_send', '0.2'::jsonb, 'orchestration_compression', 'Target compression ratio for send', 'number', false, NOW(), NOW()),
  ('orchestration_compression_target_ratio_transform', '0.3'::jsonb, 'orchestration_compression', 'Target compression ratio for transform', 'number', false, NOW(), NOW()),
  ('orchestration_compression_target_ratio_conditional', '0.4'::jsonb, 'orchestration_compression', 'Target compression ratio for conditional', 'number', false, NOW(), NOW()),
  ('orchestration_compression_target_ratio_aggregate', '0.3'::jsonb, 'orchestration_compression', 'Target compression ratio for aggregate', 'number', false, NOW(), NOW()),
  ('orchestration_compression_target_ratio_filter', '0.4'::jsonb, 'orchestration_compression', 'Target compression ratio for filter', 'number', false, NOW(), NOW()),
  ('orchestration_compression_target_ratio_enrich', '0.3'::jsonb, 'orchestration_compression', 'Target compression ratio for enrich', 'number', false, NOW(), NOW())
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = NOW();

-- ============================================================================
-- 4. COMPRESSION QUALITY THRESHOLDS PER INTENT
-- ============================================================================

-- Minimum quality scores after compression
INSERT INTO system_settings_config (key, value, category, description, data_type, is_sensitive, created_at, updated_at)
VALUES
  ('orchestration_compression_min_quality_extract', '0.85'::jsonb, 'orchestration_compression', 'Minimum quality score for extract compression', 'number', false, NOW(), NOW()),
  ('orchestration_compression_min_quality_summarize', '0.8'::jsonb, 'orchestration_compression', 'Minimum quality score for summarize compression', 'number', false, NOW(), NOW()),
  ('orchestration_compression_min_quality_generate', '0.9'::jsonb, 'orchestration_compression', 'Minimum quality score for generate compression', 'number', false, NOW(), NOW()),
  ('orchestration_compression_min_quality_validate', '0.85'::jsonb, 'orchestration_compression', 'Minimum quality score for validate compression', 'number', false, NOW(), NOW()),
  ('orchestration_compression_min_quality_send', '0.9'::jsonb, 'orchestration_compression', 'Minimum quality score for send compression', 'number', false, NOW(), NOW()),
  ('orchestration_compression_min_quality_transform', '0.85'::jsonb, 'orchestration_compression', 'Minimum quality score for transform compression', 'number', false, NOW(), NOW()),
  ('orchestration_compression_min_quality_conditional', '0.8'::jsonb, 'orchestration_compression', 'Minimum quality score for conditional compression', 'number', false, NOW(), NOW()),
  ('orchestration_compression_min_quality_aggregate', '0.85'::jsonb, 'orchestration_compression', 'Minimum quality score for aggregate compression', 'number', false, NOW(), NOW()),
  ('orchestration_compression_min_quality_filter', '0.8'::jsonb, 'orchestration_compression', 'Minimum quality score for filter compression', 'number', false, NOW(), NOW()),
  ('orchestration_compression_min_quality_enrich', '0.85'::jsonb, 'orchestration_compression', 'Minimum quality score for enrich compression', 'number', false, NOW(), NOW())
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = NOW();

-- ============================================================================
-- 5. COMPRESSION AGGRESSIVENESS PER INTENT
-- ============================================================================

INSERT INTO system_settings_config (key, value, category, description, data_type, is_sensitive, created_at, updated_at)
VALUES
  ('orchestration_compression_aggressiveness_extract', '"low"'::jsonb, 'orchestration_compression', 'Compression aggressiveness for extract (low/medium/high)', 'string', false, NOW(), NOW()),
  ('orchestration_compression_aggressiveness_summarize', '"medium"'::jsonb, 'orchestration_compression', 'Compression aggressiveness for summarize', 'string', false, NOW(), NOW()),
  ('orchestration_compression_aggressiveness_generate', '"low"'::jsonb, 'orchestration_compression', 'Compression aggressiveness for generate', 'string', false, NOW(), NOW()),
  ('orchestration_compression_aggressiveness_validate', '"medium"'::jsonb, 'orchestration_compression', 'Compression aggressiveness for validate', 'string', false, NOW(), NOW()),
  ('orchestration_compression_aggressiveness_send', '"low"'::jsonb, 'orchestration_compression', 'Compression aggressiveness for send', 'string', false, NOW(), NOW()),
  ('orchestration_compression_aggressiveness_transform', '"medium"'::jsonb, 'orchestration_compression', 'Compression aggressiveness for transform', 'string', false, NOW(), NOW()),
  ('orchestration_compression_aggressiveness_conditional', '"high"'::jsonb, 'orchestration_compression', 'Compression aggressiveness for conditional', 'string', false, NOW(), NOW()),
  ('orchestration_compression_aggressiveness_aggregate', '"medium"'::jsonb, 'orchestration_compression', 'Compression aggressiveness for aggregate', 'string', false, NOW(), NOW()),
  ('orchestration_compression_aggressiveness_filter', '"medium"'::jsonb, 'orchestration_compression', 'Compression aggressiveness for filter', 'string', false, NOW(), NOW()),
  ('orchestration_compression_aggressiveness_enrich', '"low"'::jsonb, 'orchestration_compression', 'Compression aggressiveness for enrich', 'string', false, NOW(), NOW())
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = NOW();

-- ============================================================================
-- 6. MEMORY COMPRESSION SETTINGS
-- ============================================================================

INSERT INTO system_settings_config (key, value, category, description, data_type, is_sensitive, created_at, updated_at)
VALUES
  (
    'orchestration_compression_memory_target_ratio',
    '0.3'::jsonb,
    'orchestration_compression',
    'Target compression ratio for memory context (0.3 = 30% reduction)',
    'number',
    false,
    NOW(),
    NOW()
  ),
  (
    'orchestration_compression_memory_min_quality',
    '0.8'::jsonb,
    'orchestration_compression',
    'Minimum quality score for memory compression',
    'number',
    false,
    NOW(),
    NOW()
  ),
  (
    'orchestration_compression_memory_preserve_user',
    'true'::jsonb,
    'orchestration_compression',
    'Always preserve user context (never compress)',
    'boolean',
    false,
    NOW(),
    NOW()
  ),
  (
    'orchestration_compression_memory_preserve_runs',
    '2'::jsonb,
    'orchestration_compression',
    'Number of recent runs to never compress',
    'number',
    false,
    NOW(),
    NOW()
  ),
  (
    'orchestration_compression_memory_strategy',
    '"semantic"'::jsonb,
    'orchestration_compression',
    'Default compression strategy for memory',
    'string',
    false,
    NOW(),
    NOW()
  )
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = NOW();

-- ============================================================================
-- 7. AIS ROUTING TIER THRESHOLDS
-- ============================================================================

-- Agent complexity score thresholds for model tier selection
INSERT INTO system_settings_config (key, value, category, description, data_type, is_sensitive, created_at, updated_at)
VALUES
  (
    'orchestration_routing_fast_tier_max_score',
    '3.0'::jsonb,
    'orchestration_routing',
    'Maximum AIS combined_score for fast tier (Haiku/Flash). Agents with score < 3.0 use fast models',
    'number',
    false,
    NOW(),
    NOW()
  ),
  (
    'orchestration_routing_balanced_tier_max_score',
    '6.5'::jsonb,
    'orchestration_routing',
    'Maximum AIS combined_score for balanced tier (Sonnet). Agents with score 3.0-6.5 use balanced models',
    'number',
    false,
    NOW(),
    NOW()
  )
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = NOW();

-- Note: Agents with score > 6.5 use powerful tier (Opus/o1)

-- ============================================================================
-- 8. MODEL CONFIGURATIONS PER TIER
-- ============================================================================

-- Fast tier (Haiku/Flash) - Low complexity agents
INSERT INTO system_settings_config (key, value, category, description, data_type, is_sensitive, created_at, updated_at)
VALUES
  (
    'orchestration_routing_model_fast',
    '"claude-3-haiku-20240307"'::jsonb,
    'orchestration_routing',
    'Model for fast tier routing',
    'string',
    false,
    NOW(),
    NOW()
  ),
  (
    'orchestration_routing_provider_fast',
    '"anthropic"'::jsonb,
    'orchestration_routing',
    'Provider for fast tier routing',
    'string',
    false,
    NOW(),
    NOW()
  ),
  (
    'orchestration_routing_max_tokens_fast',
    '2048'::jsonb,
    'orchestration_routing',
    'Maximum tokens for fast tier',
    'number',
    false,
    NOW(),
    NOW()
  ),
  (
    'orchestration_routing_temperature_fast',
    '0.7'::jsonb,
    'orchestration_routing',
    'Temperature for fast tier',
    'number',
    false,
    NOW(),
    NOW()
  ),
  (
    'orchestration_routing_cost_per_token_fast',
    '0.00000025'::jsonb,
    'orchestration_routing',
    'Cost per token for fast tier (Haiku: $0.25 per 1M tokens)',
    'number',
    false,
    NOW(),
    NOW()
  )
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = NOW();

-- Balanced tier (Sonnet) - Medium complexity agents
INSERT INTO system_settings_config (key, value, category, description, data_type, is_sensitive, created_at, updated_at)
VALUES
  (
    'orchestration_routing_model_balanced',
    '"gpt-4o-mini"'::jsonb,
    'orchestration_routing',
    'Model for balanced tier routing',
    'string',
    false,
    NOW(),
    NOW()
  ),
  (
    'orchestration_routing_provider_balanced',
    '"openai"'::jsonb,
    'orchestration_routing',
    'Provider for balanced tier routing',
    'string',
    false,
    NOW(),
    NOW()
  ),
  (
    'orchestration_routing_max_tokens_balanced',
    '4096'::jsonb,
    'orchestration_routing',
    'Maximum tokens for balanced tier',
    'number',
    false,
    NOW(),
    NOW()
  ),
  (
    'orchestration_routing_temperature_balanced',
    '0.7'::jsonb,
    'orchestration_routing',
    'Temperature for balanced tier',
    'number',
    false,
    NOW(),
    NOW()
  ),
  (
    'orchestration_routing_cost_per_token_balanced',
    '0.00000015'::jsonb,
    'orchestration_routing',
    'Cost per token for balanced tier (GPT-4o-mini: $0.15 per 1M tokens)',
    'number',
    false,
    NOW(),
    NOW()
  )
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = NOW();

-- Powerful tier (Opus/o1) - High complexity agents
INSERT INTO system_settings_config (key, value, category, description, data_type, is_sensitive, created_at, updated_at)
VALUES
  (
    'orchestration_routing_model_powerful',
    '"claude-3-5-sonnet-20241022"'::jsonb,
    'orchestration_routing',
    'Model for powerful tier routing',
    'string',
    false,
    NOW(),
    NOW()
  ),
  (
    'orchestration_routing_provider_powerful',
    '"anthropic"'::jsonb,
    'orchestration_routing',
    'Provider for powerful tier routing',
    'string',
    false,
    NOW(),
    NOW()
  ),
  (
    'orchestration_routing_max_tokens_powerful',
    '8192'::jsonb,
    'orchestration_routing',
    'Maximum tokens for powerful tier',
    'number',
    false,
    NOW(),
    NOW()
  ),
  (
    'orchestration_routing_temperature_powerful',
    '0.7'::jsonb,
    'orchestration_routing',
    'Temperature for powerful tier',
    'number',
    false,
    NOW(),
    NOW()
  ),
  (
    'orchestration_routing_cost_per_token_powerful',
    '0.000003'::jsonb,
    'orchestration_routing',
    'Cost per token for powerful tier (Sonnet: $3 per 1M tokens)',
    'number',
    false,
    NOW(),
    NOW()
  )
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = NOW();

-- ============================================================================
-- SUMMARY
-- ============================================================================

-- Total configuration keys added in Phase 2:
-- - 2 feature flags (compression, routing)
-- - 10 compression strategies (per intent)
-- - 10 compression target ratios (per intent)
-- - 10 compression quality thresholds (per intent)
-- - 10 compression aggressiveness settings (per intent)
-- - 5 memory compression settings
-- - 2 AIS routing thresholds
-- - 15 model configurations (5 per tier × 3 tiers)
-- = 64 configuration keys total

-- These can all be managed via the admin UI when implemented
