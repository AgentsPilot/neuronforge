-- Create execution_metrics table for privacy-first business intelligence
-- Created: 2026-02-04
-- Purpose: Store aggregated metadata (counts, field structure, timing) WITHOUT customer data
--
-- CRITICAL PRIVACY GUARANTEE:
-- - Stores ONLY counts, field names, and timing data
-- - NEVER stores actual customer data (names, emails, values, PII)
-- - Enables business intelligence without compromising privacy

CREATE TABLE IF NOT EXISTS public.execution_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign keys
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  execution_id UUID NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,

  -- Timing
  executed_at TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER,

  -- Volume (counts only, NO data)
  total_items INTEGER DEFAULT 0,
  items_by_field JSONB DEFAULT '{}'::jsonb,  -- {"has_priority": 12, "has_urgent": 8}

  -- Field presence (structure analysis, NO values)
  field_names TEXT[],  -- ["id", "email", "priority", "created_at"]

  -- Status indicators
  has_empty_results BOOLEAN DEFAULT false,
  failed_step_count INTEGER DEFAULT 0,

  -- Per-step breakdown (for business intelligence)
  step_metrics JSONB DEFAULT '[]'::jsonb,  -- [{"plugin": "gmail", "action": "search", "step_name": "Filter New Items", "count": 19, "fields": ["from", "subject"]}]

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT unique_execution_metrics UNIQUE(execution_id)
) TABLESPACE pg_default;

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_execution_metrics_agent_time
  ON public.execution_metrics USING btree (agent_id, executed_at DESC)
  TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_execution_metrics_agent_items
  ON public.execution_metrics USING btree (agent_id, total_items)
  TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_execution_metrics_execution_id
  ON public.execution_metrics USING btree (execution_id)
  TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_execution_metrics_executed_at
  ON public.execution_metrics USING btree (executed_at DESC)
  TABLESPACE pg_default;

-- GIN index for JSONB fields (for field-level queries)
CREATE INDEX IF NOT EXISTS idx_execution_metrics_items_by_field
  ON public.execution_metrics USING gin (items_by_field)
  TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_execution_metrics_step_metrics
  ON public.execution_metrics USING gin (step_metrics)
  TABLESPACE pg_default;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_execution_metrics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER execution_metrics_updated_at_trigger
  BEFORE UPDATE ON public.execution_metrics
  FOR EACH ROW
  EXECUTE FUNCTION update_execution_metrics_updated_at();

-- Add comment for documentation
COMMENT ON TABLE public.execution_metrics IS 'Privacy-first execution metadata for business intelligence. Stores ONLY aggregated counts, field structure, and timing data. NEVER stores customer PII or actual data values.';

COMMENT ON COLUMN public.execution_metrics.items_by_field IS 'Field presence counts (e.g., {"has_priority": 12} means 12 items have priority field). NO actual field values stored.';

COMMENT ON COLUMN public.execution_metrics.field_names IS 'Top-level field names present in execution output (structure only, NO values).';

COMMENT ON COLUMN public.execution_metrics.step_metrics IS 'Per-step breakdown for business intelligence: [{"plugin": "gmail", "action": "search", "step_name": "Filter New Items", "count": 19, "fields": ["from", "subject"]}]';
