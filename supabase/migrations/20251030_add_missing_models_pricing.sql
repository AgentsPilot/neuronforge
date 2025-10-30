-- Add missing AI models to ai_model_pricing table
-- Date: 2025-10-30
-- Purpose: Add GPT-4o-mini and Claude-3-Haiku variant for intelligent routing

-- Add gpt-4o-mini (cost-efficient OpenAI model)
INSERT INTO ai_model_pricing (
  provider,
  model_name,
  input_cost_per_token,
  output_cost_per_token,
  effective_date
) VALUES (
  'openai',
  'gpt-4o-mini',
  0.00000015,  -- $0.15 per 1M tokens = $0.00015 per 1K tokens
  0.0000006,   -- $0.60 per 1M tokens = $0.0006 per 1K tokens
  '2024-07-18'
)
ON CONFLICT (provider, model_name, effective_date) DO UPDATE SET
  input_cost_per_token = EXCLUDED.input_cost_per_token,
  output_cost_per_token = EXCLUDED.output_cost_per_token;

-- Add claude-3-haiku-20240307 (specific version for routing)
INSERT INTO ai_model_pricing (
  provider,
  model_name,
  input_cost_per_token,
  output_cost_per_token,
  effective_date
) VALUES (
  'anthropic',
  'claude-3-haiku-20240307',
  0.00000025,  -- $0.25 per 1M tokens = $0.00025 per 1K tokens
  0.00000125,  -- $1.25 per 1M tokens = $0.00125 per 1K tokens
  '2024-03-07'
)
ON CONFLICT (provider, model_name, effective_date) DO UPDATE SET
  input_cost_per_token = EXCLUDED.input_cost_per_token,
  output_cost_per_token = EXCLUDED.output_cost_per_token;

-- Add claude-3-5-sonnet-20241022 (newer version)
INSERT INTO ai_model_pricing (
  provider,
  model_name,
  input_cost_per_token,
  output_cost_per_token,
  effective_date
) VALUES (
  'anthropic',
  'claude-3-5-sonnet-20241022',
  0.000003,    -- $3.00 per 1M tokens = $0.003 per 1K tokens
  0.000015,    -- $15.00 per 1M tokens = $0.015 per 1K tokens
  '2024-10-22'
)
ON CONFLICT (provider, model_name, effective_date) DO UPDATE SET
  input_cost_per_token = EXCLUDED.input_cost_per_token,
  output_cost_per_token = EXCLUDED.output_cost_per_token;

-- Add claude-3-5-haiku-20241022 (newer version)
INSERT INTO ai_model_pricing (
  provider,
  model_name,
  input_cost_per_token,
  output_cost_per_token,
  effective_date
) VALUES (
  'anthropic',
  'claude-3-5-haiku-20241022',
  0.000001,    -- $1.00 per 1M tokens = $0.001 per 1K tokens
  0.000005,    -- $5.00 per 1M tokens = $0.005 per 1K tokens
  '2024-10-22'
)
ON CONFLICT (provider, model_name, effective_date) DO UPDATE SET
  input_cost_per_token = EXCLUDED.input_cost_per_token,
  output_cost_per_token = EXCLUDED.output_cost_per_token;

-- Verify all models needed for routing are present
SELECT
  provider,
  model_name,
  input_cost_per_token * 1000 AS input_cost_per_1k,
  output_cost_per_token * 1000 AS output_cost_per_1k,
  effective_date
FROM ai_model_pricing
WHERE retired_date IS NULL
  AND (
    model_name IN ('gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo', 'gpt-4')
    OR model_name LIKE 'claude-3%'
  )
ORDER BY provider, model_name;
