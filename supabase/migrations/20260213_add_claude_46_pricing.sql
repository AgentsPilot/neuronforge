-- Add Claude 4.6 models to ai_model_pricing table
-- Date: 2026-02-13
-- Purpose: Add Claude Opus 4.6 and Claude Sonnet 4.6 pricing for agent generation pipeline

-- Add claude-opus-4-6 (most capable model, released Feb 2026)
-- Pricing from: https://www.anthropic.com/news/claude-opus-4-6
INSERT INTO ai_model_pricing (
  provider,
  model_name,
  input_cost_per_token,
  output_cost_per_token,
  effective_date
) VALUES (
  'anthropic',
  'claude-opus-4-6',
  0.000005,    -- $5.00 per 1M tokens = $0.005 per 1K tokens
  0.000025,    -- $25.00 per 1M tokens = $0.025 per 1K tokens
  '2026-02-05'
)
ON CONFLICT (provider, model_name, effective_date) DO UPDATE SET
  input_cost_per_token = EXCLUDED.input_cost_per_token,
  output_cost_per_token = EXCLUDED.output_cost_per_token;

-- Add claude-sonnet-4-6 (balanced performance model, released Feb 2026)
-- Note: Using estimated pricing based on Sonnet 4.5 pricing structure
INSERT INTO ai_model_pricing (
  provider,
  model_name,
  input_cost_per_token,
  output_cost_per_token,
  effective_date
) VALUES (
  'anthropic',
  'claude-sonnet-4-6',
  0.000003,    -- $3.00 per 1M tokens = $0.003 per 1K tokens
  0.000015,    -- $15.00 per 1M tokens = $0.015 per 1K tokens
  '2026-02-05'
)
ON CONFLICT (provider, model_name, effective_date) DO UPDATE SET
  input_cost_per_token = EXCLUDED.input_cost_per_token,
  output_cost_per_token = EXCLUDED.output_cost_per_token;

-- Add claude-opus-4-5-20251101 (previous Opus version for backward compatibility)
INSERT INTO ai_model_pricing (
  provider,
  model_name,
  input_cost_per_token,
  output_cost_per_token,
  effective_date
) VALUES (
  'anthropic',
  'claude-opus-4-5-20251101',
  0.000015,    -- $15.00 per 1M tokens = $0.015 per 1K tokens
  0.000075,    -- $75.00 per 1M tokens = $0.075 per 1K tokens
  '2025-11-01'
)
ON CONFLICT (provider, model_name, effective_date) DO UPDATE SET
  input_cost_per_token = EXCLUDED.input_cost_per_token,
  output_cost_per_token = EXCLUDED.output_cost_per_token;

-- Add claude-sonnet-4-5-20250929 (previous Sonnet version for backward compatibility)
INSERT INTO ai_model_pricing (
  provider,
  model_name,
  input_cost_per_token,
  output_cost_per_token,
  effective_date
) VALUES (
  'anthropic',
  'claude-sonnet-4-5-20250929',
  0.000003,    -- $3.00 per 1M tokens = $0.003 per 1K tokens
  0.000015,    -- $15.00 per 1M tokens = $0.015 per 1K tokens
  '2025-09-29'
)
ON CONFLICT (provider, model_name, effective_date) DO UPDATE SET
  input_cost_per_token = EXCLUDED.input_cost_per_token,
  output_cost_per_token = EXCLUDED.output_cost_per_token;

-- Verify Claude 4.x models are present
SELECT
  provider,
  model_name,
  input_cost_per_token * 1000000 AS input_cost_per_1m,
  output_cost_per_token * 1000000 AS output_cost_per_1m,
  effective_date
FROM ai_model_pricing
WHERE retired_date IS NULL
  AND provider = 'anthropic'
  AND model_name LIKE 'claude-%4%'
ORDER BY effective_date DESC, model_name;
