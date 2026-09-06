-- Business OS chat — plan cache (L1 exact + L2 semantic)
--
-- ONE table serves both layers deliberately. L2 needs pgvector and therefore
-- must live in Postgres; putting L1 beside it means a single store, a single
-- invalidation path (catalog_version) and a single thing to reason about,
-- instead of a Redis hop with its own failure mode and its own staleness story.
--
-- WHAT IS STORED, AND WHY IT IS SAFE
-- The cached artefact is a PLAN — a query shape — never a result, never rows,
-- never anyone's data. Literals are lifted into slots before storage
-- ("over $100" -> "over <money1>"), so one entry answers a family of questions
-- and no amounts, names or addresses are retained.
--
-- user_id NULL means the entry is portable and shared across tenants. That is
-- only safe because (a) normalize.ts refuses to mark anything portable that
-- names a person or record, and (b) the BizQL compiler injects user_id into
-- every query it builds, so a shared plan still executes strictly within the
-- caller's own scope.
--
-- Depends on: pgvector, already enabled for the help-bot semantic cache.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS business_chat_plan_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL = portable, shared by all tenants. Non-NULL = private to that user.
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Slot-substituted utterance. No raw numbers, emails or quoted strings.
  utterance_normalized TEXT NOT NULL,
  -- sha256(catalog_version | language | utterance_normalized) — the L1 key.
  utterance_hash TEXT NOT NULL,

  language TEXT NOT NULL DEFAULT 'en',
  -- Content hash of the merged catalog. A schema change invalidates everything.
  catalog_version TEXT NOT NULL,

  -- The BizQL plan, with literals still in slot form.
  plan JSONB NOT NULL,
  -- Which slots the plan expects, for rehydration.
  param_slots JSONB NOT NULL DEFAULT '[]',
  -- Entities touched, for targeted inspection and debugging.
  entities TEXT[] NOT NULL DEFAULT '{}',

  embedding vector(1536),

  hit_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  -- A plan that keeps failing must stop being served. See the WHERE clause on
  -- the search function: a bad entry that never expires is worse than a miss.
  failure_count INTEGER NOT NULL DEFAULT 0,

  created_by_model TEXT,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- L1: exact lookup. One row per (hash, scope).
CREATE UNIQUE INDEX IF NOT EXISTS idx_bcpc_hash_scope
  ON business_chat_plan_cache (utterance_hash, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- L2: cosine similarity.
CREATE INDEX IF NOT EXISTS idx_bcpc_embedding
  ON business_chat_plan_cache USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Sweeping stale entries after a catalog change.
CREATE INDEX IF NOT EXISTS idx_bcpc_catalog_version
  ON business_chat_plan_cache (catalog_version);

ALTER TABLE business_chat_plan_cache ENABLE ROW LEVEL SECURITY;

-- A user may read portable entries and their own; never another tenant's.
DROP POLICY IF EXISTS "read own or portable plans" ON business_chat_plan_cache;
CREATE POLICY "read own or portable plans"
  ON business_chat_plan_cache FOR SELECT
  USING (user_id IS NULL OR user_id = auth.uid());

-- =============================================================================
-- L2 semantic search
-- =============================================================================

-- Mirrors search_support_cache_semantic, which has been running in production
-- for the help bot. The threshold default is deliberately HIGHER there: a wrong
-- support answer is merely wrong, whereas a wrong plan queries the wrong thing.
CREATE OR REPLACE FUNCTION search_business_chat_plans_semantic(
  query_embedding vector(1536),
  p_catalog_version TEXT,
  p_language TEXT,
  p_user_id UUID,
  similarity_threshold DOUBLE PRECISION DEFAULT 0.92,
  result_limit INTEGER DEFAULT 1
)
RETURNS TABLE (
  id UUID,
  plan JSONB,
  param_slots JSONB,
  utterance_normalized TEXT,
  similarity DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.plan,
    c.param_slots,
    c.utterance_normalized,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM business_chat_plan_cache c
  WHERE c.embedding IS NOT NULL
    AND c.catalog_version = p_catalog_version
    AND c.language = p_language
    AND (c.user_id IS NULL OR c.user_id = p_user_id)
    -- Never serve a plan that has failed repeatedly and never succeeded.
    AND NOT (c.failure_count >= 2 AND c.success_count = 0)
    AND 1 - (c.embedding <=> query_embedding) >= similarity_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT result_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- Outcome recording
-- =============================================================================

CREATE OR REPLACE FUNCTION record_business_chat_plan_outcome(
  p_id UUID,
  p_success BOOLEAN
)
RETURNS VOID AS $$
BEGIN
  UPDATE business_chat_plan_cache
  SET
    hit_count     = hit_count + 1,
    success_count = success_count + CASE WHEN p_success THEN 1 ELSE 0 END,
    failure_count = failure_count + CASE WHEN p_success THEN 0 ELSE 1 END,
    last_seen     = now()
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE business_chat_plan_cache IS
  'Cached BizQL plans (query shapes, never results). user_id NULL = portable across tenants; safe because the compiler always scopes execution to the caller.';
