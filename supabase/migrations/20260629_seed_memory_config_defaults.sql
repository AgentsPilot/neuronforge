-- Seed Memory Config Defaults
-- Phase 1 of Admin UI Controls for Memory System Enhancement
--
-- Purpose: Seed conservative default values for memory configuration
-- Strategy: Admin UI shows generous defaults (4000 tokens),
--           this migration seeds conservative values (800 tokens)
--           so existing behavior matches current implementation

-- Global configuration
INSERT INTO system_settings_config (key, value, category, description)
VALUES
  ('memory_global_enabled', 'true', 'memory', 'Enable/disable entire memory system')
ON CONFLICT (key) DO NOTHING;

-- Injection configuration (conservative defaults)
INSERT INTO system_settings_config (key, value, category, description)
VALUES
  ('memory_injection_max_tokens', '800', 'memory', 'Maximum tokens to inject from memory'),
  ('memory_injection_min_recent_runs', '2', 'memory', 'Minimum recent runs to include'),
  ('memory_injection_max_recent_runs', '5', 'memory', 'Maximum recent runs to include'),
  ('memory_injection_semantic_search_limit', '3', 'memory', 'Number of semantic search results'),
  ('memory_injection_semantic_threshold', '0.7', 'memory', 'Minimum similarity score (0.0-1.0)')
ON CONFLICT (key) DO NOTHING;

-- Summarization configuration
INSERT INTO system_settings_config (key, value, category, description)
VALUES
  ('memory_summarization_model', '"gpt-4o-mini"', 'memory', 'Model to use for summarization'),
  ('memory_summarization_temperature', '0.3', 'memory', 'Model temperature (0.0-2.0)'),
  ('memory_summarization_max_tokens', '500', 'memory', 'Maximum tokens for summary'),
  ('memory_summarization_input_truncate_chars', '300', 'memory', 'Maximum characters of input to include'),
  ('memory_summarization_output_truncate_chars', '400', 'memory', 'Maximum characters of output to include'),
  ('memory_summarization_recent_history_count', '2', 'memory', 'Number of recent runs in history'),
  ('memory_summarization_recent_history_summary_chars', '100', 'memory', 'Maximum characters per historical summary')
ON CONFLICT (key) DO NOTHING;

-- Embedding configuration
INSERT INTO system_settings_config (key, value, category, description)
VALUES
  ('memory_embedding_model', '"text-embedding-3-small"', 'memory', 'Embedding model to use'),
  ('memory_embedding_batch_size', '100', 'memory', 'Number of items to embed in one batch'),
  ('memory_embedding_dimensions', '1536', 'memory', 'Embedding vector dimensions')
ON CONFLICT (key) DO NOTHING;

-- Importance scoring configuration
INSERT INTO system_settings_config (key, value, category, description)
VALUES
  ('memory_importance_base_score', '0.5', 'memory', 'Base importance score (0.0-1.0)'),
  ('memory_importance_error_bonus', '0.3', 'memory', 'Bonus for error-related memories'),
  ('memory_importance_pattern_bonus', '0.2', 'memory', 'Bonus for pattern-related memories'),
  ('memory_importance_user_feedback_bonus', '0.4', 'memory', 'Bonus for user feedback'),
  ('memory_importance_first_run_bonus', '0.1', 'memory', 'Bonus for first-time patterns'),
  ('memory_importance_milestone_bonus', '0.15', 'memory', 'Bonus for milestone achievements')
ON CONFLICT (key) DO NOTHING;

-- Retention policy configuration
INSERT INTO system_settings_config (key, value, category, description)
VALUES
  ('memory_retention_run_memories_days', '90', 'memory', 'Days to retain run memories'),
  ('memory_retention_low_importance_days', '30', 'memory', 'Days to retain low-importance memories'),
  ('memory_retention_consolidation_threshold', '50', 'memory', 'Number of memories before consolidation'),
  ('memory_retention_consolidation_frequency_days', '7', 'memory', 'How often to run consolidation')
ON CONFLICT (key) DO NOTHING;

-- User memory extraction configuration (NEW)
INSERT INTO system_settings_config (key, value, category, description)
VALUES
  ('memory_user_extraction_model', '"gpt-4o-mini"', 'memory', 'Model for user memory extraction'),
  ('memory_user_extraction_temperature', '0.3', 'memory', 'Temperature for extraction'),
  ('memory_user_extraction_max_tokens', '1000', 'memory', 'Maximum tokens for extraction'),
  ('memory_user_extraction_confidence_threshold', '0.7', 'memory', 'Minimum confidence to store memory')
ON CONFLICT (key) DO NOTHING;

-- Remove unused/dead config flags that were in the old schema
-- These were never read by any service:
-- - memory_global_debug_mode (never checked)
-- - memory_summarization_async (always sync)

COMMENT ON TABLE system_settings_config IS 'System-wide configuration settings including memory, insights, and other modules';
