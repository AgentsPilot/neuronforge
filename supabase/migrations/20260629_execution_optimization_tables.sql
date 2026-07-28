-- Execution Optimization Tables
-- Phase 6 of Memory System Enhancement: Execution Optimization
--
-- Purpose: Track execution baselines and detect anomalies
-- to identify performance degradation and optimization opportunities.
--
-- Tracks per-agent execution metrics to establish baselines
-- and flag anomalies when execution deviates significantly.

-- ============================================================
-- Execution Baselines (Per-Agent Performance Norms)
-- ============================================================

CREATE TABLE IF NOT EXISTS execution_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,

  -- Baseline metrics (rolling averages)
  avg_duration_ms DECIMAL NOT NULL DEFAULT 0,
  stddev_duration_ms DECIMAL NOT NULL DEFAULT 0,
  avg_token_usage DECIMAL NOT NULL DEFAULT 0,
  stddev_token_usage DECIMAL NOT NULL DEFAULT 0,
  avg_step_count DECIMAL NOT NULL DEFAULT 0,
  avg_retry_count DECIMAL NOT NULL DEFAULT 0,
  success_rate DECIMAL(5,4) NOT NULL DEFAULT 1.0,

  -- Sample size for statistical significance
  sample_count INTEGER NOT NULL DEFAULT 0,

  -- Plugin-specific baselines (JSON for flexibility)
  plugin_baselines JSONB DEFAULT '{}',  -- { "gmail": { avg_duration_ms: 500, ... } }

  -- Baseline window
  window_start TIMESTAMP WITH TIME ZONE,
  window_end TIMESTAMP WITH TIME ZONE,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(agent_id)
);

-- Index for user queries
CREATE INDEX IF NOT EXISTS idx_execution_baselines_user
ON execution_baselines(user_id);

-- RLS Policy
ALTER TABLE execution_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY execution_baselines_user_isolation ON execution_baselines
  FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY execution_baselines_service_role ON execution_baselines
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Comments
COMMENT ON TABLE execution_baselines IS 'Per-agent execution baselines for anomaly detection';
COMMENT ON COLUMN execution_baselines.stddev_duration_ms IS 'Standard deviation for calculating z-scores';
COMMENT ON COLUMN execution_baselines.plugin_baselines IS 'Per-plugin baseline metrics within this agent';

-- ============================================================
-- Execution Anomalies (Detected Deviations)
-- ============================================================

CREATE TABLE IF NOT EXISTS execution_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  execution_id UUID NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,

  -- Anomaly classification
  anomaly_type TEXT NOT NULL,  -- 'duration_spike', 'token_spike', 'error_rate_increase', 'step_count_increase'
  severity TEXT NOT NULL DEFAULT 'low',  -- 'low', 'medium', 'high', 'critical'

  -- Deviation metrics
  baseline_value DECIMAL NOT NULL,
  actual_value DECIMAL NOT NULL,
  z_score DECIMAL,  -- How many std devs from baseline
  deviation_percent DECIMAL,  -- Percentage deviation from baseline

  -- Context
  plugin TEXT,  -- Which plugin caused the anomaly (if applicable)
  action TEXT,
  step_index INTEGER,

  -- Analysis
  probable_cause TEXT,  -- AI-generated explanation
  suggested_fix TEXT,   -- AI-generated suggestion

  -- Resolution tracking
  status TEXT DEFAULT 'detected',  -- 'detected', 'acknowledged', 'investigating', 'resolved', 'ignored'
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolution_notes TEXT,

  -- Timestamps
  detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for agent anomaly lookup
CREATE INDEX IF NOT EXISTS idx_execution_anomalies_agent
ON execution_anomalies(agent_id, detected_at DESC);

-- Index for unresolved anomalies
CREATE INDEX IF NOT EXISTS idx_execution_anomalies_unresolved
ON execution_anomalies(user_id, status, detected_at DESC)
WHERE status IN ('detected', 'investigating');

-- Index for execution lookup
CREATE INDEX IF NOT EXISTS idx_execution_anomalies_execution
ON execution_anomalies(execution_id);

-- RLS Policy
ALTER TABLE execution_anomalies ENABLE ROW LEVEL SECURITY;

CREATE POLICY execution_anomalies_user_isolation ON execution_anomalies
  FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY execution_anomalies_service_role ON execution_anomalies
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Comments
COMMENT ON TABLE execution_anomalies IS 'Detected execution anomalies for alerting and optimization';
COMMENT ON COLUMN execution_anomalies.z_score IS 'Standard deviations from baseline (> 2.0 is significant)';
COMMENT ON COLUMN execution_anomalies.probable_cause IS 'AI-generated analysis of what caused the anomaly';

-- ============================================================
-- Helper Functions
-- ============================================================

-- Function to update execution baseline after each execution
CREATE OR REPLACE FUNCTION update_execution_baseline(
  p_agent_id UUID,
  p_user_id UUID,
  p_duration_ms DECIMAL,
  p_token_usage DECIMAL,
  p_step_count INTEGER,
  p_retry_count INTEGER,
  p_success BOOLEAN
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
  v_existing RECORD;
  v_new_count INTEGER;
  v_new_avg_duration DECIMAL;
  v_new_stddev_duration DECIMAL;
  v_new_avg_tokens DECIMAL;
  v_new_stddev_tokens DECIMAL;
  v_delta DECIMAL;
  v_delta2 DECIMAL;
  v_m2_duration DECIMAL;
  v_m2_tokens DECIMAL;
BEGIN
  -- Try to get existing baseline
  SELECT id, sample_count, avg_duration_ms, stddev_duration_ms,
         avg_token_usage, stddev_token_usage, avg_step_count, avg_retry_count, success_rate
  INTO v_existing
  FROM execution_baselines
  WHERE agent_id = p_agent_id
  FOR UPDATE;

  IF FOUND THEN
    -- Update using Welford's online algorithm for running mean and variance
    v_new_count := v_existing.sample_count + 1;

    -- Duration stats
    v_delta := p_duration_ms - v_existing.avg_duration_ms;
    v_new_avg_duration := v_existing.avg_duration_ms + v_delta / v_new_count;
    v_delta2 := p_duration_ms - v_new_avg_duration;
    v_m2_duration := (v_existing.stddev_duration_ms * v_existing.stddev_duration_ms * (v_existing.sample_count - 1)) + v_delta * v_delta2;
    IF v_new_count > 1 THEN
      v_new_stddev_duration := sqrt(v_m2_duration / (v_new_count - 1));
    ELSE
      v_new_stddev_duration := 0;
    END IF;

    -- Token stats
    v_delta := p_token_usage - v_existing.avg_token_usage;
    v_new_avg_tokens := v_existing.avg_token_usage + v_delta / v_new_count;
    v_delta2 := p_token_usage - v_new_avg_tokens;
    v_m2_tokens := (v_existing.stddev_token_usage * v_existing.stddev_token_usage * (v_existing.sample_count - 1)) + v_delta * v_delta2;
    IF v_new_count > 1 THEN
      v_new_stddev_tokens := sqrt(v_m2_tokens / (v_new_count - 1));
    ELSE
      v_new_stddev_tokens := 0;
    END IF;

    UPDATE execution_baselines
    SET
      sample_count = v_new_count,
      avg_duration_ms = v_new_avg_duration,
      stddev_duration_ms = v_new_stddev_duration,
      avg_token_usage = v_new_avg_tokens,
      stddev_token_usage = v_new_stddev_tokens,
      avg_step_count = (v_existing.avg_step_count * v_existing.sample_count + p_step_count) / v_new_count,
      avg_retry_count = (v_existing.avg_retry_count * v_existing.sample_count + p_retry_count) / v_new_count,
      success_rate = (v_existing.success_rate * v_existing.sample_count + CASE WHEN p_success THEN 1 ELSE 0 END) / v_new_count,
      window_end = NOW(),
      updated_at = NOW()
    WHERE id = v_existing.id
    RETURNING id INTO v_id;
  ELSE
    -- Insert new baseline
    INSERT INTO execution_baselines (
      agent_id, user_id, sample_count,
      avg_duration_ms, stddev_duration_ms,
      avg_token_usage, stddev_token_usage,
      avg_step_count, avg_retry_count, success_rate,
      window_start, window_end
    )
    VALUES (
      p_agent_id, p_user_id, 1,
      p_duration_ms, 0,
      p_token_usage, 0,
      p_step_count, p_retry_count, CASE WHEN p_success THEN 1.0 ELSE 0.0 END,
      NOW(), NOW()
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check for anomalies against baseline
CREATE OR REPLACE FUNCTION check_execution_anomaly(
  p_agent_id UUID,
  p_execution_id UUID,
  p_user_id UUID,
  p_duration_ms DECIMAL,
  p_token_usage DECIMAL,
  p_step_count INTEGER,
  p_retry_count INTEGER,
  p_success BOOLEAN
)
RETURNS TABLE (
  anomaly_type TEXT,
  severity TEXT,
  baseline_value DECIMAL,
  actual_value DECIMAL,
  z_score DECIMAL,
  deviation_percent DECIMAL
) AS $$
DECLARE
  v_baseline RECORD;
  v_z_score DECIMAL;
  v_deviation DECIMAL;
  v_severity TEXT;
BEGIN
  -- Get baseline
  SELECT * INTO v_baseline
  FROM execution_baselines
  WHERE agent_id = p_agent_id;

  -- Need at least 5 samples for meaningful anomaly detection
  IF NOT FOUND OR v_baseline.sample_count < 5 THEN
    RETURN;
  END IF;

  -- Check duration anomaly
  IF v_baseline.stddev_duration_ms > 0 THEN
    v_z_score := (p_duration_ms - v_baseline.avg_duration_ms) / v_baseline.stddev_duration_ms;
    v_deviation := ((p_duration_ms - v_baseline.avg_duration_ms) / NULLIF(v_baseline.avg_duration_ms, 0)) * 100;

    IF v_z_score > 2.0 THEN
      -- Determine severity based on z-score
      IF v_z_score > 4.0 THEN
        v_severity := 'critical';
      ELSIF v_z_score > 3.0 THEN
        v_severity := 'high';
      ELSIF v_z_score > 2.5 THEN
        v_severity := 'medium';
      ELSE
        v_severity := 'low';
      END IF;

      anomaly_type := 'duration_spike';
      severity := v_severity;
      baseline_value := v_baseline.avg_duration_ms;
      actual_value := p_duration_ms;
      z_score := v_z_score;
      deviation_percent := v_deviation;
      RETURN NEXT;
    END IF;
  END IF;

  -- Check token anomaly
  IF v_baseline.stddev_token_usage > 0 THEN
    v_z_score := (p_token_usage - v_baseline.avg_token_usage) / v_baseline.stddev_token_usage;
    v_deviation := ((p_token_usage - v_baseline.avg_token_usage) / NULLIF(v_baseline.avg_token_usage, 0)) * 100;

    IF v_z_score > 2.0 THEN
      IF v_z_score > 4.0 THEN
        v_severity := 'critical';
      ELSIF v_z_score > 3.0 THEN
        v_severity := 'high';
      ELSIF v_z_score > 2.5 THEN
        v_severity := 'medium';
      ELSE
        v_severity := 'low';
      END IF;

      anomaly_type := 'token_spike';
      severity := v_severity;
      baseline_value := v_baseline.avg_token_usage;
      actual_value := p_token_usage;
      z_score := v_z_score;
      deviation_percent := v_deviation;
      RETURN NEXT;
    END IF;
  END IF;

  -- Check step count anomaly (more than 50% increase)
  IF v_baseline.avg_step_count > 0 THEN
    v_deviation := ((p_step_count - v_baseline.avg_step_count) / v_baseline.avg_step_count) * 100;
    IF v_deviation > 50 THEN
      IF v_deviation > 200 THEN
        v_severity := 'high';
      ELSIF v_deviation > 100 THEN
        v_severity := 'medium';
      ELSE
        v_severity := 'low';
      END IF;

      anomaly_type := 'step_count_increase';
      severity := v_severity;
      baseline_value := v_baseline.avg_step_count;
      actual_value := p_step_count;
      z_score := NULL;
      deviation_percent := v_deviation;
      RETURN NEXT;
    END IF;
  END IF;

  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to record detected anomalies
CREATE OR REPLACE FUNCTION record_execution_anomaly(
  p_agent_id UUID,
  p_execution_id UUID,
  p_user_id UUID,
  p_anomaly_type TEXT,
  p_severity TEXT,
  p_baseline_value DECIMAL,
  p_actual_value DECIMAL,
  p_z_score DECIMAL,
  p_deviation_percent DECIMAL,
  p_plugin TEXT DEFAULT NULL,
  p_action TEXT DEFAULT NULL,
  p_step_index INTEGER DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO execution_anomalies (
    agent_id, execution_id, user_id,
    anomaly_type, severity,
    baseline_value, actual_value, z_score, deviation_percent,
    plugin, action, step_index
  )
  VALUES (
    p_agent_id, p_execution_id, p_user_id,
    p_anomaly_type, p_severity,
    p_baseline_value, p_actual_value, p_z_score, p_deviation_percent,
    p_plugin, p_action, p_step_index
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
