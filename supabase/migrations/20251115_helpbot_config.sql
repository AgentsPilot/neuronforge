-- Migration: Add HelpBot LLM Configuration to system_settings_config
-- Date: 2025-11-15
-- Description: Adds configurable LLM settings for the HelpBot including model selection,
--              temperature, and token limits for both general help and input assistance modes

-- Insert HelpBot configuration settings
INSERT INTO system_settings_config (key, value, category, description, created_at, updated_at)
VALUES
  -- General Help Mode Configuration
  (
    'helpbot_general_model',
    '"llama-3.1-8b-instant"'::jsonb,
    'helpbot',
    'LLM model for general help queries',
    NOW(),
    NOW()
  ),
  (
    'helpbot_general_temperature',
    '0.2'::jsonb,
    'helpbot',
    'Temperature for general help responses (0.0-1.0, lower = more deterministic)',
    NOW(),
    NOW()
  ),
  (
    'helpbot_general_max_tokens',
    '300'::jsonb,
    'helpbot',
    'Maximum tokens for general help responses',
    NOW(),
    NOW()
  ),

  -- Input Help Mode Configuration
  (
    'helpbot_input_model',
    '"llama-3.1-8b-instant"'::jsonb,
    'helpbot',
    'LLM model for input field assistance',
    NOW(),
    NOW()
  ),
  (
    'helpbot_input_temperature',
    '0.3'::jsonb,
    'helpbot',
    'Temperature for input help responses (0.0-1.0, lower = more deterministic)',
    NOW(),
    NOW()
  ),
  (
    'helpbot_input_max_tokens',
    '400'::jsonb,
    'helpbot',
    'Maximum tokens for input help responses',
    NOW(),
    NOW()
  ),

  -- Provider Selection
  (
    'helpbot_provider',
    '"groq"'::jsonb,
    'helpbot',
    'AI provider for helpbot (groq, openai, anthropic)',
    NOW(),
    NOW()
  ),

  -- Feature Flags
  (
    'helpbot_enabled',
    'true'::jsonb,
    'helpbot',
    'Enable/disable the helpbot globally',
    NOW(),
    NOW()
  ),
  (
    'helpbot_cache_enabled',
    'true'::jsonb,
    'helpbot',
    'Enable response caching for faster, cheaper answers',
    NOW(),
    NOW()
  ),
  (
    'helpbot_faq_enabled',
    'true'::jsonb,
    'helpbot',
    'Enable FAQ lookup layer before calling AI',
    NOW(),
    NOW()
  )
ON CONFLICT (key) DO UPDATE
  SET
    value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = NOW();
