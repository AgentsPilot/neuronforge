-- Insight Automations Table
-- Standing automations created from insights
-- When conditions recur, the kernel process is triggered automatically

CREATE TABLE IF NOT EXISTS insight_automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- What triggers this
  detector_id TEXT NOT NULL,
  trigger_condition JSONB NOT NULL,  -- e.g., { "days_overdue": 7 }

  -- What to run
  kernel_process_id TEXT NOT NULL,
  process_parameters JSONB NOT NULL DEFAULT '{}',

  -- Guardrails
  max_items_per_run INTEGER DEFAULT 20,
  quiet_hours_start INTEGER DEFAULT 22,  -- 10 PM
  quiet_hours_end INTEGER DEFAULT 8,     -- 8 AM

  -- Scheduling
  check_interval_minutes INTEGER DEFAULT 60,  -- How often to check
  last_check_at TIMESTAMPTZ,
  next_check_at TIMESTAMPTZ,

  -- Status
  is_active BOOLEAN DEFAULT true,
  paused_at TIMESTAMPTZ,
  pause_reason TEXT,

  -- Stats
  run_count INTEGER DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  last_run_execution_id UUID REFERENCES kernel_executions(id),
  last_outcome JSONB,
  total_items_processed INTEGER DEFAULT 0,
  total_value_impact DECIMAL(10, 2) DEFAULT 0,

  -- Origin
  created_from_insight_id UUID REFERENCES insights(id) ON DELETE SET NULL,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_insight_automations_user ON insight_automations(user_id, is_active);
CREATE INDEX idx_insight_automations_next_check ON insight_automations(next_check_at) WHERE is_active = true;
CREATE INDEX idx_insight_automations_detector ON insight_automations(user_id, detector_id);

-- RLS policies
ALTER TABLE insight_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own automations"
  ON insight_automations
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own automations"
  ON insight_automations
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own automations"
  ON insight_automations
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own automations"
  ON insight_automations
  FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role has full access to automations"
  ON insight_automations
  FOR ALL
  USING (auth.role() = 'service_role');

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_insight_automations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER insight_automations_updated_at
  BEFORE UPDATE ON insight_automations
  FOR EACH ROW
  EXECUTE FUNCTION update_insight_automations_updated_at();

-- Comments
COMMENT ON TABLE insight_automations IS 'Standing automations created from insights - runs automatically when conditions recur';
COMMENT ON COLUMN insight_automations.trigger_condition IS 'JSON conditions that must be met for automation to run (e.g., days_overdue: 7)';
COMMENT ON COLUMN insight_automations.check_interval_minutes IS 'How often the automation scheduler checks if conditions are met';
