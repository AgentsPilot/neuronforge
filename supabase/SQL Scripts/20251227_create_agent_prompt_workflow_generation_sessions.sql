-- ============================================================================
-- Migration: Create agent_prompt_workflow_generation_sessions table
-- Purpose: Track V5 Workflow Generator pipeline stages (System 2)
-- Links to: agent_prompt_threads (System 1) via openai_thread_id
-- Date: 2025-12-27
-- ============================================================================

-- Create the table
CREATE TABLE IF NOT EXISTS agent_prompt_workflow_generation_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Link to System 1 (thread) via openai_thread_id for log correlation
  -- Not a FK since we store the string ID, not the internal UUID
  openai_thread_id TEXT,

  -- Link to agents table (set after agent is created)
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,

  -- Input tracking
  input_path TEXT NOT NULL CHECK (input_path IN ('enhanced_prompt', 'technical_workflow')),
  input_data JSONB NOT NULL,

  -- Pipeline stages (the diary) - array of WorkflowGenerationStage objects
  stages JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Final output
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'failed', 'blocked')),
  output_dsl JSONB,                -- PILOT_DSL schema (if successful)
  error TEXT,                      -- Error message (if failed)
  blocking_issues JSONB,           -- From feasibility check (if blocked)

  -- Reviewer provider/model (the main LLM stage)
  -- Each stage also tracks its own provider/model in llm_call for detailed tracking
  reviewer_ai_provider TEXT NOT NULL,
  reviewer_ai_model TEXT NOT NULL,

  -- Aggregate metrics
  total_input_tokens INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ============================================================================
-- Auto-update updated_at trigger
-- ============================================================================

-- Create the trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS trigger_apwgs_updated_at ON agent_prompt_workflow_generation_sessions;
CREATE TRIGGER trigger_apwgs_updated_at
  BEFORE UPDATE ON agent_prompt_workflow_generation_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Indexes for common query patterns
-- ============================================================================

-- User's sessions (for listing/history)
CREATE INDEX IF NOT EXISTS idx_apwgs_user_id
  ON agent_prompt_workflow_generation_sessions(user_id);

-- Find session by thread (correlate with System 1)
CREATE INDEX IF NOT EXISTS idx_apwgs_openai_thread_id
  ON agent_prompt_workflow_generation_sessions(openai_thread_id);

-- Find session by agent (after agent creation)
CREATE INDEX IF NOT EXISTS idx_apwgs_agent_id
  ON agent_prompt_workflow_generation_sessions(agent_id);

-- Filter by status (find failed/blocked sessions)
CREATE INDEX IF NOT EXISTS idx_apwgs_status
  ON agent_prompt_workflow_generation_sessions(status);

-- Order by created_at (recent sessions first)
CREATE INDEX IF NOT EXISTS idx_apwgs_created_at
  ON agent_prompt_workflow_generation_sessions(created_at DESC);

-- Composite index for user + status queries
CREATE INDEX IF NOT EXISTS idx_apwgs_user_status
  ON agent_prompt_workflow_generation_sessions(user_id, status);

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

-- Enable RLS
ALTER TABLE agent_prompt_workflow_generation_sessions ENABLE ROW LEVEL SECURITY;

-- Users can only see their own sessions
CREATE POLICY "Users can view own workflow generation sessions"
  ON agent_prompt_workflow_generation_sessions
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own sessions
CREATE POLICY "Users can insert own workflow generation sessions"
  ON agent_prompt_workflow_generation_sessions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own sessions
CREATE POLICY "Users can update own workflow generation sessions"
  ON agent_prompt_workflow_generation_sessions
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Service role can do everything (for backend API calls)
CREATE POLICY "Service role has full access to workflow generation sessions"
  ON agent_prompt_workflow_generation_sessions
  FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================================
-- Comments for documentation
-- ============================================================================

COMMENT ON TABLE agent_prompt_workflow_generation_sessions IS
  'Tracks V5 Workflow Generator pipeline stages. Links to agent_prompt_threads (System 1) via openai_thread_id.';

COMMENT ON COLUMN agent_prompt_workflow_generation_sessions.openai_thread_id IS
  'OpenAI thread ID from System 1 (agent_prompt_threads) for log correlation. Not a FK since it''s a string ID.';

COMMENT ON COLUMN agent_prompt_workflow_generation_sessions.input_path IS
  'Which V5 Generator path was used: enhanced_prompt (Path A) or technical_workflow (Path B)';

COMMENT ON COLUMN agent_prompt_workflow_generation_sessions.stages IS
  'JSONB array of WorkflowGenerationStage objects tracking each pipeline stage';

COMMENT ON COLUMN agent_prompt_workflow_generation_sessions.output_dsl IS
  'Final PILOT_DSL output (only set when status = completed)';

COMMENT ON COLUMN agent_prompt_workflow_generation_sessions.blocking_issues IS
  'Array of blocking issues from feasibility check (only set when status = blocked)';

COMMENT ON COLUMN agent_prompt_workflow_generation_sessions.reviewer_ai_provider IS
  'AI provider used for the reviewer stage (main LLM call). Each stage also tracks its own in llm_call.';

COMMENT ON COLUMN agent_prompt_workflow_generation_sessions.reviewer_ai_model IS
  'AI model used for the reviewer stage (main LLM call). Each stage also tracks its own in llm_call.';

COMMENT ON COLUMN agent_prompt_workflow_generation_sessions.updated_at IS
  'Auto-updated on every modification via trigger';
