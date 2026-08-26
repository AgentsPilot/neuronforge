-- Migration: Add command_sessions table for slot-filling clarification
-- This enables deterministic multi-turn conversations without re-planning

CREATE TABLE IF NOT EXISTS command_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Capability being executed
  capability_id TEXT NOT NULL,  -- e.g., "task.create", "invoice.send"

  -- State machine
  status TEXT NOT NULL DEFAULT 'gathering_params',
  -- Values: 'gathering_params', 'awaiting_confirmation', 'awaiting_choice', 'executing', 'completed', 'cancelled', 'failed'

  -- Resolved parameters (JSON)
  resolved_params JSONB NOT NULL DEFAULT '{}',

  -- Parameters still needed (ordered - first is current)
  pending_params TEXT[] NOT NULL DEFAULT '{}',

  -- Current entity context (for follow-ups like "change its name")
  entity_context JSONB,  -- { type: 'services', id: 'uuid', data: {...} }

  -- For disambiguation
  pending_choices JSONB,  -- [{ id, label, entity }]

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes',

  -- Conversation context (minimal, not full history)
  last_user_message TEXT,
  last_assistant_response TEXT
);

-- Index for fast lookup of active sessions
CREATE INDEX IF NOT EXISTS idx_command_sessions_user_active
  ON command_sessions(user_id, status)
  WHERE status NOT IN ('completed', 'cancelled', 'failed');

-- Index for cleanup of expired sessions
CREATE INDEX IF NOT EXISTS idx_command_sessions_expires ON command_sessions(expires_at);

-- RLS
ALTER TABLE command_sessions ENABLE ROW LEVEL SECURITY;

-- Users can only access their own sessions
CREATE POLICY "Users can only access their own sessions"
  ON command_sessions FOR ALL
  USING (auth.uid() = user_id);

-- Add comment for documentation
COMMENT ON TABLE command_sessions IS 'Stores state for multi-turn command conversations (slot-filling clarification flow)';
COMMENT ON COLUMN command_sessions.capability_id IS 'The capability being executed, e.g., task.create, invoice.send';
COMMENT ON COLUMN command_sessions.resolved_params IS 'Parameters that have been filled by user';
COMMENT ON COLUMN command_sessions.pending_params IS 'Parameters still needed, ordered by priority';
COMMENT ON COLUMN command_sessions.pending_choices IS 'Disambiguation choices when entity resolution returns multiple matches';
