-- Add performance indexes for memory system
-- These indexes optimize the most common query patterns

-- Index for loading recent runs by agent (most common query)
-- Pattern: SELECT * FROM run_memories WHERE agent_id = ? ORDER BY run_timestamp DESC
CREATE INDEX IF NOT EXISTS idx_run_memories_agent_timestamp 
  ON run_memories(agent_id, run_timestamp DESC);

-- Index for loading high-importance memories
-- Pattern: SELECT * FROM run_memories WHERE agent_id = ? ORDER BY importance_score DESC
CREATE INDEX IF NOT EXISTS idx_run_memories_agent_importance 
  ON run_memories(agent_id, importance_score DESC);

-- Index for user memory queries (cross-agent preferences)
-- Pattern: SELECT * FROM user_memory WHERE user_id = ? ORDER BY importance DESC
CREATE INDEX IF NOT EXISTS idx_user_memory_user_importance 
  ON user_memory(user_id, importance DESC);

-- Index for finding max run_number (used in get_next_run_number function)
-- Pattern: SELECT MAX(run_number) FROM run_memories WHERE agent_id = ?
CREATE INDEX IF NOT EXISTS idx_run_memories_agent_run_number 
  ON run_memories(agent_id, run_number DESC);

-- Index for cleanup/consolidation queries
-- Pattern: SELECT * FROM run_memories WHERE run_timestamp < ? AND importance_score < ?
CREATE INDEX IF NOT EXISTS idx_run_memories_cleanup 
  ON run_memories(run_timestamp, importance_score);

-- Add comments to document the indexes
COMMENT ON INDEX idx_run_memories_agent_timestamp IS 
  'Optimizes loading recent execution history for an agent';

COMMENT ON INDEX idx_run_memories_agent_importance IS 
  'Optimizes loading high-importance memories for an agent';

COMMENT ON INDEX idx_user_memory_user_importance IS 
  'Optimizes loading user preferences across agents';

COMMENT ON INDEX idx_run_memories_agent_run_number IS 
  'Optimizes finding the max run_number for atomic increment';

COMMENT ON INDEX idx_run_memories_cleanup IS 
  'Optimizes memory consolidation and retention policy cleanup';
