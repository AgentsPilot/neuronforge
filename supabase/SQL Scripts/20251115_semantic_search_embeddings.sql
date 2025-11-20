-- Migration: Add Semantic Search with Vector Embeddings
-- Date: 2025-11-15
-- Description: Adds pgvector extension and embedding columns for semantic similarity search
--              This enables the HelpBot to match similar questions even with different wording

-- ============================================================================
-- Enable pgvector extension
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- Add embedding column to support_cache
-- ============================================================================
-- Using 1536 dimensions for OpenAI text-embedding-3-small model
ALTER TABLE support_cache
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Create index for fast similarity search
CREATE INDEX IF NOT EXISTS idx_support_cache_embedding
  ON support_cache
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ============================================================================
-- Add embedding column to help_articles
-- ============================================================================
ALTER TABLE help_articles
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Create index for fast similarity search
CREATE INDEX IF NOT EXISTS idx_help_articles_embedding
  ON help_articles
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ============================================================================
-- Update support_analytics to track semantic search performance
-- ============================================================================
ALTER TABLE support_analytics
  ADD COLUMN IF NOT EXISTS semantic_cache_hits INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exact_cache_hits INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS embedding_generation_cost_usd DECIMAL(10, 6) DEFAULT 0;

-- ============================================================================
-- Function: Semantic search in support_cache
-- ============================================================================
CREATE OR REPLACE FUNCTION search_support_cache_semantic(
  query_embedding vector(1536),
  similarity_threshold FLOAT DEFAULT 0.85,
  result_limit INT DEFAULT 1,
  p_page_context TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  question TEXT,
  answer TEXT,
  source TEXT,
  hit_count INT,
  similarity FLOAT,
  page_context TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    sc.id,
    sc.question,
    sc.answer,
    sc.source,
    sc.hit_count,
    1 - (sc.embedding <=> query_embedding) AS similarity,
    sc.page_context
  FROM support_cache sc
  WHERE
    sc.embedding IS NOT NULL
    AND (p_page_context IS NULL OR sc.page_context = p_page_context)
    AND (1 - (sc.embedding <=> query_embedding)) >= similarity_threshold
  ORDER BY sc.embedding <=> query_embedding
  LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Function: Semantic search in help_articles
-- ============================================================================
CREATE OR REPLACE FUNCTION search_help_articles_semantic(
  query_embedding vector(1536),
  similarity_threshold FLOAT DEFAULT 0.85,
  result_limit INT DEFAULT 3,
  p_page_context TEXT DEFAULT NULL
)
RETURNS TABLE (
  id INT,
  topic TEXT,
  body TEXT,
  url TEXT,
  similarity FLOAT,
  page_context TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ha.id,
    ha.topic,
    ha.body,
    ha.url,
    1 - (ha.embedding <=> query_embedding) AS similarity,
    ha.page_context
  FROM help_articles ha
  WHERE
    ha.embedding IS NOT NULL
    AND (p_page_context IS NULL OR ha.page_context = p_page_context)
    AND (1 - (ha.embedding <=> query_embedding)) >= similarity_threshold
  ORDER BY ha.embedding <=> query_embedding
  LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Function: Update support_analytics for semantic search
-- ============================================================================
CREATE OR REPLACE FUNCTION update_support_analytics_semantic(
  p_source TEXT,
  p_is_semantic_hit BOOLEAN DEFAULT false,
  p_is_exact_hit BOOLEAN DEFAULT false,
  p_response_time_ms INT DEFAULT NULL,
  p_cost_usd DECIMAL DEFAULT NULL,
  p_embedding_cost_usd DECIMAL DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
BEGIN
  -- Upsert daily analytics with semantic tracking
  INSERT INTO support_analytics (
    date,
    total_queries,
    faq_hits,
    cache_hits,
    semantic_cache_hits,
    exact_cache_hits,
    groq_calls,
    avg_response_time_ms,
    estimated_cost_usd,
    embedding_generation_cost_usd
  )
  VALUES (
    v_today,
    1,
    CASE WHEN p_source = 'FAQ' THEN 1 ELSE 0 END,
    CASE WHEN p_source = 'Cache' THEN 1 ELSE 0 END,
    CASE WHEN p_is_semantic_hit THEN 1 ELSE 0 END,
    CASE WHEN p_is_exact_hit THEN 1 ELSE 0 END,
    CASE WHEN p_source = 'Groq' THEN 1 ELSE 0 END,
    p_response_time_ms,
    COALESCE(p_cost_usd, 0),
    COALESCE(p_embedding_cost_usd, 0)
  )
  ON CONFLICT (date) DO UPDATE SET
    total_queries = support_analytics.total_queries + 1,
    faq_hits = support_analytics.faq_hits + CASE WHEN p_source = 'FAQ' THEN 1 ELSE 0 END,
    cache_hits = support_analytics.cache_hits + CASE WHEN p_source = 'Cache' THEN 1 ELSE 0 END,
    semantic_cache_hits = support_analytics.semantic_cache_hits + CASE WHEN p_is_semantic_hit THEN 1 ELSE 0 END,
    exact_cache_hits = support_analytics.exact_cache_hits + CASE WHEN p_is_exact_hit THEN 1 ELSE 0 END,
    groq_calls = support_analytics.groq_calls + CASE WHEN p_source = 'Groq' THEN 1 ELSE 0 END,
    avg_response_time_ms = CASE
      WHEN p_response_time_ms IS NOT NULL THEN
        (COALESCE(support_analytics.avg_response_time_ms, 0) * support_analytics.total_queries + p_response_time_ms) / (support_analytics.total_queries + 1)
      ELSE support_analytics.avg_response_time_ms
    END,
    estimated_cost_usd = support_analytics.estimated_cost_usd + COALESCE(p_cost_usd, 0),
    embedding_generation_cost_usd = support_analytics.embedding_generation_cost_usd + COALESCE(p_embedding_cost_usd, 0),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Comments for documentation
-- ============================================================================
COMMENT ON COLUMN support_cache.embedding IS 'Vector embedding (1536-dim) for semantic similarity search using OpenAI text-embedding-3-small';
COMMENT ON COLUMN help_articles.embedding IS 'Vector embedding (1536-dim) for semantic similarity search using OpenAI text-embedding-3-small';
COMMENT ON FUNCTION search_support_cache_semantic IS 'Semantic similarity search in cached Q&A pairs using cosine similarity';
COMMENT ON FUNCTION search_help_articles_semantic IS 'Semantic similarity search in FAQ articles using cosine similarity';
COMMENT ON FUNCTION update_support_analytics_semantic IS 'Enhanced analytics tracking with semantic vs exact cache hit differentiation';
