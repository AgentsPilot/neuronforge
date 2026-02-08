-- Add insights_enabled flag to agents table
-- Created: 2026-02-02
-- Purpose: Allow users to enable/disable AI-powered insights per agent (LLM cost consideration)

-- Add the column (defaults to false for existing agents)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS insights_enabled BOOLEAN DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN agents.insights_enabled IS 'Whether to generate AI-powered insights for this agent. Requires additional LLM API calls for business language translation. Users can enable this per-agent to control costs.';

-- Update existing production-ready agents to have insights disabled by default
-- Users will need to explicitly enable it
UPDATE agents SET insights_enabled = false WHERE production_ready = true AND insights_enabled IS NULL;
