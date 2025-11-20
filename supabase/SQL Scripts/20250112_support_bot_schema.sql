-- Migration: Self-Learning Support Bot Schema
-- Creates tables for FAQ articles and response caching with analytics

-- ============================================================================
-- Table: help_articles
-- Purpose: Seed FAQ content for instant, deterministic responses
-- ============================================================================
CREATE TABLE IF NOT EXISTS help_articles (
  id SERIAL PRIMARY KEY,
  topic TEXT NOT NULL,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  body TEXT NOT NULL,
  url TEXT,
  page_context TEXT, -- e.g., '/v2/dashboard', '/v2/agents/new'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast keyword search
CREATE INDEX IF NOT EXISTS idx_help_articles_keywords ON help_articles USING GIN(keywords);
CREATE INDEX IF NOT EXISTS idx_help_articles_page_context ON help_articles(page_context);

-- ============================================================================
-- Table: support_cache
-- Purpose: Auto-learning cache that stores Q&A pairs and tracks popularity
-- ============================================================================
CREATE TABLE IF NOT EXISTS support_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_hash TEXT UNIQUE NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('FAQ', 'Groq', 'Cache')),
  page_context TEXT,
  hit_count INT NOT NULL DEFAULT 1,
  thumbs_up INT NOT NULL DEFAULT 0,
  thumbs_down INT NOT NULL DEFAULT 0,
  user_feedback TEXT[],
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast lookup and analytics
CREATE INDEX IF NOT EXISTS idx_support_cache_hash ON support_cache(question_hash);
CREATE INDEX IF NOT EXISTS idx_support_cache_source ON support_cache(source);
CREATE INDEX IF NOT EXISTS idx_support_cache_hit_count ON support_cache(hit_count DESC);
CREATE INDEX IF NOT EXISTS idx_support_cache_page_context ON support_cache(page_context);
CREATE INDEX IF NOT EXISTS idx_support_cache_last_seen ON support_cache(last_seen DESC);

-- ============================================================================
-- Table: support_analytics
-- Purpose: Track daily metrics for cost and performance monitoring
-- ============================================================================
CREATE TABLE IF NOT EXISTS support_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  total_queries INT NOT NULL DEFAULT 0,
  faq_hits INT NOT NULL DEFAULT 0,
  cache_hits INT NOT NULL DEFAULT 0,
  groq_calls INT NOT NULL DEFAULT 0,
  avg_response_time_ms INT,
  estimated_cost_usd DECIMAL(10, 4) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_analytics_date ON support_analytics(date DESC);

-- ============================================================================
-- Function: Update support_analytics on each query
-- ============================================================================
CREATE OR REPLACE FUNCTION update_support_analytics(
  p_source TEXT,
  p_response_time_ms INT DEFAULT NULL,
  p_cost_usd DECIMAL DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
BEGIN
  -- Upsert daily analytics
  INSERT INTO support_analytics (date, total_queries, faq_hits, cache_hits, groq_calls, avg_response_time_ms, estimated_cost_usd)
  VALUES (
    v_today,
    1,
    CASE WHEN p_source = 'FAQ' THEN 1 ELSE 0 END,
    CASE WHEN p_source = 'Cache' THEN 1 ELSE 0 END,
    CASE WHEN p_source = 'Groq' THEN 1 ELSE 0 END,
    p_response_time_ms,
    COALESCE(p_cost_usd, 0)
  )
  ON CONFLICT (date) DO UPDATE SET
    total_queries = support_analytics.total_queries + 1,
    faq_hits = support_analytics.faq_hits + CASE WHEN p_source = 'FAQ' THEN 1 ELSE 0 END,
    cache_hits = support_analytics.cache_hits + CASE WHEN p_source = 'Cache' THEN 1 ELSE 0 END,
    groq_calls = support_analytics.groq_calls + CASE WHEN p_source = 'Groq' THEN 1 ELSE 0 END,
    avg_response_time_ms = CASE
      WHEN p_response_time_ms IS NOT NULL THEN
        (COALESCE(support_analytics.avg_response_time_ms, 0) * support_analytics.total_queries + p_response_time_ms) / (support_analytics.total_queries + 1)
      ELSE support_analytics.avg_response_time_ms
    END,
    estimated_cost_usd = support_analytics.estimated_cost_usd + COALESCE(p_cost_usd, 0),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Function: Get top unanswered questions (for FAQ promotion)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_top_groq_questions(limit_count INT DEFAULT 20)
RETURNS TABLE (
  question TEXT,
  answer TEXT,
  hit_count INT,
  thumbs_up INT,
  thumbs_down INT,
  last_seen TIMESTAMPTZ,
  page_context TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    sc.question,
    sc.answer,
    sc.hit_count,
    sc.thumbs_up,
    sc.thumbs_down,
    sc.last_seen,
    sc.page_context
  FROM support_cache sc
  WHERE sc.source = 'Groq'
  ORDER BY sc.hit_count DESC, sc.thumbs_up DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- RLS Policies (Security)
-- ============================================================================

-- Public read access to help_articles
ALTER TABLE help_articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Help articles are viewable by everyone"
  ON help_articles FOR SELECT
  USING (true);

-- Support cache is internal only
ALTER TABLE support_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Support cache is internal only"
  ON support_cache FOR ALL
  USING (false);

-- Analytics viewable by authenticated users
ALTER TABLE support_analytics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Analytics viewable by authenticated users"
  ON support_analytics FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================================
-- Comments for documentation
-- ============================================================================
COMMENT ON TABLE help_articles IS 'Curated FAQ articles for instant, deterministic responses';
COMMENT ON TABLE support_cache IS 'Auto-learning cache that stores Q&A pairs with popularity metrics';
COMMENT ON TABLE support_analytics IS 'Daily aggregated metrics for support bot performance and cost tracking';
COMMENT ON FUNCTION update_support_analytics IS 'Updates daily analytics counters for each support query';
COMMENT ON FUNCTION get_top_groq_questions IS 'Returns most popular Groq-answered questions for FAQ promotion';
