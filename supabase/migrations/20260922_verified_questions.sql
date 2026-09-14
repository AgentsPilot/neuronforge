-- ============================================================================
-- Verified questions — a business teaching the planner its own words.
--
-- The problem this exists for: a quote that is "still open" can be asked about
-- as "פתוחות", "טרם נענו", "ממתינות להחלטה" or "תלוי באוויר", and no list of
-- labels reaches the end of that. Measured over four phrasings of two intents,
-- one of each landed.
--
-- So the phrasings are not enumerated in advance — they are LEARNED from the
-- business itself. Every time someone corrects an answer with one tap, that is
-- a labelled pair: this question, that plan. A few of them, retrieved by
-- similarity and shown to the planner as examples, teach the mapping for
-- wordings nobody wrote down.
--
-- PER TENANT, deliberately. Two Hebrew-speaking businesses phrase the same
-- intent differently, and a plan carries literals — a client's name, a title —
-- that must never appear in another tenant's prompt. Scoping to `user_id`
-- removes that question entirely rather than answering it carefully.
--
-- Distinct from `business_chat_plan_cache`, which SERVES a stored plan for an
-- exact question. This one is never served: it is shown to the model as an
-- example, and the model still plans the question in front of it. That is why
-- similarity is safe here and was not there — a 0.9 match on a cache lookup
-- answers a different question, while a 0.9 match here only illustrates one.
--
-- Date: 2026-09-22
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS business_chat_verified_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  /* What was asked, verbatim, and stripped for de-duplication. */
  question TEXT NOT NULL,
  question_normalized TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'he',

  embedding vector(1536),

  /* The read steps that answered it. No answer sentence: the example teaches
     which rows to fetch, and the wording of the reply is this turn's business. */
  steps JSONB NOT NULL,

  /*
   * How we know it is right.
   *
   *   correction — the user tapped an alternative, which is them saying "that
   *                one, not the one you chose". The strongest signal there is.
   *   accepted   — the answer stood: no rephrasing, no correction. Weaker, and
   *                kept separate so a future review can treat them differently.
   */
  source TEXT NOT NULL CHECK (source IN ('correction', 'accepted')),

  /* How often it has been retrieved as an example. Cheap signal for pruning. */
  uses INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  /* One row per question per tenant: a later verification replaces an earlier. */
  UNIQUE (user_id, question_normalized, language)
);

CREATE INDEX IF NOT EXISTS idx_bcvq_user
  ON business_chat_verified_questions (user_id, language);

/*
 * Lists are small — a tenant's verified questions are counted in dozens — so
 * `lists = 10` is right here and the index mainly keeps the plan stable.
 */
CREATE INDEX IF NOT EXISTS idx_bcvq_embedding
  ON business_chat_verified_questions USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);

ALTER TABLE business_chat_verified_questions ENABLE ROW LEVEL SECURITY;
-- No policy: written and read by the planner through the service role. Nothing
-- user-facing touches it.

-- ----------------------------------------------------------------------------
-- Retrieval.
--
-- A LOWER threshold than the plan cache's 0.92 on purpose: that one decides
-- whether to answer a question with a stored plan, and this one decides whether
-- a question is worth showing as an example. A loosely related example costs a
-- few tokens; a loosely related ANSWER is wrong.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_verified_questions(
  query_embedding vector(1536),
  p_user_id UUID,
  p_language TEXT,
  similarity_threshold DOUBLE PRECISION DEFAULT 0.55,
  result_limit INTEGER DEFAULT 3
)
RETURNS TABLE (
  id UUID,
  question TEXT,
  steps JSONB,
  source TEXT,
  similarity DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    v.id,
    v.question,
    v.steps,
    v.source,
    1 - (v.embedding <=> query_embedding) AS similarity
  FROM business_chat_verified_questions v
  WHERE v.embedding IS NOT NULL
    AND v.user_id = p_user_id
    AND v.language = p_language
    AND 1 - (v.embedding <=> query_embedding) >= similarity_threshold
  ORDER BY v.embedding <=> query_embedding
  LIMIT result_limit;
END;
$$;

REVOKE ALL ON FUNCTION match_verified_questions(vector, UUID, TEXT, DOUBLE PRECISION, INTEGER)
  FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- Use counting.
--
-- An RPC rather than an update per row: this runs on the planning path and must
-- never be a reason a turn is slower. Fire-and-forget from the caller, so a
-- failure here costs a statistic and nothing else.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_verified_question_uses(p_ids UUID[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE business_chat_verified_questions
     SET uses = uses + 1
   WHERE id = ANY(p_ids);
$$;

REVOKE ALL ON FUNCTION increment_verified_question_uses(UUID[]) FROM anon, authenticated;
