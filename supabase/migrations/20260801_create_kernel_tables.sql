-- Kernel Tables for Insight System
-- Tracks kernel process executions and action logs for MyDaySection

-- Kernel Executions Table
-- Tracks individual process executions triggered by insights
CREATE TABLE IF NOT EXISTS kernel_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Process info
  process_id TEXT NOT NULL,
  triggered_by TEXT NOT NULL CHECK (triggered_by IN ('insight', 'automation', 'user_command')),
  insight_id UUID REFERENCES insights(id) ON DELETE SET NULL,

  -- Parameters
  parameters JSONB DEFAULT '{}',
  entity_ids UUID[],

  -- Status
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),

  -- Results
  items_processed INTEGER DEFAULT 0,
  items_succeeded INTEGER DEFAULT 0,
  items_failed INTEGER DEFAULT 0,
  value_impact DECIMAL(10, 2),
  summary TEXT,
  error TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_kernel_executions_user ON kernel_executions(user_id, created_at DESC);
CREATE INDEX idx_kernel_executions_status ON kernel_executions(user_id, status);
CREATE INDEX idx_kernel_executions_process ON kernel_executions(user_id, process_id, created_at DESC);

-- RLS policies
ALTER TABLE kernel_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own kernel executions"
  ON kernel_executions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role has full access to kernel executions"
  ON kernel_executions
  FOR ALL
  USING (auth.role() = 'service_role');

-- Kernel Action Log
-- Simplified log for MyDaySection feed (what I've done for you)
CREATE TABLE IF NOT EXISTS kernel_action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Execution reference
  execution_id UUID REFERENCES kernel_executions(id) ON DELETE SET NULL,
  process_id TEXT NOT NULL,
  triggered_by TEXT NOT NULL,
  insight_id UUID REFERENCES insights(id) ON DELETE SET NULL,

  -- Summary for display
  summary TEXT NOT NULL,

  -- Outcome
  items_processed INTEGER DEFAULT 0,
  items_succeeded INTEGER DEFAULT 0,
  items_failed INTEGER DEFAULT 0,
  value_impact DECIMAL(10, 2),

  -- For rate limiting
  entity_id UUID,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_kernel_action_log_user ON kernel_action_log(user_id, created_at DESC);
CREATE INDEX idx_kernel_action_log_entity ON kernel_action_log(user_id, entity_id, created_at DESC);

-- RLS policies
ALTER TABLE kernel_action_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own kernel action log"
  ON kernel_action_log
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role has full access to kernel action log"
  ON kernel_action_log
  FOR ALL
  USING (auth.role() = 'service_role');

-- Comments
COMMENT ON TABLE kernel_executions IS 'Tracks kernel process executions triggered by insights or automations';
COMMENT ON TABLE kernel_action_log IS 'Simplified action log for MyDaySection feed display';
