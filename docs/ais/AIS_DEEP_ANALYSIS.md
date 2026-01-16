# AIS (Agent Intensity System) - Deep Analysis & Verification

**Date**: 2025-01-29
**Purpose**: Comprehensive analysis of the entire AIS system to verify all components are working correctly

---

## Executive Summary

### Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| **Creation Tracking** | ✅ Working | Tracks tokens from agent generation, saves to DB |
| **Execution Tracking** | ⚠️ Unknown | Code exists, needs verification with real execution |
| **Normalization Ranges** | ❓ Needs Check | Table may not exist or be populated |
| **Database Functions** | ❓ Needs Check | `get_active_ais_ranges()` and `update_dynamic_ais_ranges()` |
| **Scoring Calculation** | ✅ Implemented | 4-dimension weighted scoring with normalization |
| **Admin UI** | ✅ Implemented | `/app/admin/ais-config` route exists |

---

## 1. DATABASE SCHEMA VERIFICATION

### Required Tables

#### 1.1 `agent_intensity_metrics` Table

**Purpose**: Stores all intensity metrics for each agent

**Run this to verify**:
```sql
-- Check table exists and has all columns
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'agent_intensity_metrics'
ORDER BY ordinal_position;
```

**Expected Columns** (55 total):
- Core: `id`, `agent_id`, `user_id`
- Scores: `intensity_score`, `token_complexity_score`, `execution_complexity_score`, `plugin_complexity_score`, `workflow_complexity_score`
- Creation: `creation_tokens_used`, `total_creation_cost_usd`
- Execution stats: `total_executions`, `successful_executions`, `failed_executions`
- Token stats: `total_tokens_used`, `avg_tokens_per_run`, `peak_tokens_single_run`, `input_output_ratio`
- Duration stats: `avg_execution_duration_ms`, `peak_execution_duration_ms`
- Plugin stats: `total_plugin_calls`, `unique_plugins_used`, `avg_plugins_per_run`, `tool_orchestration_overhead_ms`
- Workflow stats: `workflow_steps_count`, `conditional_branches_count`, `loop_iterations_count`, `parallel_execution_count`
- Reliability: `success_rate`, `retry_rate`, `error_recovery_count`
- Metadata: `calculation_method`, `last_calculated_at`, `metrics_version`, `created_at`, `updated_at`

---

#### 1.2 `ais_normalization_ranges` Table

**Purpose**: Stores min/max ranges for normalizing metrics to 0-10 scale

**Run this to verify**:
```sql
-- Check if table exists
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'ais_normalization_ranges'
ORDER BY ordinal_position;

-- Check if data is populated
SELECT
  range_key,
  category,
  best_practice_min,
  best_practice_max,
  dynamic_min,
  dynamic_max,
  active_mode,
  min_executions_threshold,
  description
FROM ais_normalization_ranges
ORDER BY category, range_key;
```

**Expected Columns**:
- `id` (uuid, primary key)
- `range_key` (varchar) - e.g., "token_volume", "plugin_count"
- `category` (varchar) - "token", "execution", "plugin", "workflow"
- `best_practice_min` (decimal) - Industry standard minimum
- `best_practice_max` (decimal) - Industry standard maximum
- `dynamic_min` (decimal) - 5th percentile from real data
- `dynamic_max` (decimal) - 95th percentile from real data
- `active_mode` (integer) - 0 = best_practice, 1 = dynamic
- `min_executions_threshold` (integer) - Minimum data points needed for dynamic mode
- `description` (text) - Human-readable explanation
- `created_at`, `updated_at` (timestamp)

**Expected 15 Rows** (one per metric):

| range_key | category | Best Practice Range | Description |
|-----------|----------|-------------------|-------------|
| token_volume | token | 0 - 5000 | Average tokens per execution |
| token_peak | token | 0 - 10000 | Maximum tokens in single run |
| token_io_ratio_min | token | 0.5 - 0.5 | Min input/output ratio (efficiency) |
| token_io_ratio_max | token | 3.0 - 3.0 | Max input/output ratio |
| iterations | execution | 1 - 10 | Average iterations per run |
| duration_ms | execution | 0 - 30000 | Average execution duration (ms) |
| failure_rate | execution | 0 - 50 | Failure rate percentage |
| retry_rate | execution | 0 - 3 | Average retries per run |
| plugin_count | plugin | 0 - 10 | Unique plugins used |
| plugins_per_run | plugin | 0 - 8 | Average plugins per execution |
| orchestration_overhead_ms | plugin | 0 - 5000 | Tool coordination overhead |
| workflow_steps | workflow | 0 - 20 | Number of workflow steps |
| branches | workflow | 0 - 10 | Conditional branches |
| loops | workflow | 0 - 50 | Loop iterations |
| parallel | workflow | 0 - 5 | Parallel executions |

**If table is empty or missing, create it**:
```sql
-- Create the normalization ranges table
CREATE TABLE IF NOT EXISTS ais_normalization_ranges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  range_key VARCHAR(100) NOT NULL UNIQUE,
  category VARCHAR(50) NOT NULL,
  best_practice_min DECIMAL(10,2) NOT NULL,
  best_practice_max DECIMAL(10,2) NOT NULL,
  dynamic_min DECIMAL(10,2) DEFAULT 0,
  dynamic_max DECIMAL(10,2) DEFAULT 0,
  active_mode INTEGER DEFAULT 0 CHECK (active_mode IN (0, 1)),
  min_executions_threshold INTEGER DEFAULT 10,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert best practice ranges (industry standards)
INSERT INTO ais_normalization_ranges (range_key, category, best_practice_min, best_practice_max, description) VALUES
-- Token Complexity (3 metrics)
('token_volume', 'token', 0, 5000, 'Average tokens per execution'),
('token_peak', 'token', 0, 10000, 'Maximum tokens in single execution'),
('token_io_ratio_min', 'token', 0.5, 0.5, 'Minimum input/output ratio (lower = more efficient)'),
('token_io_ratio_max', 'token', 3.0, 3.0, 'Maximum input/output ratio (higher = more verbose)'),

-- Execution Complexity (4 metrics)
('iterations', 'execution', 1, 10, 'Average iterations per execution'),
('duration_ms', 'execution', 0, 30000, 'Average execution duration in milliseconds'),
('failure_rate', 'execution', 0, 50, 'Percentage of failed executions'),
('retry_rate', 'execution', 0, 3, 'Average number of retries per execution'),

-- Plugin Complexity (3 metrics)
('plugin_count', 'plugin', 0, 10, 'Number of unique plugins used by agent'),
('plugins_per_run', 'plugin', 0, 8, 'Average plugins used per execution'),
('orchestration_overhead_ms', 'plugin', 0, 5000, 'Average time spent coordinating plugins'),

-- Workflow Complexity (4 metrics)
('workflow_steps', 'workflow', 0, 20, 'Number of workflow steps'),
('branches', 'workflow', 0, 10, 'Number of conditional branches'),
('loops', 'workflow', 0, 50, 'Total loop iterations'),
('parallel', 'workflow', 0, 5, 'Number of parallel executions');
```

---

#### 1.3 Database Functions

**Required Functions**:
1. `get_active_ais_ranges()` - Returns current normalization ranges based on mode
2. `update_dynamic_ais_ranges()` - Calculates 95th percentile ranges from production data

**Verify they exist**:
```sql
SELECT
  routine_name,
  routine_type,
  data_type as return_type
FROM information_schema.routines
WHERE routine_name IN ('get_active_ais_ranges', 'update_dynamic_ais_ranges')
ORDER BY routine_name;
```

**If missing, create them**:
```sql
-- Function 1: Get active ranges based on mode
CREATE OR REPLACE FUNCTION get_active_ais_ranges()
RETURNS TABLE(
    range_key VARCHAR,
    min_value DECIMAL,
    max_value DECIMAL,
    category VARCHAR,
    description TEXT
) AS $$
DECLARE
    current_mode INTEGER;
BEGIN
    -- Read mode from ais_normalization_ranges table
    SELECT active_mode INTO current_mode
    FROM ais_normalization_ranges
    LIMIT 1;

    IF current_mode IS NULL THEN
        current_mode := 0;
    END IF;

    -- Return appropriate ranges based on mode
    IF current_mode = 1 THEN
        -- Dynamic mode: use 95th percentile ranges
        RETURN QUERY
        SELECT
            r.range_key::VARCHAR,
            r.dynamic_min,
            r.dynamic_max,
            r.category::VARCHAR,
            r.description
        FROM ais_normalization_ranges r;
    ELSE
        -- Best practice mode: use industry standard ranges
        RETURN QUERY
        SELECT
            r.range_key::VARCHAR,
            r.best_practice_min,
            r.best_practice_max,
            r.category::VARCHAR,
            r.description
        FROM ais_normalization_ranges r;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function 2: Update dynamic ranges from production data
CREATE OR REPLACE FUNCTION update_dynamic_ais_ranges()
RETURNS TABLE(
    updated_count INTEGER,
    message TEXT
) AS $$
DECLARE
    min_data_points INTEGER;
    total_data_points INTEGER;
    ranges_updated INTEGER := 0;
BEGIN
    -- Get minimum executions threshold
    SELECT min_executions_threshold INTO min_data_points
    FROM ais_normalization_ranges
    LIMIT 1;

    IF min_data_points IS NULL THEN
        min_data_points := 10;
    END IF;

    -- Count total executions
    SELECT COALESCE(SUM(total_executions), 0) INTO total_data_points
    FROM agent_intensity_metrics;

    -- Check if we have enough data
    IF total_data_points < min_data_points THEN
        RETURN QUERY SELECT
            0,
            format('Not enough data. Need %s executions, found %s.',
                   min_data_points, total_data_points);
        RETURN;
    END IF;

    -- Calculate and update 95th percentile for each metric
    -- Token metrics
    UPDATE ais_normalization_ranges
    SET dynamic_min = 0,
        dynamic_max = (SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY avg_tokens_per_run) FROM agent_intensity_metrics WHERE total_executions > 0)
    WHERE range_key = 'token_volume';
    ranges_updated := ranges_updated + 1;

    UPDATE ais_normalization_ranges
    SET dynamic_min = 0,
        dynamic_max = (SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY peak_tokens_single_run) FROM agent_intensity_metrics WHERE total_executions > 0)
    WHERE range_key = 'token_peak';
    ranges_updated := ranges_updated + 1;

    -- Execution metrics
    UPDATE ais_normalization_ranges
    SET dynamic_min = 1,
        dynamic_max = (SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY avg_iterations_per_run) FROM agent_intensity_metrics WHERE total_executions > 0)
    WHERE range_key = 'iterations';
    ranges_updated := ranges_updated + 1;

    UPDATE ais_normalization_ranges
    SET dynamic_min = 0,
        dynamic_max = (SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY avg_execution_duration_ms) FROM agent_intensity_metrics WHERE total_executions > 0)
    WHERE range_key = 'duration_ms';
    ranges_updated := ranges_updated + 1;

    UPDATE ais_normalization_ranges
    SET dynamic_min = 0,
        dynamic_max = (SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY (100 - success_rate)) FROM agent_intensity_metrics WHERE total_executions > 0)
    WHERE range_key = 'failure_rate';
    ranges_updated := ranges_updated + 1;

    UPDATE ais_normalization_ranges
    SET dynamic_min = 0,
        dynamic_max = (SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY retry_rate) FROM agent_intensity_metrics WHERE total_executions > 0)
    WHERE range_key = 'retry_rate';
    ranges_updated := ranges_updated + 1;

    -- Plugin metrics
    UPDATE ais_normalization_ranges
    SET dynamic_min = 0,
        dynamic_max = (SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY unique_plugins_used) FROM agent_intensity_metrics WHERE total_executions > 0)
    WHERE range_key = 'plugin_count';
    ranges_updated := ranges_updated + 1;

    UPDATE ais_normalization_ranges
    SET dynamic_min = 0,
        dynamic_max = (SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY avg_plugins_per_run) FROM agent_intensity_metrics WHERE total_executions > 0)
    WHERE range_key = 'plugins_per_run';
    ranges_updated := ranges_updated + 1;

    UPDATE ais_normalization_ranges
    SET dynamic_min = 0,
        dynamic_max = (SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY tool_orchestration_overhead_ms) FROM agent_intensity_metrics WHERE total_executions > 0)
    WHERE range_key = 'orchestration_overhead_ms';
    ranges_updated := ranges_updated + 1;

    -- Workflow metrics
    UPDATE ais_normalization_ranges
    SET dynamic_min = 0,
        dynamic_max = (SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY workflow_steps_count) FROM agent_intensity_metrics WHERE total_executions > 0)
    WHERE range_key = 'workflow_steps';
    ranges_updated := ranges_updated + 1;

    UPDATE ais_normalization_ranges
    SET dynamic_min = 0,
        dynamic_max = (SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY conditional_branches_count) FROM agent_intensity_metrics WHERE total_executions > 0)
    WHERE range_key = 'branches';
    ranges_updated := ranges_updated + 1;

    UPDATE ais_normalization_ranges
    SET dynamic_min = 0,
        dynamic_max = (SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY loop_iterations_count) FROM agent_intensity_metrics WHERE total_executions > 0)
    WHERE range_key = 'loops';
    ranges_updated := ranges_updated + 1;

    UPDATE ais_normalization_ranges
    SET dynamic_min = 0,
        dynamic_max = (SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY parallel_execution_count) FROM agent_intensity_metrics WHERE total_executions > 0)
    WHERE range_key = 'parallel';
    ranges_updated := ranges_updated + 1;

    RETURN QUERY SELECT
        ranges_updated,
        format('Successfully updated %s dynamic ranges from %s agent executions',
               ranges_updated, total_data_points);
END;
$$ LANGUAGE plpgsql;
```

---

## 2. CREATION vs EXECUTION TRACKING

### Key Difference

| Aspect | Creation Tracking | Execution Tracking |
|--------|------------------|-------------------|
| **When** | Once, when agent is generated | Every time agent runs |
| **What** | Tokens used by GPT-4o to generate agent | Tokens, duration, plugins, workflow used during run |
| **Metrics** | `creation_tokens_used`, `total_creation_cost_usd` | 50+ metrics across 4 dimensions |
| **Activity Types** | `agent_creation`, `agent_generation` | Execution metrics, no activity_type |
| **Storage** | Updates `agent_intensity_metrics` once | Cumulative updates to `agent_intensity_metrics` |
| **Purpose** | Track one-time generation cost | Calculate dynamic intensity score for pricing |

### Activity Types in `token_usage` Table

```sql
-- Check what activity types exist
SELECT
  activity_type,
  COUNT(*) as record_count,
  SUM(input_tokens + output_tokens) as total_tokens
FROM token_usage
GROUP BY activity_type
ORDER BY record_count DESC;
```

**Expected Activity Types**:
- `agent_creation` - Token usage during agent creation/generation phases
- `agent_generation` - Main generation step (AgentKit analysis)
- `agent_execution` - When user runs the agent (NOT currently tracked here)
- Others like `chat_completion`, `embedding`, etc.

### Why Creation Uses `token_usage` but Execution Doesn't

**Creation Tracking Flow**:
1. `/api/generate-agent-v2` calls OpenAI/Claude
2. AI Analytics service tracks tokens → `token_usage` table
3. `/api/create-agent` queries `token_usage` by sessionId
4. Aggregates tokens and saves to `agent_intensity_metrics`

**Execution Tracking Flow**:
1. `/api/run-agent` executes agent via AgentKit
2. AgentKit returns result with token count
3. `updateAgentIntensityMetrics()` directly updates `agent_intensity_metrics`
4. NO intermediate storage in `token_usage` (though it could be added)

**Verification SQL**:
```sql
-- Check if creation tokens are tracked
SELECT
  a.agent_name,
  aim.creation_tokens_used,
  aim.total_creation_cost_usd,
  aim.created_at
FROM agent_intensity_metrics aim
JOIN agents a ON a.id = aim.agent_id
WHERE aim.creation_tokens_used > 0
ORDER BY aim.created_at DESC;

-- Check if execution metrics are tracked
SELECT
  a.agent_name,
  aim.total_executions,
  aim.avg_tokens_per_run,
  aim.intensity_score,
  aim.last_calculated_at
FROM agent_intensity_metrics aim
JOIN agents a ON a.id = aim.agent_id
WHERE aim.total_executions > 0
ORDER BY aim.total_executions DESC;
```

---

## 3. INTENSITY SCORE CALCULATION

### Formula

```
intensity_score =
  (token_complexity_score × 0.35) +
  (execution_complexity_score × 0.25) +
  (plugin_complexity_score × 0.25) +
  (workflow_complexity_score × 0.15)

Result: 0-10 scale
Pricing Multiplier: 1.0 + (intensity_score / 10) = 1.0x to 2.0x
```

### Component Calculations

#### Token Complexity (35% weight)
```
token_volume_score = normalize(avg_tokens_per_run, ranges.token_volume.min, ranges.token_volume.max) → 0-10
token_peak_score = normalize(peak_tokens_single_run, ranges.token_peak.min, ranges.token_peak.max) → 0-10
token_efficiency_score = normalize(input_output_ratio, ranges.token_io_ratio_min, ranges.token_io_ratio_max) → 0-10 (inverted)

token_complexity_score = (token_volume_score × 0.5) + (token_peak_score × 0.3) + (token_efficiency_score × 0.2)
```

#### Execution Complexity (25% weight)
```
iteration_score = normalize(avg_iterations_per_run, ranges.iterations.min, ranges.iterations.max) → 0-10
duration_score = normalize(avg_execution_duration_ms, ranges.duration_ms.min, ranges.duration_ms.max) → 0-10
failure_rate_score = normalize(100 - success_rate, 0, ranges.failure_rate.max) → 0-10
retry_score = normalize(retry_rate, ranges.retry_rate.min, ranges.retry_rate.max) → 0-10

execution_complexity_score = (iteration_score × 0.35) + (duration_score × 0.30) + (failure_rate_score × 0.20) + (retry_score × 0.15)
```

#### Plugin Complexity (25% weight)
```
plugin_count_score = normalize(unique_plugins_used, ranges.plugin_count.min, ranges.plugin_count.max) → 0-10
plugin_frequency_score = normalize(avg_plugins_per_run, ranges.plugins_per_run.min, ranges.plugins_per_run.max) → 0-10
orchestration_score = normalize(tool_orchestration_overhead_ms, ranges.orchestration_overhead_ms.min, ranges.orchestration_overhead_ms.max) → 0-10

plugin_complexity_score = (plugin_count_score × 0.4) + (plugin_frequency_score × 0.35) + (orchestration_score × 0.25)
```

#### Workflow Complexity (15% weight)
```
steps_score = normalize(workflow_steps_count, ranges.workflow_steps.min, ranges.workflow_steps.max) → 0-10
branch_score = normalize(conditional_branches_count, ranges.branches.min, ranges.branches.max) → 0-10
loop_score = normalize(loop_iterations_count, ranges.loops.min, ranges.loops.max) → 0-10
parallel_score = normalize(parallel_execution_count, ranges.parallel.min, ranges.parallel.max) → 0-10

workflow_complexity_score = (steps_score × 0.4) + (branch_score × 0.25) + (loop_score × 0.20) + (parallel_score × 0.15)
```

### Normalize Function
```typescript
function normalize(value: number, min: number, max: number): number {
  const clamped = Math.max(min, Math.min(max, value));
  return (clamped - min) * 10 / (max - min);
}
```

---

## 4. VERIFICATION CHECKLIST

### ✅ Database Structure
```sql
-- Run all of these to verify database is set up correctly

-- 1. Check agent_intensity_metrics table exists
SELECT COUNT(*) as row_count FROM agent_intensity_metrics;

-- 2. Check ais_normalization_ranges table exists and has data
SELECT COUNT(*) as range_count FROM ais_normalization_ranges;
-- Expected: 15 rows

-- 3. Verify functions exist
SELECT routine_name FROM information_schema.routines
WHERE routine_name IN ('get_active_ais_ranges', 'update_dynamic_ais_ranges');
-- Expected: 2 rows

-- 4. Test get_active_ais_ranges function
SELECT * FROM get_active_ais_ranges();
-- Expected: 15 rows with range_key, min_value, max_value, category, description
```

### ✅ Creation Tracking
```sql
-- 5. Check agents have creation tokens tracked
SELECT
  COUNT(*) as total_agents,
  COUNT(CASE WHEN creation_tokens_used > 0 THEN 1 END) as agents_with_creation_tokens,
  ROUND(AVG(creation_tokens_used), 0) as avg_creation_tokens,
  ROUND(AVG(total_creation_cost_usd), 4) as avg_creation_cost
FROM agent_intensity_metrics;
-- Expected: All recent agents should have creation_tokens_used > 0

-- 6. Check token_usage table has creation records
SELECT
  activity_type,
  COUNT(*) as record_count,
  ROUND(AVG(input_tokens + output_tokens), 0) as avg_tokens
FROM token_usage
WHERE activity_type IN ('agent_creation', 'agent_generation')
GROUP BY activity_type;
-- Expected: Multiple records for both activity types
```

### ⚠️ Execution Tracking (Needs Real Agent Execution)
```sql
-- 7. Check if any agents have been executed
SELECT
  COUNT(*) as agents_executed,
  SUM(total_executions) as total_runs,
  ROUND(AVG(intensity_score), 2) as avg_intensity_score
FROM agent_intensity_metrics
WHERE total_executions > 0;
-- Expected: 0 if no agents have been run yet

-- 8. Check intensity scores are calculated
SELECT
  a.agent_name,
  aim.total_executions,
  aim.intensity_score,
  aim.token_complexity_score,
  aim.execution_complexity_score,
  aim.plugin_complexity_score,
  aim.workflow_complexity_score,
  ROUND(1.0 + (aim.intensity_score / 10.0), 2) as pricing_multiplier
FROM agent_intensity_metrics aim
JOIN agents a ON a.id = aim.agent_id
WHERE aim.total_executions > 0
ORDER BY aim.intensity_score DESC;
-- Expected: Empty if no executions, or scores should be 0-10
```

---

## 5. CRITICAL ISSUES TO CHECK

### Issue 1: Missing Normalization Table
**Symptom**: `get_active_ais_ranges()` returns empty or errors
**Impact**: Execution tracking will fail or use fallback defaults
**Fix**: Run the CREATE TABLE and INSERT statements from Section 1.2

### Issue 2: Functions Not Created
**Symptom**: Error "function get_active_ais_ranges() does not exist"
**Impact**: Cannot fetch ranges, intensity scores won't calculate
**Fix**: Run the CREATE FUNCTION statements from Section 1.3

### Issue 3: Execution Tracking Not Tested
**Symptom**: All agents show `total_executions = 0`
**Impact**: Don't know if execution tracking works
**Fix**: Run an agent via UI or API, check if metrics update

### Issue 4: Mode Flag Not Set
**Symptom**: `active_mode` is NULL in `ais_normalization_ranges`
**Impact**: System defaults to best_practice mode
**Fix**:
```sql
UPDATE ais_normalization_ranges SET active_mode = 0 WHERE active_mode IS NULL;
```

### Issue 5: Old Agents Missing Creation Tokens
**Symptom**: Agents created before 2025-01-29 show `creation_tokens_used = 0`
**Impact**: Incomplete data for those agents
**Fix**: Already backfilled via SQL in previous session

---

## 6. END-TO-END TEST PLAN

### Test 1: Verify Creation Tracking
1. Create a new agent via UI
2. Check server logs for:
   ```
   ✅ [AIS] Successfully tracked creation costs: XXXX tokens
   ```
3. Query database:
   ```sql
   SELECT creation_tokens_used, total_creation_cost_usd
   FROM agent_intensity_metrics
   WHERE agent_id = 'YOUR_AGENT_ID';
   ```
4. **Expected**: Should show ~7000-8000 tokens and ~$0.35 cost

### Test 2: Verify Execution Tracking
1. Run the newly created agent via UI
2. Check server logs for:
   ```
   ✅ [INTENSITY] Update result: SUCCESS
   ```
3. Query database:
   ```sql
   SELECT
     total_executions,
     intensity_score,
     token_complexity_score,
     execution_complexity_score,
     plugin_complexity_score,
     workflow_complexity_score
   FROM agent_intensity_metrics
   WHERE agent_id = 'YOUR_AGENT_ID';
   ```
4. **Expected**:
   - `total_executions` = 1
   - All component scores should be 0-10
   - `intensity_score` should be 0-10

### Test 3: Verify Score Recalculation
1. Run the same agent 4 more times (5 total executions)
2. Query after each run:
   ```sql
   SELECT
     total_executions,
     intensity_score,
     last_calculated_at
   FROM agent_intensity_metrics
   WHERE agent_id = 'YOUR_AGENT_ID';
   ```
3. **Expected**:
   - `total_executions` increments each time
   - `intensity_score` may change based on new data
   - `last_calculated_at` updates after each run

### Test 4: Verify Pricing Multiplier
1. After 5 executions, calculate multiplier:
   ```sql
   SELECT
     a.agent_name,
     aim.intensity_score,
     ROUND(1.0 + (aim.intensity_score / 10.0), 2) as pricing_multiplier
   FROM agent_intensity_metrics aim
   JOIN agents a ON a.id = aim.agent_id
   WHERE aim.agent_id = 'YOUR_AGENT_ID';
   ```
2. **Expected**: Multiplier should be between 1.0x and 2.0x

---

## 7. RECOMMENDED FIXES

### If Normalization Table is Missing
```sql
-- Run the full setup from Section 1.2
-- This creates table and populates with best practice ranges
```

### If Functions are Missing
```sql
-- Run the function definitions from Section 1.3
-- Creates get_active_ais_ranges() and update_dynamic_ais_ranges()
```

### If Execution Tracking Doesn't Work
1. Check `updateAgentIntensity.ts` can connect to database
2. Verify `get_active_ais_ranges()` returns data
3. Add more logging to track where it fails
4. Check for errors in server console during agent execution

---

## 8. SUCCESS CRITERIA

✅ **System is fully working if:**
1. `ais_normalization_ranges` table has 15 rows
2. `get_active_ais_ranges()` returns 15 ranges
3. New agents show `creation_tokens_used > 0`
4. Running an agent increments `total_executions`
5. Running an agent updates `intensity_score`
6. All component scores are 0-10
7. Pricing multiplier is 1.0x - 2.0x
8. Admin UI at `/app/admin/ais-config` loads without errors

---

## 9. NEXT STEPS

1. **Run Verification SQL** from Section 4 to check current state
2. **Fix Any Missing Components** using SQL from Sections 1.2 and 1.3
3. **Test Creation Tracking** by creating a new agent
4. **Test Execution Tracking** by running an agent 5 times
5. **Monitor Logs** during tests to catch any errors
6. **Update Dynamic Ranges** once you have 10+ agent executions:
   ```sql
   SELECT * FROM update_dynamic_ais_ranges();
   ```
7. **Enable Dynamic Mode** via admin UI if desired

---

## 10. CONTACT POINTS FOR ISSUES

| Component | File | Line | Purpose |
|-----------|------|------|---------|
| Creation Tracking | `app/api/create-agent/route.ts` | 222-309 | Queries token_usage and saves to metrics |
| Execution Tracking | `app/api/run-agent/route.ts` | 221-261 | Calls updateAgentIntensityMetrics |
| Score Calculation | `lib/utils/updateAgentIntensity.ts` | 68-190 | Calculates all scores and updates DB |
| Normalization Logic | `lib/utils/updateAgentIntensity.ts` | 249-299 | Component score calculations |
| Database Functions | `ais_normalization_ranges` table | N/A | Stores ranges, must be created |
| Admin API | `app/api/admin/ais-config/route.ts` | Full file | Manages mode switching |
