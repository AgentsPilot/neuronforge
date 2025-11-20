-- Create user_memory table for cross-agent user preferences and context
-- This stores persistent user preferences that should be remembered across ALL agents

CREATE TABLE IF NOT EXISTS user_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Memory content
  memory_key TEXT NOT NULL, -- e.g., 'timezone', 'communication_style', 'domain_expertise'
  memory_value TEXT NOT NULL, -- e.g., 'EST timezone', 'Prefers concise responses'
  memory_type TEXT NOT NULL CHECK (memory_type IN ('preference', 'context', 'pattern', 'fact')),

  -- Importance and usage
  importance DECIMAL(3,2) DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,

  -- Source tracking
  source TEXT, -- 'manual', 'extracted_from_conversation', 'learned_from_pattern'
  source_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  source_execution_id TEXT,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one key per user
  UNIQUE(user_id, memory_key)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_user_memory_user_id ON user_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_user_memory_importance ON user_memory(user_id, importance DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_memory_type ON user_memory(user_id, memory_type);
CREATE INDEX IF NOT EXISTS idx_user_memory_key ON user_memory(memory_key);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_user_memory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_memory_updated_at
  BEFORE UPDATE ON user_memory
  FOR EACH ROW
  EXECUTE FUNCTION update_user_memory_updated_at();

-- RLS Policies (users can only access their own memories)
ALTER TABLE user_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own memories"
  ON user_memory FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own memories"
  ON user_memory FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own memories"
  ON user_memory FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own memories"
  ON user_memory FOR DELETE
  USING (auth.uid() = user_id);

-- Service role can access all memories
CREATE POLICY "Service role can access all memories"
  ON user_memory FOR ALL
  USING (auth.role() = 'service_role');

-- Sample user memories (commented out - can be added manually)
-- INSERT INTO user_memory (user_id, memory_key, memory_value, memory_type, importance, source) VALUES
-- ('user-uuid-here', 'timezone', 'User operates in EST timezone', 'preference', 0.8, 'manual'),
-- ('user-uuid-here', 'communication_style', 'Prefers concise, bullet-point responses', 'preference', 0.7, 'manual'),
-- ('user-uuid-here', 'domain_expertise', 'Software engineer specializing in full-stack development', 'context', 0.9, 'manual');
