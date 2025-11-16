# Per-Step AIS Scoring & Routing - Implementation Guide

## Overview

The **Per-Step AIS (Agent Intensity System) Enhancement** adds granular complexity tracking and intelligent routing at the workflow step level. This enhancement provides visibility into every routing decision, tracks step-by-step complexity scores, and creates an audit trail for performance analysis and optimization.

### Key Benefits

✅ **Granular Visibility** - See complexity and routing decisions for each workflow step
✅ **Consistent Scoring** - AIS dimensions mapped from routing factors
✅ **Audit Trail** - Full history of routing decisions and their outcomes
✅ **Performance Analysis** - Compare predicted vs actual complexity
✅ **Cost Attribution** - Track costs and savings per step
✅ **Zero Breaking Changes** - Extends existing tables, fully backward compatible

---

## Architecture

### High-Level Flow

```
Workflow Execution
  ├─> WorkflowOrchestrator.executeStep()
  │   ├─> RoutingService.analyzeStepComplexity()  (6 factors → complexity score)
  │   ├─> RoutingService.route()                  (agent AIS + step complexity → tier)
  │   ├─> RoutingService.logStepRouting()         (save to workflow_step_executions)
  │   └─> logStepRoutingDecision()                (audit trail)
  │
  └─> Handler executes with selected model
      └─> StateManager updates execution_metadata
```

### Complexity Scoring System

**Two Parallel Systems (Unified)**:

1. **Agent-Level AIS** (Existing, unchanged)
   - Creation Score (4 dimensions): workflow, plugins, I/O, triggers
   - Execution Score (5 dimensions): tokens, execution, plugins, workflow, memory
   - Combined Score: 30% creation + 70% execution

2. **Step-Level Complexity** (New)
   - 6 Routing Factors: prompt length, data size, conditions, context depth, reasoning, output
   - Mapped to 4 AIS Dimensions: tokens, execution, workflow, memory
   - Combined with agent AIS: 60% agent + 40% step

### Routing Decision

```typescript
effectiveComplexity = (agentAIS × 0.6) + (stepComplexity × 0.4)

if (effectiveComplexity < 3.0)      → fast tier (Haiku)
if (effectiveComplexity 3.0-6.5)    → balanced tier (Haiku)
if (effectiveComplexity > 6.5)      → powerful tier (Sonnet)
```

---

## Database Schema

### Extended Table: `workflow_step_executions`

**New Columns Added** (all nullable for backward compatibility):

#### Complexity Analysis (6 Factors)
- `complexity_score` DECIMAL(4,2) - Overall 0-10 score
- `prompt_length_score` DECIMAL(4,2)
- `data_size_score` DECIMAL(4,2)
- `condition_count_score` DECIMAL(4,2)
- `context_depth_score` DECIMAL(4,2)
- `reasoning_depth_score` DECIMAL(4,2)
- `output_complexity_score` DECIMAL(4,2)

#### AIS-Mapped Dimensions (for consistency)
- `ais_token_complexity` DECIMAL(4,2) - (prompt + data) / 2
- `ais_execution_complexity` DECIMAL(4,2) - (reasoning + output) / 2
- `ais_workflow_complexity` DECIMAL(4,2) - condition_count
- `ais_memory_complexity` DECIMAL(4,2) - context_depth

#### Routing Decision
- `agent_ais_score` DECIMAL(4,2) - From agent_intensity_metrics
- `effective_complexity` DECIMAL(4,2) - Weighted average
- `selected_tier` TEXT - fast/balanced/powerful
- `selected_model` TEXT - e.g., claude-3-haiku-20240307
- `selected_provider` TEXT - e.g., anthropic
- `routing_reason` TEXT - Human-readable explanation
- `estimated_cost_usd` DECIMAL(10,6)
- `estimated_latency_ms` INTEGER

#### Raw Measurements (for debugging)
- `raw_prompt_length` INTEGER
- `raw_data_size` INTEGER
- `raw_condition_count` INTEGER
- `raw_context_depth` INTEGER

#### Timestamp
- `routed_at` TIMESTAMPTZ

---

## Code Integration Points

### 1. RoutingService (Extended)

**File**: `/lib/orchestration/RoutingService.ts`

**New Methods**:

```typescript
// Analyze step complexity (6 factors)
async analyzeStepComplexity(step: any, context?: any): Promise<StepComplexityAnalysis>

// Map 6 factors to 4 AIS dimensions
private mapComplexityToAIS(analysis: StepComplexityAnalysis)

// Log routing decision to database
async logStepRouting(
  workflowExecutionId: string,
  stepId: string,
  stepName: string,
  stepType: string,
  stepIndex: number,
  stepAnalysis: StepComplexityAnalysis,
  agentAIS: number,
  effectiveComplexity: number,
  decision: RoutingDecision
): Promise<void>

// Update with actual execution results (future use)
async updateStepRoutingMetrics(
  workflowExecutionId: string,
  stepId: string,
  actualTokensUsed: number,
  actualExecutionTime: number,
  actualCost: number,
  success: boolean,
  errorMessage?: string
): Promise<void>
```

### 2. WorkflowOrchestrator (Modified)

**File**: `/lib/orchestration/WorkflowOrchestrator.ts`

**executeStep() Changes**:

```typescript
// 1. Analyze step complexity BEFORE routing
const stepAnalysis = await routingService.analyzeStepComplexity(
  stepInput.step,
  stepInput.executionContext
);

// 2. Calculate effective complexity
const agentAIS = this.orchestrationMetadata.agentAIS?.combined_score || 5.0;
const effectiveComplexity = (agentAIS * 0.6) + (stepAnalysis.complexityScore * 0.4);

// 3. Route to model
const routingDecision = await routingService.route(context, step, executionContext);

// 4. Log routing decision to database
await routingService.logStepRouting(
  executionId, stepId, stepName, stepType, stepIndex,
  stepAnalysis, agentAIS, effectiveComplexity, routingDecision
);

// 5. Audit trail
await logStepRoutingDecision(agentId, agentName, userId, ...);
```

### 3. Audit Trail (New Function)

**File**: `/lib/audit/ais-helpers.ts`

**New Export**:

```typescript
export async function logStepRoutingDecision(
  agentId: string,
  agentName: string,
  userId: string,
  executionId: string,
  stepId: string,
  stepName: string,
  stepType: string,
  complexity: number,
  agentAIS: number,
  effectiveComplexity: number,
  tier: string,
  model: string,
  provider: string,
  reason: string
): Promise<void>
```

---

## Usage Examples

### Query: Find All Steps Routed to Powerful Tier

```sql
SELECT
  step_id,
  step_name,
  step_type,
  effective_complexity,
  selected_model,
  routing_reason,
  execution_metadata->>'tokens_used' AS actual_tokens,
  execution_metadata->>'execution_time' AS actual_time_ms
FROM workflow_step_executions
WHERE selected_tier = 'powerful'
ORDER BY routed_at DESC
LIMIT 50;
```

### Query: Compare Predicted vs Actual Cost

```sql
SELECT
  step_id,
  step_name,
  estimated_cost_usd,
  (execution_metadata->>'tokens_used')::INTEGER * 0.000003 AS actual_cost_usd,
  estimated_cost_usd - ((execution_metadata->>'tokens_used')::INTEGER * 0.000003) AS cost_variance
FROM workflow_step_executions
WHERE estimated_cost_usd IS NOT NULL
  AND execution_metadata->>'tokens_used' IS NOT NULL
ORDER BY ABS(cost_variance) DESC
LIMIT 25;
```

### Query: Complexity Distribution by Step Type

```sql
SELECT
  step_type,
  COUNT(*) AS step_count,
  AVG(complexity_score) AS avg_complexity,
  AVG(ais_token_complexity) AS avg_token_complexity,
  AVG(ais_execution_complexity) AS avg_execution_complexity,
  AVG(ais_workflow_complexity) AS avg_workflow_complexity,
  AVG(ais_memory_complexity) AS avg_memory_complexity
FROM workflow_step_executions
WHERE complexity_score IS NOT NULL
GROUP BY step_type
ORDER BY avg_complexity DESC;
```

### Query: Model Performance Analysis

```sql
SELECT
  selected_model,
  selected_tier,
  COUNT(*) AS executions,
  AVG((execution_metadata->>'execution_time')::INTEGER) AS avg_time_ms,
  AVG((execution_metadata->>'tokens_used')::INTEGER) AS avg_tokens,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::DECIMAL / COUNT(*) AS success_rate
FROM workflow_step_executions
WHERE selected_model IS NOT NULL
GROUP BY selected_model, selected_tier
ORDER BY executions DESC;
```

### Query: Routing Effectiveness (Tier vs Actual Complexity)

```sql
SELECT
  selected_tier,
  AVG(effective_complexity) AS avg_predicted_complexity,
  AVG((execution_metadata->>'tokens_used')::INTEGER) AS avg_actual_tokens,
  COUNT(*) AS decisions
FROM workflow_step_executions
WHERE selected_tier IS NOT NULL
GROUP BY selected_tier
ORDER BY avg_predicted_complexity ASC;
```

---

## Configuration

### Feature Toggle

Per-step tracking can be enabled/disabled via system configuration:

```sql
-- Enable (default)
UPDATE system_settings_config
SET value = 'true'::jsonb
WHERE key = 'orchestration_per_step_tracking_enabled';

-- Disable
UPDATE system_settings_config
SET value = 'false'::jsonb
WHERE key = 'orchestration_per_step_tracking_enabled';
```

**Effect**: When disabled, `logStepRouting()` becomes a no-op. Routing still works, just no database logging.

---

## Migration Guide

### Running the Migration

```bash
# Navigate to project
cd /Users/yaelomer/Documents/neuronforge

# Run migration via Supabase CLI
npx supabase db push

# OR manually via SQL Editor in Supabase Dashboard
# Copy contents of: supabase/migrations/20251115_per_step_routing_tracking.sql
```

### Verification

After migration, run these checks:

```sql
-- 1. Verify columns exist
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'workflow_step_executions'
  AND column_name IN (
    'complexity_score',
    'ais_token_complexity',
    'selected_tier',
    'routing_reason'
  );

-- 2. Verify indexes created
SELECT indexname
FROM pg_indexes
WHERE tablename = 'workflow_step_executions'
  AND indexname LIKE 'idx_step_%';

-- 3. Check configuration flag
SELECT key, value
FROM system_settings_config
WHERE key = 'orchestration_per_step_tracking_enabled';
```

### Rollback (if needed)

See rollback script at bottom of migration file:

```sql
ALTER TABLE workflow_step_executions
  DROP COLUMN IF EXISTS complexity_score,
  DROP COLUMN IF EXISTS ais_token_complexity,
  -- ... (all new columns)

DROP INDEX IF EXISTS idx_step_routing_tier;
-- ... (all new indexes)

DELETE FROM system_settings_config
WHERE key = 'orchestration_per_step_tracking_enabled';
```

---

## Performance Considerations

### Database Impact

- **Storage**: ~200 bytes per step execution (24 new columns)
- **Write overhead**: 1 UPDATE per LLM step (deterministic steps skip)
- **Query performance**: 5 new indexes for fast lookups
- **Typical workflow**: 3-10 LLM steps → 600-2000 bytes per execution

### Computational Overhead

- **Complexity analysis**: ~5-10ms per step
- **Database logging**: ~10-20ms per step
- **Total overhead**: ~15-30ms per LLM step (negligible vs 800ms+ model latency)

### Optimization Tips

1. **Batch queries** - Use `IN` clauses for multi-step analysis
2. **Index usage** - Ensure queries use `selected_tier`, `complexity_score` indexes
3. **Archival** - Periodically archive old step executions (>90 days)
4. **Monitoring** - Watch `pg_stat_user_indexes` for index effectiveness

---

## Troubleshooting

### Issue: Complexity scores are NULL

**Cause**: Step was executed before migration or tracking is disabled

**Solution**:
```sql
-- Check if tracking is enabled
SELECT value FROM system_settings_config
WHERE key = 'orchestration_per_step_tracking_enabled';

-- Check if columns exist
SELECT column_name FROM information_schema.columns
WHERE table_name = 'workflow_step_executions'
  AND column_name = 'complexity_score';
```

### Issue: Routing reasons are generic

**Cause**: Enhanced routing failed, using fallback decision

**Solution**: Check logs for routing errors:
```typescript
// Look for these console warnings:
"[WorkflowOrchestrator] Enhanced routing failed, using default"
"[RoutingService] Failed to load complexity config"
```

### Issue: AIS dimensions don't match step factors

**Cause**: Mapping formula discrepancy

**Solution**: Verify mapping in RoutingService:
```typescript
// Should be:
token_complexity = (prompt_length + data_size) / 2
execution_complexity = (reasoning_depth + output_complexity) / 2
workflow_complexity = condition_count
memory_complexity = context_depth
```

---

## Future Enhancements

### Phase 2: Machine Learning Integration

- Train ML model on routing outcomes
- Predict optimal tier based on historical performance
- Auto-adjust thresholds for better accuracy

### Phase 3: Cost Optimization

- Real-time cost prediction refinement
- Budget allocation learning
- Model switching based on cost/performance trade-offs

### Phase 4: Multi-Dimensional Analysis

- Correlation between step types and complexity
- Workflow pattern recognition
- Anomaly detection for unusual routing decisions

### Phase 5: Admin UI Dashboard

- Visual complexity heatmaps
- Model performance charts
- Cost attribution reports
- Routing decision explorer

---

## Summary

### Files Modified

**New Migration**:
- `/supabase/migrations/20251115_per_step_routing_tracking.sql`

**Modified Code**:
- `/lib/orchestration/RoutingService.ts` - Added logging methods
- `/lib/orchestration/WorkflowOrchestrator.ts` - Integrated step tracking
- `/lib/audit/ais-helpers.ts` - Added audit function

**Documentation**:
- `/docs/PER_STEP_AIS_IMPLEMENTATION.md` (this file)

### Impact

✅ **Zero Breaking Changes** - All existing code works as-is
✅ **Backward Compatible** - Old executions don't have routing data (NULL)
✅ **Forward Compatible** - Ready for ML/optimization enhancements
✅ **Production Ready** - Feature toggle for safe rollout

### Next Steps

1. ✅ Run migration
2. ✅ Test with a workflow execution
3. ✅ Query `workflow_step_executions` to verify data
4. ✅ Monitor performance impact
5. 🔄 Analyze routing effectiveness over time
6. 🔄 Tune complexity thresholds if needed

---

## Questions?

For implementation questions or issues:
- Review the code in `/lib/orchestration/RoutingService.ts`
- Check console logs during execution
- Query the database for routing data
- Refer to the original [Semantic Search Implementation](/docs/SEMANTIC_SEARCH_IMPLEMENTATION.md) for similar patterns

**Last Updated**: 2025-11-15
**Version**: 1.0.0
**Status**: Production Ready
