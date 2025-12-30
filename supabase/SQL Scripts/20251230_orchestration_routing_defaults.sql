-- ============================================================================
-- Orchestration Routing Default Configuration
-- ============================================================================
-- Date: 2025-12-30
-- Purpose: Add default provider and model configuration for orchestration routing
-- Dependencies: system_settings_config table must exist
--
-- This migration adds:
-- - Provider configuration per tier (fast, balanced, powerful)
-- - Model configuration per tier
-- - These values are used by RoutingService.getModelConfig()
-- ============================================================================

-- ============================================================================
-- 1. PROVIDER CONFIGURATION PER TIER
-- ============================================================================

INSERT INTO system_settings_config (key, value, category, description)
VALUES
  (
    'orchestration_routing_provider_fast',
    '"openai"'::jsonb,
    'orchestration_routing',
    'AI provider for fast tier (low complexity tasks)'
  ),
  (
    'orchestration_routing_provider_balanced',
    '"openai"'::jsonb,
    'orchestration_routing',
    'AI provider for balanced tier (medium complexity tasks)'
  ),
  (
    'orchestration_routing_provider_powerful',
    '"openai"'::jsonb,
    'orchestration_routing',
    'AI provider for powerful tier (high complexity tasks)'
  )
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      category = EXCLUDED.category,
      description = EXCLUDED.description;

-- ============================================================================
-- 2. MODEL CONFIGURATION PER TIER
-- ============================================================================

INSERT INTO system_settings_config (key, value, category, description)
VALUES
  (
    'orchestration_routing_model_fast',
    '"gpt-5-nano"'::jsonb,
    'orchestration_routing',
    'Model for fast tier - optimized for speed and cost efficiency'
  ),
  (
    'orchestration_routing_model_balanced',
    '"gpt-5-mini"'::jsonb,
    'orchestration_routing',
    'Model for balanced tier - balance between quality and cost'
  ),
  (
    'orchestration_routing_model_powerful',
    '"gpt-5.2"'::jsonb,
    'orchestration_routing',
    'Model for powerful tier - maximum quality for complex tasks'
  )
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      category = EXCLUDED.category,
      description = EXCLUDED.description;

-- ============================================================================
-- 3. VERIFY INSERTION
-- ============================================================================

-- Display the inserted/updated values
SELECT key, value, category, description
FROM system_settings_config
WHERE key LIKE 'orchestration_routing_provider_%'
   OR key LIKE 'orchestration_routing_model_%'
ORDER BY key;
