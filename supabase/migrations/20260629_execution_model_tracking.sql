-- Migration: Add model/cost tracking fields to agent_executions
-- Purpose: Enable accurate tracking of which models were used and actual costs per execution
-- Date: 2026-06-29

-- Add new columns for model and cost tracking
ALTER TABLE agent_executions
  ADD COLUMN IF NOT EXISTS total_cost_usd DECIMAL(12,6),
  ADD COLUMN IF NOT EXISTS primary_model TEXT,
  ADD COLUMN IF NOT EXISTS primary_provider TEXT,
  ADD COLUMN IF NOT EXISTS models_used JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS routing_tier TEXT CHECK (routing_tier IN ('fast', 'balanced', 'powerful')),
  ADD COLUMN IF NOT EXISTS complexity_score DECIMAL(3,1);

-- Add comment documentation
COMMENT ON COLUMN agent_executions.total_cost_usd IS 'Total cost in USD for all LLM calls during this execution';
COMMENT ON COLUMN agent_executions.primary_model IS 'Primary/most-used model during execution (e.g., gpt-4o, claude-opus-4-5)';
COMMENT ON COLUMN agent_executions.primary_provider IS 'Primary provider during execution (e.g., openai, anthropic)';
COMMENT ON COLUMN agent_executions.models_used IS 'Array of all models used: [{model, provider, tokens, cost}]';
COMMENT ON COLUMN agent_executions.routing_tier IS 'Routing tier used: fast, balanced, or powerful';
COMMENT ON COLUMN agent_executions.complexity_score IS 'Complexity score (0-10) that determined routing tier';

-- Create routing_decisions table for full audit trail
CREATE TABLE IF NOT EXISTS execution_routing_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
  step_id TEXT,
  step_name TEXT,

  -- Routing decision
  selected_model TEXT NOT NULL,
  selected_provider TEXT NOT NULL,
  routing_tier TEXT CHECK (routing_tier IN ('fast', 'balanced', 'powerful')),
  complexity_score DECIMAL(3,1),

  -- Estimates vs actuals
  estimated_cost_usd DECIMAL(12,6),
  estimated_latency_ms INTEGER,
  actual_cost_usd DECIMAL(12,6),
  actual_latency_ms INTEGER,
  actual_tokens_used INTEGER,

  -- Reasoning
  routing_reason TEXT,
  fallback_used BOOLEAN DEFAULT FALSE,
  fallback_reason TEXT,

  -- Timestamps
  decided_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_routing_decisions_execution_id
  ON execution_routing_decisions(execution_id);
CREATE INDEX IF NOT EXISTS idx_routing_decisions_model
  ON execution_routing_decisions(selected_model, selected_provider);
CREATE INDEX IF NOT EXISTS idx_routing_decisions_tier
  ON execution_routing_decisions(routing_tier);

-- Enable RLS
ALTER TABLE execution_routing_decisions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotent migration)
DROP POLICY IF EXISTS "Users can view their execution routing decisions" ON execution_routing_decisions;
DROP POLICY IF EXISTS "Service role can manage routing decisions" ON execution_routing_decisions;

-- RLS policy: users can see routing decisions for their own executions
CREATE POLICY "Users can view their execution routing decisions"
  ON execution_routing_decisions
  FOR SELECT
  USING (
    execution_id IN (
      SELECT id FROM agent_executions WHERE user_id = auth.uid()
    )
  );

-- Service role can insert/update
CREATE POLICY "Service role can manage routing decisions"
  ON execution_routing_decisions
  FOR ALL
  USING (auth.role() = 'service_role');

-- Add comment documentation
COMMENT ON TABLE execution_routing_decisions IS 'Audit trail of model routing decisions per execution step';

-- Create a function to aggregate model usage from token_usage to agent_executions
-- This can be called after execution completes to populate the summary fields
-- Note: Cost calculation respects different input/output token pricing as stored in token_usage.cost_usd
CREATE OR REPLACE FUNCTION aggregate_execution_model_usage(p_execution_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
  v_models_used JSONB;
  v_total_cost DECIMAL(12,6);
  v_total_input_tokens INTEGER;
  v_total_output_tokens INTEGER;
  v_primary_model TEXT;
  v_primary_provider TEXT;
BEGIN
  -- Aggregate model usage from token_usage table
  -- Cost is already correctly calculated per-call with different input/output rates
  SELECT
    jsonb_agg(
      jsonb_build_object(
        'model', model_name,
        'provider', provider,
        'input_tokens', input_tokens_sum,
        'output_tokens', output_tokens_sum,
        'total_tokens', total_tokens,
        'cost', total_cost,
        'calls', call_count
      )
      ORDER BY total_tokens DESC
    ),
    SUM(total_cost),
    SUM(input_tokens_sum),
    SUM(output_tokens_sum),
    (array_agg(model_name ORDER BY total_tokens DESC))[1],
    (array_agg(provider ORDER BY total_tokens DESC))[1]
  INTO v_models_used, v_total_cost, v_total_input_tokens, v_total_output_tokens, v_primary_model, v_primary_provider
  FROM (
    SELECT
      model_name,
      provider,
      SUM(input_tokens) as input_tokens_sum,
      SUM(output_tokens) as output_tokens_sum,
      SUM(input_tokens + output_tokens) as total_tokens,
      SUM(cost_usd) as total_cost,  -- cost_usd already includes correct input/output pricing
      COUNT(*) as call_count
    FROM token_usage
    WHERE execution_id = p_execution_id
    GROUP BY model_name, provider
  ) sub;

  -- Update agent_executions with aggregated data
  UPDATE agent_executions
  SET
    total_cost_usd = COALESCE(v_total_cost, 0),
    primary_model = v_primary_model,
    primary_provider = v_primary_provider,
    models_used = COALESCE(v_models_used, '[]'::jsonb)
  WHERE id = p_execution_id;

  -- Return summary with input/output breakdown
  RETURN jsonb_build_object(
    'total_cost_usd', COALESCE(v_total_cost, 0),
    'total_input_tokens', COALESCE(v_total_input_tokens, 0),
    'total_output_tokens', COALESCE(v_total_output_tokens, 0),
    'primary_model', v_primary_model,
    'primary_provider', v_primary_provider,
    'models_used', COALESCE(v_models_used, '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION aggregate_execution_model_usage IS 'Aggregates model usage from token_usage table and updates agent_executions summary fields';
