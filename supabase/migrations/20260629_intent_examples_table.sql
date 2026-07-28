-- Intent Examples Table
-- Phase 7 of Memory System Enhancement: V6 Learning
--
-- Purpose: Store successful intent → workflow examples for few-shot learning.
-- Used to improve V6 generation by providing relevant examples.
--
-- PRIVACY: User inputs are normalized (no PII). Only structural patterns stored.

CREATE TABLE IF NOT EXISTS intent_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Input normalization (for deduplication and privacy)
  user_input_hash TEXT NOT NULL,            -- SHA256 hash for deduplication
  user_input_normalized TEXT NOT NULL,      -- PII-stripped, normalized input

  -- Generated artifacts
  intent_contract JSONB NOT NULL,           -- The successful IntentContract
  plugin_set TEXT[] NOT NULL,               -- Plugins used in workflow

  -- Workflow pattern (links to workflow_patterns for similarity)
  workflow_pattern_hash TEXT,               -- Hash of plugin sequence

  -- Quality metrics
  success_rate DECIMAL(5,4) DEFAULT 1.0,    -- Post-generation execution success
  calibration_iterations INTEGER DEFAULT 1, -- How many iterations to production
  token_usage INTEGER,                      -- Tokens used for generation

  -- Usage tracking
  usage_count INTEGER DEFAULT 0,            -- How often used as example
  last_used_at TIMESTAMP WITH TIME ZONE,

  -- Quality flags
  is_high_quality BOOLEAN DEFAULT TRUE,     -- Marked as good example
  is_curated BOOLEAN DEFAULT FALSE,         -- Manually reviewed
  quality_score DECIMAL(5,4),               -- Computed quality score

  -- Metadata
  category TEXT,                            -- "crm", "notification", "data-sync"
  complexity TEXT DEFAULT 'standard',       -- "simple", "standard", "complex"
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for semantic/similarity lookup
CREATE INDEX IF NOT EXISTS idx_intent_examples_hash
ON intent_examples(user_input_hash);

-- Index for plugin-based lookup
CREATE INDEX IF NOT EXISTS idx_intent_examples_plugins
ON intent_examples USING GIN (plugin_set);

-- Index for high-quality examples
CREATE INDEX IF NOT EXISTS idx_intent_examples_quality
ON intent_examples(is_high_quality, quality_score DESC)
WHERE is_high_quality = TRUE;

-- Index for category filtering
CREATE INDEX IF NOT EXISTS idx_intent_examples_category
ON intent_examples(category, quality_score DESC);

-- Comments
COMMENT ON TABLE intent_examples IS 'Successful intent → workflow examples for V6 few-shot learning';
COMMENT ON COLUMN intent_examples.user_input_normalized IS 'PII-stripped input for display in prompts';
COMMENT ON COLUMN intent_examples.intent_contract IS 'The IntentContract that was successfully generated';
COMMENT ON COLUMN intent_examples.quality_score IS 'Computed from success_rate, calibration_iterations, and usage_count';

-- ============================================================
-- Helper Functions
-- ============================================================

-- Function to upsert an intent example (called after successful calibration)
CREATE OR REPLACE FUNCTION upsert_intent_example(
  p_user_input_normalized TEXT,
  p_intent_contract JSONB,
  p_plugin_set TEXT[],
  p_calibration_iterations INTEGER DEFAULT 1,
  p_token_usage INTEGER DEFAULT 0,
  p_category TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
  v_hash TEXT;
  v_existing RECORD;
  v_complexity TEXT;
  v_quality_score DECIMAL;
BEGIN
  -- Generate hash from normalized input
  v_hash := encode(sha256(p_user_input_normalized::bytea), 'hex');

  -- Determine complexity based on plugin count
  IF array_length(p_plugin_set, 1) <= 2 THEN
    v_complexity := 'simple';
  ELSIF array_length(p_plugin_set, 1) <= 4 THEN
    v_complexity := 'standard';
  ELSE
    v_complexity := 'complex';
  END IF;

  -- Calculate initial quality score (higher is better)
  -- Based on: fewer calibration iterations = better
  v_quality_score := GREATEST(0, 1.0 - (p_calibration_iterations - 1) * 0.2);

  -- Try to get existing example
  SELECT id, usage_count, success_rate, calibration_iterations
  INTO v_existing
  FROM intent_examples
  WHERE user_input_hash = v_hash
  FOR UPDATE;

  IF FOUND THEN
    -- Update existing example
    UPDATE intent_examples
    SET
      intent_contract = p_intent_contract,
      plugin_set = p_plugin_set,
      calibration_iterations = LEAST(v_existing.calibration_iterations, p_calibration_iterations),
      token_usage = p_token_usage,
      category = COALESCE(p_category, category),
      complexity = v_complexity,
      quality_score = v_quality_score,
      updated_at = NOW()
    WHERE id = v_existing.id
    RETURNING id INTO v_id;
  ELSE
    -- Insert new example
    INSERT INTO intent_examples (
      user_input_hash, user_input_normalized, intent_contract,
      plugin_set, calibration_iterations, token_usage,
      category, complexity, quality_score
    )
    VALUES (
      v_hash, p_user_input_normalized, p_intent_contract,
      p_plugin_set, p_calibration_iterations, p_token_usage,
      p_category, v_complexity, v_quality_score
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to find similar intent examples (for few-shot learning)
CREATE OR REPLACE FUNCTION find_similar_intent_examples(
  p_plugins TEXT[],
  p_category TEXT DEFAULT NULL,
  p_complexity TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 3
)
RETURNS TABLE (
  id UUID,
  user_input_normalized TEXT,
  intent_contract JSONB,
  plugin_set TEXT[],
  quality_score DECIMAL,
  similarity DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ie.id,
    ie.user_input_normalized,
    ie.intent_contract,
    ie.plugin_set,
    ie.quality_score,
    -- Calculate Jaccard similarity
    (
      SELECT COUNT(*)::DECIMAL FROM (
        SELECT unnest(ie.plugin_set) INTERSECT SELECT unnest(p_plugins)
      ) common
    ) / GREATEST(
      (SELECT COUNT(*)::DECIMAL FROM (
        SELECT unnest(ie.plugin_set) UNION SELECT unnest(p_plugins)
      ) total),
      1
    ) AS similarity
  FROM intent_examples ie
  WHERE ie.is_high_quality = TRUE
    AND ie.plugin_set && p_plugins  -- At least one common plugin
    AND (p_category IS NULL OR ie.category = p_category)
    AND (p_complexity IS NULL OR ie.complexity = p_complexity)
  ORDER BY
    similarity DESC,
    ie.quality_score DESC,
    ie.usage_count DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to record usage of an example (for tracking effectiveness)
CREATE OR REPLACE FUNCTION record_intent_example_usage(
  p_example_id UUID,
  p_success BOOLEAN
)
RETURNS VOID AS $$
DECLARE
  v_existing RECORD;
  v_new_success_rate DECIMAL;
BEGIN
  SELECT usage_count, success_rate
  INTO v_existing
  FROM intent_examples
  WHERE id = p_example_id
  FOR UPDATE;

  IF FOUND THEN
    -- Update running average success rate
    v_new_success_rate := (v_existing.success_rate * v_existing.usage_count + CASE WHEN p_success THEN 1 ELSE 0 END)
                          / (v_existing.usage_count + 1);

    UPDATE intent_examples
    SET
      usage_count = v_existing.usage_count + 1,
      success_rate = v_new_success_rate,
      last_used_at = NOW(),
      -- Recalculate quality score
      quality_score = v_new_success_rate * 0.7 + LEAST(1.0, v_existing.usage_count / 10.0) * 0.3,
      -- Mark as low quality if success rate drops below threshold
      is_high_quality = v_new_success_rate >= 0.6,
      updated_at = NOW()
    WHERE id = p_example_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
