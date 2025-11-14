# Workflow Orchestrator Upgrade - GPT-4o Mini Implementation

## Overview

Implemented hybrid AI workflow generation system using GPT-4o Mini as primary orchestrator with Claude Sonnet 4 fallback. This provides **97% cost savings** while maintaining quality through intelligent fallback mechanisms.

## Cost Analysis

### Before (Claude Sonnet 4 Only)
- **Input tokens**: ~2,000 @ $3.00 per 1M = $0.006
- **Output tokens**: ~1,500 @ $15.00 per 1M = $0.0225
- **Total cost per agent**: ~$0.03

### After (GPT-4o Mini Primary)
- **Input tokens**: ~2,000 @ $0.15 per 1M = $0.0003
- **Output tokens**: ~1,500 @ $0.60 per 1M = $0.0009
- **Total cost per agent**: ~$0.001

### Savings
- **Per agent**: $0.029 (97% reduction)
- **100 agents**: $2.90 saved
- **10,000 agents**: $290 saved
- **100,000 agents**: $2,900 saved

## Implementation

### 1. New WorkflowOrchestrator Class

Created `/lib/pilot/WorkflowOrchestrator.ts` with the following features:

**Key Methods**:
- `generateWorkflow()`: Main entry point with model selection
- `generateWithGPT4oMini()`: Primary generator with validation
- `generateWithClaudeSonnet()`: Fallback/alternative generator
- `validateWorkflow()`: Schema validation for generated workflows

**Workflow Validation**:
- Checks pilot_steps is an array
- Validates step count (1-50 steps)
- Ensures each step has required fields:
  - `id`: Unique identifier
  - `operation`: Step description
  - `step_type`: One of 4 types (llm_decision, transform, conditional, api_call)

**Fallback Logic**:
1. Try GPT-4o Mini first
2. Validate generated workflow
3. If validation fails → automatic retry with Claude Sonnet 4
4. Log fallback reason to audit trail
5. Return result with generator_used flag

### 2. System Configuration

Added 3 new system config keys:

```typescript
// Primary orchestrator model
orchestrator_primary_model: 'gpt-4o-mini' | 'claude-sonnet-4'
Default: 'gpt-4o-mini'

// Fallback orchestrator model
orchestrator_fallback_model: 'gpt-4o-mini' | 'claude-sonnet-4'
Default: 'claude-sonnet-4'

// Enable/disable fallback
orchestrator_enable_fallback: boolean
Default: true
```

### 3. Audit Trail Integration

Added 2 new audit events:

**WORKFLOW_GENERATED**:
- Severity: info
- Compliance: SOC2
- Logged when workflow generation succeeds
- Includes: generator_used, steps_generated, tokens_used, cost_usd, generation_time_ms

**WORKFLOW_GENERATION_FALLBACK**:
- Severity: warning
- Compliance: SOC2
- Logged when GPT-4o Mini fails and Claude is used
- Includes: primary_model, fallback_model, reason, tokens_wasted

### 4. System Flow Visualization Updated

Updated Step 3 in `/app/admin/system-flow/page.tsx`:

**Before**:
```
generator: 'claude-sonnet-4'
```

**After**:
```
primary_generator: 'gpt-4o-mini'
fallback_generator: 'claude-sonnet-4'
cost_savings: '97%'
validation: 'schema checked'
```

## Usage

### Basic Usage (Defaults)

```typescript
import { WorkflowOrchestrator } from '@/lib/pilot/WorkflowOrchestrator';

const orchestrator = new WorkflowOrchestrator();

const result = await orchestrator.generateWorkflow(
  supabase,
  userId,
  agentId,
  "Process customer orders and send summary emails",
  ['google-mail', 'google-sheets']
);

console.log(`Generated with: ${result.generator_used}`); // "gpt-4o-mini"
console.log(`Cost: $${result.cost_usd}`); // $0.001
console.log(`Steps: ${result.pilot_steps.length}`); // 12
```

### Advanced Usage (Custom Config)

```typescript
// 1. Set custom orchestrator model via admin UI
// Navigate to: /admin/system-config
// Update: orchestrator_primary_model = 'claude-sonnet-4'

// 2. Disable fallback for testing
// Update: orchestrator_enable_fallback = false

// 3. Use orchestrator as normal
const result = await orchestrator.generateWorkflow(...);
// Will now use Claude Sonnet 4 without fallback
```

## Return Value

```typescript
interface WorkflowGenerationResult {
  pilot_steps: PilotStep[];           // Generated workflow steps
  generator_used: 'gpt-4o-mini' | 'claude-sonnet-4';
  validation_passed: boolean;          // Schema validation result
  generation_time_ms: number;          // Generation latency
  tokens_used: {
    input: number;
    output: number;
    total: number;
  };
  cost_usd: number;                    // Actual cost incurred
  fallback_reason?: string;            // Why fallback was triggered (if applicable)
}
```

## Fallback Triggers

GPT-4o Mini → Claude Sonnet 4 fallback occurs when:

1. **Validation fails**: Generated workflow doesn't pass schema validation
2. **API error**: OpenAI API returns error
3. **Timeout**: Generation takes >30 seconds
4. **Rate limit**: OpenAI rate limit exceeded

## Quality Assurance

### Validation Checks

```typescript
// Workflow must pass all checks:
✓ pilot_steps is an array
✓ Has 1-50 steps
✓ Each step has valid id (string)
✓ Each step has valid operation (string)
✓ Each step has valid step_type (enum)
```

### Testing Recommendations

1. **Monitor Fallback Rate**:
   ```sql
   SELECT
     COUNT(*) FILTER (WHERE details->>'fallback_reason' IS NOT NULL) * 100.0 / COUNT(*) as fallback_rate
   FROM audit_logs
   WHERE action = 'WORKFLOW_GENERATED'
   AND timestamp > NOW() - INTERVAL '7 days';
   ```

2. **Track Cost Savings**:
   ```sql
   SELECT
     SUM((details->>'cost_usd')::decimal) as total_cost,
     COUNT(*) as total_workflows,
     details->>'generator_used' as generator
   FROM audit_logs
   WHERE action = 'WORKFLOW_GENERATED'
   GROUP BY generator;
   ```

3. **Measure Quality**:
   - Compare agent success rates (gpt-4o-mini vs claude-sonnet-4)
   - Track user regeneration frequency
   - Monitor validation failure rates

## Admin Configuration UI

To enable admin configuration, create a new section in `/app/admin/system-config/page.tsx`:

```typescript
<div className="bg-white rounded-lg shadow p-6">
  <h3 className="text-lg font-semibold mb-4">Workflow Orchestrator</h3>

  <div className="space-y-4">
    <div>
      <label className="block text-sm font-medium mb-2">
        Primary Generator
      </label>
      <select
        value={orchestratorPrimary}
        onChange={(e) => updateConfig('orchestrator_primary_model', e.target.value)}
      >
        <option value="gpt-4o-mini">GPT-4o Mini ($0.001/agent)</option>
        <option value="claude-sonnet-4">Claude Sonnet 4 ($0.03/agent)</option>
      </select>
    </div>

    <div>
      <label className="block text-sm font-medium mb-2">
        Fallback Generator
      </label>
      <select
        value={orchestratorFallback}
        onChange={(e) => updateConfig('orchestrator_fallback_model', e.target.value)}
      >
        <option value="claude-sonnet-4">Claude Sonnet 4</option>
        <option value="gpt-4o-mini">GPT-4o Mini</option>
      </select>
    </div>

    <div>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enableFallback}
          onChange={(e) => updateConfig('orchestrator_enable_fallback', e.target.checked)}
        />
        <span className="text-sm">Enable automatic fallback</span>
      </label>
    </div>
  </div>
</div>
```

## Migration Path

### Phase 1: Soft Launch (Week 1)
- Deploy WorkflowOrchestrator with fallback enabled
- Keep primary as GPT-4o Mini
- Monitor fallback rate and quality metrics
- Target: <5% fallback rate

### Phase 2: Confidence Building (Week 2-3)
- Analyze workflows generated by each model
- Compare user satisfaction scores
- Collect validation failure patterns
- If fallback >10%: Improve GPT-4o Mini prompts

### Phase 3: Cost Optimization (Week 4+)
- If fallback <5%: Consider disabling fallback for some agents
- If fallback <2%: Consider removing Claude entirely for simple agents
- Monitor cumulative cost savings

## Expected Outcomes

### Cost Impact (assuming 10,000 agents/month)
- **Before**: $300/month on workflow generation
- **After (95% GPT-4o Mini, 5% fallback)**: $28.50/month
- **Savings**: $271.50/month ($3,258/year)

### Quality Expectations
- **GPT-4o Mini success rate**: 92-95%
- **With fallback**: 99%+
- **User regeneration rate**: <3%
- **Validation failure rate**: <1%

## Monitoring Dashboard

Recommended metrics to track:

1. **Cost Efficiency**
   - Daily orchestrator costs
   - Cost per generated workflow
   - Savings vs Claude-only baseline

2. **Quality Metrics**
   - Validation success rate by model
   - Fallback trigger frequency
   - User regeneration requests
   - Agent execution success rates

3. **Performance**
   - Average generation time
   - P95/P99 latency
   - API error rates

## Rollback Plan

If quality issues arise:

1. **Immediate**: Set `orchestrator_primary_model = 'claude-sonnet-4'`
2. **Monitor**: Check if issues resolve
3. **Investigate**: Review failed GPT-4o Mini workflows
4. **Improve**: Update prompts/validation
5. **Re-enable**: Gradual rollout with better prompts

## Files Changed

1. **Created**:
   - `/lib/pilot/WorkflowOrchestrator.ts` - Main orchestrator class

2. **Modified**:
   - `/lib/audit/events.ts` - Added WORKFLOW_GENERATED, WORKFLOW_GENERATION_FALLBACK events
   - `/app/admin/system-flow/page.tsx` - Updated Step 3 description

3. **Next Steps**:
   - Integrate WorkflowOrchestrator into `/app/api/generate-agent-v2/route.ts`
   - Add admin configuration UI to `/app/admin/system-config/page.tsx`
   - Create monitoring dashboard for orchestrator metrics

---

**Implementation Date**: 2025-11-04
**Status**: Ready for Integration
**Estimated Impact**: $3,258/year cost savings at 10K agents/month scale
