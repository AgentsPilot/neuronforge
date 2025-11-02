-- Create agent_prompt_threads table for OpenAI thread-based agent creation
-- Stores thread state for phases 1-3 (analyze, clarify, enhance)
-- Enables resume capability, audit trail, and TTL-based cleanup

CREATE TABLE IF NOT EXISTS public.agent_prompt_threads (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User identification
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- OpenAI thread reference
  openai_thread_id TEXT NOT NULL UNIQUE,

  -- Thread state
  status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'completed', 'abandoned')) DEFAULT 'active',
  current_phase INTEGER CHECK (current_phase IN (1, 2, 3)) DEFAULT 1,

  -- Agent linkage (populated after agent is created in phase 4)
  agent_id UUID, -- Will reference agents table, but nullable until agent is created

  -- Timestamps and TTL
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'), -- 24-hour TTL

  -- Additional context (optional)
  metadata JSONB DEFAULT '{}'::jsonb -- Store any additional context like user_prompt, analysis, etc.
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_agent_prompt_threads_user_id ON public.agent_prompt_threads(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_prompt_threads_openai_thread_id ON public.agent_prompt_threads(openai_thread_id);
CREATE INDEX IF NOT EXISTS idx_agent_prompt_threads_status ON public.agent_prompt_threads(status);
CREATE INDEX IF NOT EXISTS idx_agent_prompt_threads_created_at ON public.agent_prompt_threads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_prompt_threads_expires_at ON public.agent_prompt_threads(expires_at);
CREATE INDEX IF NOT EXISTS idx_agent_prompt_threads_agent_id ON public.agent_prompt_threads(agent_id);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_agent_prompt_threads_user_status ON public.agent_prompt_threads(user_id, status);

-- GIN index for JSONB searching
CREATE INDEX IF NOT EXISTS idx_agent_prompt_threads_metadata ON public.agent_prompt_threads USING GIN(metadata);

-- Function to update updated_at timestamp automatically
CREATE OR REPLACE FUNCTION update_agent_prompt_threads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER trigger_agent_prompt_threads_updated_at
  BEFORE UPDATE ON public.agent_prompt_threads
  FOR EACH ROW
  EXECUTE FUNCTION update_agent_prompt_threads_updated_at();

-- Function to auto-expire threads based on TTL
CREATE OR REPLACE FUNCTION expire_agent_prompt_threads()
RETURNS void AS $$
BEGIN
  UPDATE public.agent_prompt_threads
  SET status = 'expired'
  WHERE status = 'active'
    AND expires_at < now();
END;
$$ LANGUAGE plpgsql;

-- Enable Row Level Security (RLS)
ALTER TABLE public.agent_prompt_threads ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only view/update their own threads
CREATE POLICY "Users can view their own threads"
  ON public.agent_prompt_threads
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own threads"
  ON public.agent_prompt_threads
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own threads"
  ON public.agent_prompt_threads
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own threads"
  ON public.agent_prompt_threads
  FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policy: Service role can do everything (for backend operations)
CREATE POLICY "Service role has full access"
  ON public.agent_prompt_threads
  FOR ALL
  USING (auth.role() = 'service_role');

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_prompt_threads TO authenticated;
GRANT ALL ON public.agent_prompt_threads TO service_role;

-- Comment on table
COMMENT ON TABLE public.agent_prompt_threads IS 'OpenAI thread state for agent creation flow (phases 1-3: analyze, clarify, enhance)';

-- Comment on columns
COMMENT ON COLUMN public.agent_prompt_threads.id IS 'Unique identifier for the thread record';
COMMENT ON COLUMN public.agent_prompt_threads.user_id IS 'User who owns this thread';
COMMENT ON COLUMN public.agent_prompt_threads.openai_thread_id IS 'OpenAI thread ID from their Threads API';
COMMENT ON COLUMN public.agent_prompt_threads.status IS 'Thread status: active, expired, completed, or abandoned';
COMMENT ON COLUMN public.agent_prompt_threads.current_phase IS 'Current phase: 1 (analyze), 2 (clarify), 3 (enhance)';
COMMENT ON COLUMN public.agent_prompt_threads.agent_id IS 'Linked agent ID after creation (phase 4), nullable until then';
COMMENT ON COLUMN public.agent_prompt_threads.created_at IS 'When the thread was created';
COMMENT ON COLUMN public.agent_prompt_threads.updated_at IS 'When the thread was last updated (auto-updated)';
COMMENT ON COLUMN public.agent_prompt_threads.expires_at IS 'When the thread expires (default 24 hours from creation)';
COMMENT ON COLUMN public.agent_prompt_threads.metadata IS 'Additional context stored as JSONB (user_prompt, analysis, etc.)';
