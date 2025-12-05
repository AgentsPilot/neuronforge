-- Create function to search similar memories using pgvector
-- This function is used by MemoryInjector for semantic memory search

-- Enable pgvector extension if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Drop existing function if it exists (to allow changing return type)
DROP FUNCTION IF EXISTS search_similar_memories(vector, uuid, float, int);
DROP FUNCTION IF EXISTS search_similar_memories(vector, uuid, double precision, integer);

-- Create the search_similar_memories function
CREATE OR REPLACE FUNCTION search_similar_memories(
  query_embedding vector(1536),
  query_agent_id uuid,
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  agent_id uuid,
  summary text,
  key_outcomes jsonb,
  patterns_detected jsonb,
  importance_score float,
  similarity float,
  run_timestamp timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    rm.id,
    rm.agent_id,
    rm.summary,
    rm.key_outcomes,
    rm.patterns_detected,
    rm.importance_score,
    1 - (rm.embedding <=> query_embedding) AS similarity,
    rm.run_timestamp
  FROM run_memories rm
  WHERE
    rm.agent_id = query_agent_id
    AND rm.embedding IS NOT NULL
    AND (1 - (rm.embedding <=> query_embedding)) >= match_threshold
  ORDER BY rm.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Add comment to document the function
COMMENT ON FUNCTION search_similar_memories IS
  'Search for semantically similar memories using cosine similarity.
   Uses pgvector <=> operator for cosine distance (1 - similarity).
   Returns memories with similarity >= match_threshold, ordered by similarity.';

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION search_similar_memories TO authenticated;
GRANT EXECUTE ON FUNCTION search_similar_memories TO service_role;
