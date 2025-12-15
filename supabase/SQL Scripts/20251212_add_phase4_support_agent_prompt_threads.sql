-- Migration: Add Phase 4 support to agent_prompt_threads table
-- Date: 2025-12-12
-- Description: Updates the current_phase check constraint to allow Phase 4 (Technical Workflow Generation)
--
-- Background:
-- Phase 4 is a "compilation step" that converts the functional specification (Phase 3's enhanced_prompt)
-- into an executable technical workflow. It maps each step to real plugin actions with validated parameters.
--
-- Phases:
--   1 = Analyze (diagnostic narrative)
--   2 = Clarify (clarification questions)
--   3 = Enhance (enhanced prompt generation)
--   4 = Technical Workflow (NEW - compile to executable workflow)

-- Step 1: Drop the existing check constraint on current_phase
-- The constraint name is auto-generated as: agent_prompt_threads_current_phase_check
ALTER TABLE public.agent_prompt_threads
DROP CONSTRAINT IF EXISTS agent_prompt_threads_current_phase_check;

-- Step 2: Add new check constraint that includes Phase 4
ALTER TABLE public.agent_prompt_threads
ADD CONSTRAINT agent_prompt_threads_current_phase_check
CHECK (current_phase IN (1, 2, 3, 4));

-- Step 3: Update table comment to reflect Phase 4
COMMENT ON TABLE public.agent_prompt_threads IS 'OpenAI thread state for agent creation flow (phases 1-4: analyze, clarify, enhance, technical workflow)';

-- Step 4: Update column comment to include Phase 4 description
COMMENT ON COLUMN public.agent_prompt_threads.current_phase IS 'Current phase: 1 (analyze), 2 (clarify), 3 (enhance), 4 (technical workflow)';

-- Verification query (uncomment to verify after running):
-- SELECT
--   conname AS constraint_name,
--   pg_get_constraintdef(oid) AS constraint_definition
-- FROM pg_constraint
-- WHERE conrelid = 'public.agent_prompt_threads'::regclass
--   AND conname = 'agent_prompt_threads_current_phase_check';