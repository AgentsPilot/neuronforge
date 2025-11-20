-- Migration: Add Semantic Search Configuration to system_settings_config
-- Date: 2025-11-15
-- Description: Adds configurable settings for semantic search including embedding model,
--              similarity thresholds, and feature flags

-- Insert Semantic Search configuration settings
INSERT INTO system_settings_config (key, value, category, description, created_at, updated_at)
VALUES
  -- Embedding Model Configuration
  (
    'helpbot_embedding_model',
    '"text-embedding-3-small"'::jsonb,
    'helpbot',
    'OpenAI embedding model for semantic search (text-embedding-3-small = 1536 dims)',
    NOW(),
    NOW()
  ),
  (
    'helpbot_embedding_dimensions',
    '1536'::jsonb,
    'helpbot',
    'Embedding vector dimensions (must match model: text-embedding-3-small = 1536)',
    NOW(),
    NOW()
  ),

  -- Semantic Search Thresholds
  (
    'helpbot_semantic_threshold',
    '0.85'::jsonb,
    'helpbot',
    'Minimum cosine similarity score for semantic cache hits (0.0-1.0, higher = stricter)',
    NOW(),
    NOW()
  ),
  (
    'helpbot_semantic_faq_threshold',
    '0.80'::jsonb,
    'helpbot',
    'Minimum cosine similarity score for FAQ semantic matches (0.0-1.0)',
    NOW(),
    NOW()
  ),

  -- Feature Flags
  (
    'helpbot_semantic_search_enabled',
    'true'::jsonb,
    'helpbot',
    'Enable semantic search for better question matching',
    NOW(),
    NOW()
  ),
  (
    'helpbot_hybrid_search_enabled',
    'true'::jsonb,
    'helpbot',
    'Use hybrid search (exact hash + semantic) for best accuracy',
    NOW(),
    NOW()
  ),

  -- Auto-Promotion Settings
  (
    'helpbot_auto_promote_enabled',
    'false'::jsonb,
    'helpbot',
    'Enable automatic promotion of popular cached answers to FAQ',
    NOW(),
    NOW()
  ),
  (
    'helpbot_auto_promote_threshold',
    '10'::jsonb,
    'helpbot',
    'Minimum hit_count required for auto-promotion consideration',
    NOW(),
    NOW()
  ),
  (
    'helpbot_auto_promote_min_thumbs_up',
    '3'::jsonb,
    'helpbot',
    'Minimum positive feedback (thumbs_up) required for auto-promotion',
    NOW(),
    NOW()
  ),

  -- Cost Tracking
  (
    'helpbot_embedding_cost_per_1k_tokens',
    '0.00002'::jsonb,
    'helpbot',
    'Cost per 1,000 tokens for embedding generation (OpenAI text-embedding-3-small pricing)',
    NOW(),
    NOW()
  ),

  -- Performance Tuning
  (
    'helpbot_semantic_cache_max_results',
    '1'::jsonb,
    'helpbot',
    'Maximum number of semantic search results to return from cache',
    NOW(),
    NOW()
  ),
  (
    'helpbot_semantic_faq_max_results',
    '3'::jsonb,
    'helpbot',
    'Maximum number of semantic search results to return from FAQ',
    NOW(),
    NOW()
  )
ON CONFLICT (key) DO UPDATE
  SET
    value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = NOW();
