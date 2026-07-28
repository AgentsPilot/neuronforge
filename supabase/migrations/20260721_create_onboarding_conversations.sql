-- Onboarding Conversations Table
-- Purpose: Store message-by-message conversation history during onboarding
-- Last Updated: 2026-07-21

CREATE TABLE IF NOT EXISTS onboarding_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,

  -- Message data
  message_sequence INT NOT NULL, -- Order of messages (0, 1, 2, ...)
  role TEXT NOT NULL, -- 'system', 'user', 'assistant'
  content TEXT NOT NULL,

  -- Metadata
  metadata JSONB, -- Language, vertical context, file uploads, etc.

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Row-Level Security
ALTER TABLE onboarding_conversations ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own conversations
CREATE POLICY "Users can view own conversations"
  ON onboarding_conversations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own conversations"
  ON onboarding_conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX idx_onboarding_conversations_user_id ON onboarding_conversations(user_id);
CREATE INDEX idx_onboarding_conversations_user_sequence ON onboarding_conversations(user_id, message_sequence);
CREATE INDEX idx_onboarding_conversations_created_at ON onboarding_conversations(created_at);

-- Comments for documentation
COMMENT ON TABLE onboarding_conversations IS 'Message-by-message conversation history during onboarding chat';
COMMENT ON COLUMN onboarding_conversations.message_sequence IS 'Order of messages starting from 0';
COMMENT ON COLUMN onboarding_conversations.role IS 'Message role: system (instructions), user (input), assistant (AI response)';
COMMENT ON COLUMN onboarding_conversations.metadata IS 'Additional context: language, uploaded files, extracted data';
