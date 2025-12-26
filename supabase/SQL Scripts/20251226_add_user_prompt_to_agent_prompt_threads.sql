-- Migration: Add user_prompt column to agent_prompt_threads
-- Date: 2025-12-26
-- Description: Adds a dedicated column for the user's original prompt for quick context
--              at the table level without needing to parse the metadata JSONB.
--
-- Background:
-- Previously, user_prompt was stored only in the metadata JSONB field.
-- Moving it to a dedicated column provides:
--   1. Quick context when viewing threads without JSON parsing
--   2. Easier querying and filtering by prompt content
--   3. Better visibility in database tools and dashboards
--
-- The column is populated at Phase 1 when the user's prompt is first received.

-- Step 1: Add user_prompt column (nullable since older threads won't have it)
ALTER TABLE public.agent_prompt_threads
ADD COLUMN IF NOT EXISTS user_prompt TEXT;

-- Step 2: Backfill user_prompt from metadata for existing rows
-- The user_prompt is stored in the first iteration (Phase 1) request
-- Path: metadata.iterations[0].request.user_prompt
UPDATE public.agent_prompt_threads
SET user_prompt = metadata->'iterations'->0->'request'->>'user_prompt'
WHERE user_prompt IS NULL
  AND metadata->'iterations'->0->'request'->>'user_prompt' IS NOT NULL;

-- Step 3: Add index for prompt searching (optional, useful for analytics)
CREATE INDEX IF NOT EXISTS idx_agent_prompt_threads_user_prompt
ON public.agent_prompt_threads USING GIN(to_tsvector('english', COALESCE(user_prompt, '')));

-- Step 4: Add column comment
COMMENT ON COLUMN public.agent_prompt_threads.user_prompt IS 'User''s original prompt from Phase 1, for quick context at table level';

-- Verification query (uncomment to verify after running):
-- SELECT
--   id,
--   user_prompt,
--   metadata->>'user_prompt' as meta_user_prompt,
--   current_phase,
--   status,
--   created_at
-- FROM public.agent_prompt_threads
-- ORDER BY created_at DESC
-- LIMIT 20;

-- Summary query (uncomment to see backfill results):
-- SELECT
--   COUNT(*) as total_threads,
--   COUNT(user_prompt) as threads_with_user_prompt,
--   COUNT(*) - COUNT(user_prompt) as threads_without_user_prompt
-- FROM public.agent_prompt_threads;
