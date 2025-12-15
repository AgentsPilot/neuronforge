-- Migration: Add ai_provider and ai_model columns to agent_prompt_threads
-- Date: 2025-12-14
-- Description: Adds dedicated columns for AI provider and model selection per thread.
--              This ensures consistency throughout the thread lifecycle and prevents
--              mid-thread provider/model changes.
--
-- Background:
-- Previously, ai_provider and ai_model were stored in the metadata JSONB field.
-- Moving them to dedicated columns provides:
--   1. Better data integrity through NOT NULL constraints
--   2. Easier querying and indexing
--   3. Explicit validation that provider/model cannot change mid-thread
--
-- Provider values are validated at application level, not database level

-- Step 1: Add ai_provider column with default 'openai' for backward compatibility
ALTER TABLE public.agent_prompt_threads
ADD COLUMN IF NOT EXISTS ai_provider TEXT NOT NULL DEFAULT 'openai';

-- Step 2: Add ai_model column (no default - will be set on insert)
-- For existing rows, we'll backfill from metadata or use provider defaults
ALTER TABLE public.agent_prompt_threads
ADD COLUMN IF NOT EXISTS ai_model TEXT;

-- Step 3: Backfill ai_model from metadata for existing rows
UPDATE public.agent_prompt_threads
SET ai_model = COALESCE(
  metadata->>'ai_model',
  CASE
    WHEN COALESCE(metadata->>'ai_provider', 'openai') = 'openai' THEN 'gpt-4o'
    WHEN metadata->>'ai_provider' = 'anthropic' THEN 'claude-sonnet-4-5-20250929'
    WHEN metadata->>'ai_provider' = 'kimi' THEN 'kimi-k2-0905-preview'
    ELSE 'gpt-4o'
  END
)
WHERE ai_model IS NULL;

-- Step 4: Backfill ai_provider from metadata for existing rows
UPDATE public.agent_prompt_threads
SET ai_provider = COALESCE(metadata->>'ai_provider', 'openai')
WHERE ai_provider = 'openai' AND metadata->>'ai_provider' IS NOT NULL;

-- Step 5: Make ai_model NOT NULL after backfill
ALTER TABLE public.agent_prompt_threads
ALTER COLUMN ai_model SET NOT NULL;

-- Step 6: Add index for provider/model queries (useful for analytics)
CREATE INDEX IF NOT EXISTS idx_agent_prompt_threads_ai_provider
ON public.agent_prompt_threads(ai_provider);

-- Step 7: Update table comment
COMMENT ON TABLE public.agent_prompt_threads IS 'OpenAI thread state for agent creation flow (phases 1-4) with AI provider/model configuration';

-- Step 8: Add column comments
COMMENT ON COLUMN public.agent_prompt_threads.ai_provider IS 'AI provider for this thread. Cannot change after thread creation.';
COMMENT ON COLUMN public.agent_prompt_threads.ai_model IS 'AI model for this thread. Cannot change after thread creation.';

-- Verification query (uncomment to verify after running):
-- SELECT id, ai_provider, ai_model, metadata->>'ai_provider' as meta_provider, metadata->>'ai_model' as meta_model
-- FROM public.agent_prompt_threads
-- LIMIT 10;