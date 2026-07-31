-- Migration: Add command_sessions table for deterministic chat flow
-- This enables stateful conversation handling without re-invoking LLM for confirmations

CREATE TABLE IF NOT EXISTS command_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Capability being executed (e.g., "task.create", "invoice.send")
  capability_id TEXT NOT NULL,

  -- State machine status
  status TEXT NOT NULL DEFAULT 'gathering_params'
    CHECK (status IN ('gathering_params', 'awaiting_confirmation', 'awaiting_choice', 'executing', 'completed', 'cancelled', 'failed')),

  -- Resolved parameters (JSON object)
  resolved_params JSONB NOT NULL DEFAULT '{}',

  -- Parameters still needed (array of param names)
  pending_params TEXT[] NOT NULL DEFAULT '{}',

  -- Current entity context for follow-ups (e.g., "change its name")
  entity_context JSONB,

  -- For disambiguation - pending choices to show user
  pending_choices JSONB,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes',

  -- Last messages for context (minimal, not full history)
  last_user_message TEXT,
  last_assistant_response TEXT
);

-- Index for fast lookup of active sessions
CREATE INDEX IF NOT EXISTS idx_command_sessions_user_active
  ON command_sessions(user_id, status)
  WHERE status NOT IN ('completed', 'cancelled', 'failed');

-- Index for cleanup of expired sessions
CREATE INDEX IF NOT EXISTS idx_command_sessions_expires
  ON command_sessions(expires_at);

-- Enable RLS
ALTER TABLE command_sessions ENABLE ROW LEVEL SECURITY;

-- RLS policy: users can only access their own sessions
CREATE POLICY "Users can only access their own command sessions"
  ON command_sessions FOR ALL
  USING (auth.uid() = user_id);

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_command_session_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trigger_command_sessions_updated_at ON command_sessions;
CREATE TRIGGER trigger_command_sessions_updated_at
  BEFORE UPDATE ON command_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_command_session_updated_at();

-- Add comment for documentation
COMMENT ON TABLE command_sessions IS 'Stores stateful chat command sessions for deterministic flow handling';
COMMENT ON COLUMN command_sessions.capability_id IS 'The capability being executed, e.g., task.create, invoice.send';
COMMENT ON COLUMN command_sessions.status IS 'State machine status: gathering_params → awaiting_confirmation → executing → completed';
COMMENT ON COLUMN command_sessions.resolved_params IS 'Parameters that have been collected and parsed';
COMMENT ON COLUMN command_sessions.pending_params IS 'Parameter names still needed from user';
COMMENT ON COLUMN command_sessions.entity_context IS 'Current entity for follow-up commands like "change its name"';
COMMENT ON COLUMN command_sessions.pending_choices IS 'Choices for disambiguation when multiple entities match';
