-- ============================================================================
-- Automation SLAs Table
-- ============================================================================
-- Service Level Agreements for workflow monitoring and alerting.
-- Users can define SLAs based on success rate, duration, or other metrics.
-- ============================================================================

-- Create the automation_slas table
CREATE TABLE IF NOT EXISTS automation_slas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

  -- SLA Definition
  name TEXT NOT NULL,
  description TEXT,

  -- Target scope (one of these should be set)
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,  -- Specific workflow
  group_id UUID REFERENCES workflow_groups(id) ON DELETE SET NULL,  -- All workflows in a group
  applies_to_all BOOLEAN DEFAULT false,  -- All workflows

  -- Metric definition
  metric_name TEXT NOT NULL,  -- 'success_rate' | 'avg_duration_ms' | 'min_executions' | etc.
  target_value NUMERIC NOT NULL,
  threshold_type TEXT NOT NULL CHECK (threshold_type IN ('above', 'below', 'between')),
  threshold_max NUMERIC,  -- For 'between' type

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'violated', 'meeting')),
  current_value NUMERIC,
  last_checked_at TIMESTAMPTZ,

  -- Alerting
  alert_channels JSONB DEFAULT '[]',  -- [{type: 'email', value: 'x@y.com'}, {type: 'webhook', value: '...'}]
  escalation_after_minutes INTEGER,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_automation_slas_user_id ON automation_slas(user_id);
CREATE INDEX IF NOT EXISTS idx_automation_slas_org_id ON automation_slas(org_id);
CREATE INDEX IF NOT EXISTS idx_automation_slas_agent_id ON automation_slas(agent_id);
CREATE INDEX IF NOT EXISTS idx_automation_slas_group_id ON automation_slas(group_id);
CREATE INDEX IF NOT EXISTS idx_automation_slas_status ON automation_slas(status);

-- Enable RLS
ALTER TABLE automation_slas ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own SLAs"
  ON automation_slas FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own SLAs"
  ON automation_slas FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own SLAs"
  ON automation_slas FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own SLAs"
  ON automation_slas FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- SLA Events Table (for tracking violations and recovery)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sla_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sla_id UUID NOT NULL REFERENCES automation_slas(id) ON DELETE CASCADE,

  -- Event details
  event_type TEXT NOT NULL CHECK (event_type IN ('violation', 'recovery', 'acknowledged', 'escalated')),
  event_time TIMESTAMPTZ DEFAULT NOW(),
  actual_value NUMERIC,

  -- Resolution
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  acknowledged_by UUID REFERENCES auth.users(id),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_sla_events_sla_id ON sla_events(sla_id);
CREATE INDEX IF NOT EXISTS idx_sla_events_event_type ON sla_events(event_type);
CREATE INDEX IF NOT EXISTS idx_sla_events_event_time ON sla_events(event_time);

-- Enable RLS
ALTER TABLE sla_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies (based on SLA ownership)
CREATE POLICY "Users can view events for their SLAs"
  ON sla_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM automation_slas
      WHERE automation_slas.id = sla_events.sla_id
      AND automation_slas.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create events for their SLAs"
  ON sla_events FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM automation_slas
      WHERE automation_slas.id = sla_events.sla_id
      AND automation_slas.user_id = auth.uid()
    )
  );

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE automation_slas IS 'Service Level Agreements for workflow monitoring';
COMMENT ON COLUMN automation_slas.metric_name IS 'Metric to monitor: success_rate, avg_duration_ms, min_executions, etc.';
COMMENT ON COLUMN automation_slas.threshold_type IS 'How to compare: above (>=), below (<=), or between';
COMMENT ON COLUMN automation_slas.status IS 'Current SLA status: active, paused, violated, or meeting';

COMMENT ON TABLE sla_events IS 'Historical events for SLA violations and recovery';
