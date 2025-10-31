# Calculator AIS Implementation Analysis

## Current Implementation Analysis

### ❌ Problem: Calculator Has Its Own AIS Calculation

**Location**: `components/billing/PilotCreditCalculator.tsx` (Lines 164-212)

The calculator currently **calculates its own AIS score** instead of using the real AIS system. This creates several issues:

1. **Duplicated Logic**: AIS calculation exists in two places
   - Real AIS: `lib/services/AgentIntensityService.ts`
   - Calculator: `components/billing/PilotCreditCalculator.tsx` (lines 164-212)

2. **Estimation-Based**: Calculator uses **estimated values** based on plugin count:
   ```typescript
   const estimatedAvgTokens = 1000 + (pluginsPerAgent * 400);
   const estimatedPeakTokens = estimatedAvgTokens * 1.5;
   const estimatedIterations = Math.min(3 + pluginsPerAgent, 10);
   ```

3. **Not Configurable**: Calculator formulas are hardcoded in component
   - Can't be changed from admin panel
   - Requires code deployment to modify

### ✅ Real AIS System

**Location**: `lib/services/AgentIntensityService.ts`

The real system calculates AIS based on **actual execution data**:
- Real token usage (not estimated)
- Real iteration counts
- Real plugin usage
- Real workflow complexity

## What Needs to Be Configurable

### 1. Calculator Estimation Formulas

These are currently **hardcoded** in the calculator (lines 169-174):

```typescript
// HARDCODED - Should be in database:
const estimatedAvgTokens = 1000 + (pluginsPerAgent * 400);  // Base: 1000, Per-plugin: 400
const estimatedPeakTokens = estimatedAvgTokens * 1.5;       // Peak multiplier: 1.5x
const estimatedIterations = Math.min(3 + pluginsPerAgent, 10); // Base: 3, max: 10
const estimatedWorkflowSteps = Math.max(1, pluginsPerAgent);
```

**Should be in `ais_system_config` table:**
- `calculator_base_tokens` = 1000
- `calculator_tokens_per_plugin` = 400
- `calculator_peak_multiplier` = 1.5
- `calculator_base_iterations` = 3
- `calculator_max_iterations` = 10
- `calculator_plugin_usage_rate` = 0.8 (80%)
- `calculator_orchestration_overhead_ms` = 1000

### 2. Pricing Parameters

These **ARE** already in database (via `get_pricing_config` RPC):
- ✅ `runs_per_agent_per_month` = 15
- ✅ `agent_creation_cost` = 800
- ✅ `credit_cost_usd` = 0.00048
- ✅ `minimum_monthly_cost_usd` = 10.00

### 3. AIS Dimension Weights

These are **hardcoded** in calculator (lines 204-209):

```typescript
// HARDCODED - Should match real AIS system:
const intensityScore = (
  tokenScore * 0.35 +      // Token dimension weight
  executionScore * 0.25 +  // Execution dimension weight
  pluginScore * 0.25 +     // Plugin dimension weight
  workflowScore * 0.15     // Workflow dimension weight
);
```

**Should be in database** (matching real AIS):
- `ais_weight_tokens` = 0.35
- `ais_weight_execution` = 0.25
- `ais_weight_plugins` = 0.25
- `ais_weight_workflow` = 0.15

### 4. Sub-dimension Weights

Each dimension has sub-weights (currently hardcoded):

**Token Score** (line 177-181):
```typescript
const tokenScore = (
  normalizeToScale(estimatedAvgTokens, 'token_volume') * 0.5 +
  normalizeToScale(estimatedPeakTokens, 'token_peak') * 0.3 +
  normalizeToScale(2.0, 'token_io_ratio_max') * 0.2
);
```

**Execution Score** (line 183-188):
```typescript
const executionScore = (
  normalizeToScale(estimatedIterations, 'iterations') * 0.35 +
  normalizeToScale(10000, 'duration_ms') * 0.30 +
  normalizeToScale(10, 'failure_rate') * 0.20 +
  normalizeToScale(0.5, 'retry_rate') * 0.15
);
```

**Should be in database**.

## Database Schema Changes Needed

### New Config Keys for `ais_system_config` table:

```sql
-- Calculator Estimation Formulas
INSERT INTO ais_system_config (config_key, config_value, description) VALUES
('calculator_base_tokens', 1000, 'Base token count for calculator estimation'),
('calculator_tokens_per_plugin', 400, 'Additional tokens per plugin'),
('calculator_peak_multiplier', 1.5, 'Peak tokens multiplier (1.5 = 50% above average)'),
('calculator_base_iterations', 3, 'Base iteration count'),
('calculator_max_iterations', 10, 'Maximum iteration count'),
('calculator_plugin_usage_rate', 0.8, 'Percentage of plugins used per run (0.8 = 80%)'),
('calculator_orchestration_overhead_ms', 1000, 'Orchestration overhead in milliseconds'),
('calculator_estimated_duration_ms', 10000, 'Estimated execution duration'),
('calculator_estimated_failure_rate', 10, 'Estimated failure rate percentage'),
('calculator_estimated_retry_rate', 0.5, 'Estimated retry rate'),
('calculator_io_ratio', 2.0, 'Estimated input/output token ratio');

-- AIS Dimension Weights (for consistency check)
INSERT INTO ais_system_config (config_key, config_value, description) VALUES
('ais_weight_tokens', 0.35, 'Weight for token dimension in AIS score'),
('ais_weight_execution', 0.25, 'Weight for execution dimension in AIS score'),
('ais_weight_plugins', 0.25, 'Weight for plugin dimension in AIS score'),
('ais_weight_workflow', 0.15, 'Weight for workflow dimension in AIS score');

-- Token Sub-weights
INSERT INTO ais_system_config (config_key, config_value, description) VALUES
('ais_token_volume_weight', 0.5, 'Weight for average token volume'),
('ais_token_peak_weight', 0.3, 'Weight for peak token usage'),
('ais_token_io_weight', 0.2, 'Weight for I/O ratio');

-- Execution Sub-weights
INSERT INTO ais_system_config (config_key, config_value, description) VALUES
('ais_execution_iterations_weight', 0.35, 'Weight for iteration count'),
('ais_execution_duration_weight', 0.30, 'Weight for execution duration'),
('ais_execution_failure_weight', 0.20, 'Weight for failure rate'),
('ais_execution_retry_weight', 0.15, 'Weight for retry rate');

-- Plugin Sub-weights
INSERT INTO ais_system_config (config_key, config_value, description) VALUES
('ais_plugin_count_weight', 0.4, 'Weight for total plugin count'),
('ais_plugin_usage_weight', 0.35, 'Weight for plugins used per run'),
('ais_plugin_overhead_weight', 0.25, 'Weight for orchestration overhead');

-- Workflow Sub-weights
INSERT INTO ais_system_config (config_key, config_value, description) VALUES
('ais_workflow_steps_weight', 0.4, 'Weight for workflow step count'),
('ais_workflow_branches_weight', 0.25, 'Weight for branch count'),
('ais_workflow_loops_weight', 0.20, 'Weight for loop count'),
('ais_workflow_parallel_weight', 0.15, 'Weight for parallel execution');
```

## Admin Interface Design

### New Admin Page: `/app/admin/calculator-config/page.tsx`

**Sections:**

1. **Estimation Formulas**
   - Base tokens
   - Tokens per plugin
   - Peak multiplier
   - Iteration settings
   - Plugin usage rate
   - Orchestration overhead

2. **Pricing Parameters**
   - Runs per agent per month
   - Agent creation cost
   - Credit cost (USD)
   - Minimum monthly cost

3. **AIS Dimension Weights**
   - Token weight (35%)
   - Execution weight (25%)
   - Plugin weight (25%)
   - Workflow weight (15%)
   - **Total must = 100%**

4. **Sub-dimension Weights** (Collapsible sections)
   - Token sub-weights
   - Execution sub-weights
   - Plugin sub-weights
   - Workflow sub-weights
   - **Each group must = 100%**

5. **Preview Section**
   - Real-time calculator preview
   - Test with different inputs
   - Compare with current production values

## Implementation Plan

### Phase 1: Database Setup ✓
1. Add new config keys to `ais_system_config` table
2. Populate with current hardcoded values
3. Create migration script

### Phase 2: API Updates
1. Update `/api/pricing/config` to include calculator estimation params
2. Create new endpoint `/api/admin/calculator-config` for admin updates
3. Add validation for weight totals (must = 100%)

### Phase 3: Calculator Refactor
1. Remove hardcoded values from `PilotCreditCalculator.tsx`
2. Fetch config from API
3. Use config values for all calculations
4. Add loading states

### Phase 4: Admin Interface
1. Create admin page with form
2. Add real-time validation
3. Add preview functionality
4. Add audit logging for config changes

### Phase 5: Testing
1. Verify calculator matches real AIS system
2. Test edge cases
3. Ensure weights always total 100%
4. Test admin interface

## Benefits

1. **No Code Deploys**: Change calculator behavior without deployment
2. **Consistency**: Ensure calculator matches real AIS system
3. **Experimentation**: A/B test different pricing models
4. **Audit Trail**: Track all config changes in audit log
5. **Flexibility**: Quickly respond to market changes
