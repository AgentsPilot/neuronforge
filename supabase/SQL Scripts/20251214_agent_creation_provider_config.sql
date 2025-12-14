-- Migration: Add Agent Creation AI Provider Configuration
-- Date: 2025-12-14
-- Description: Adds system settings for AI provider and model used in the
--              thread-based agent creation flow (v2/agents/new).
--
-- These settings define the default provider and model for all agent creation
-- threads. Client fetches these values and passes them to init-thread API.

INSERT INTO system_settings_config (key, value, category, description, created_at, updated_at)
VALUES
  (
    'agent_creation_ai_provider',
    '"openai"'::jsonb,
    'agent_creation',
    'AI provider for agent creation flow (openai, anthropic, kimi)',
    NOW(),
    NOW()
  ),
  (
    'agent_creation_ai_model',
    '"gpt-5.2"'::jsonb,
    'agent_creation',
    'AI model for agent creation flow (e.g., gpt-5.2, claude-sonnet-4-5-20250929, kimi-k2-0905-preview)',
    NOW(),
    NOW()
  )
ON CONFLICT (key) DO UPDATE
  SET
    value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = NOW();

-- Verification query (uncomment to verify after running):
-- SELECT key, value, category, description
-- FROM system_settings_config
-- WHERE category = 'agent_creation';