# Cost Calculation Audit & Fix Plan

## The Problem

**Issue**: Agents running with intelligent routing (using `gpt-4o-mini`) are being recorded in `token_usage` table with `model_name='gpt-4o'`, causing incorrect cost calculations.

**Impact**:
- Analytics shows inflated costs (16x higher!)
- Users see incorrect spending
- Intelligent routing savings not reflected

## Example:
```
Agent runs with gpt-4o-mini (via intelligent routing)
→ Uses 10,000 tokens
→ Actual cost: 10,000 × $0.00015/1k = $1.50
→ Recorded in DB: model_name='gpt-4o'
→ Shown cost: 10,000 × $0.0025/1k = $25.00
→ ERROR: 16x overcharge!
```

---

## Part 1: Audit All Cost Calculation Points

### Places Where LLM Costs Are Calculated:

#### 1. **OpenAIProvider** - `/lib/ai/providers/openaiProvider.ts`
**Line 262-268**: `calculateCost()`
```typescript
private calculateCost(model: string, usage: any): number {
  return calculateCostSync(
    'openai',
    model,  // ← Uses the model parameter passed in
    usage?.prompt_tokens || 0,
    usage?.completion_tokens || 0
  );
}
```
**Status**: ✅ Uses `calculateCostSync` from pricing.ts (database-backed)
**Issue**: ⚠️ Depends on correct `model` being passed in

#### 2. **AnthropicProvider** - `/lib/ai/providers/anthropicProvider.ts`
**Similar to OpenAI**
**Status**: ✅ Uses `calculateCostSync`
**Issue**: ⚠️ Depends on correct `model` being passed in

#### 3. **usageTracker** - `/lib/utils/usageTracker.ts`
**Line 68-91**: `calculateCost()`
```typescript
export function calculateCost(...) {
  const pricing = MODEL_PRICING[provider][modelName]  // ← HARDCODED!
  const inputCost = (inputTokens / 1000) * pricing.input
  const outputCost = (outputTokens / 1000) * pricing.output
  return inputCost + outputCost
}
```
**Status**: ❌ **DEPRECATED** but still has hardcoded pricing
**Action**: Should NOT be used anywhere

#### 4. **AIAnalyticsService** - `/lib/analytics/aiAnalytics.ts`
**Status**: Need to check - does it recalculate costs or use stored `cost_usd`?

---

## Part 2: Find Root Cause

### Where is the model name set incorrectly?

**Hypothesis**: When tracking token usage, the wrong model name is passed.

**Need to trace:**
1. AgentKit runs with intelligent routing
2. Selects `gpt-4o-mini`
3. Calls `openaiProvider.chatCompletion(params.model = 'gpt-4o-mini')`
4. Provider tracks usage with **what model name?**

**Suspect Files:**
- `/lib/agentkit/runAgentKit.ts` - Where model selection happens
- `/lib/ai/providers/openaiProvider.ts` - Where tracking happens
- `/lib/ai/providers/baseProvider.ts` - Base tracking logic

---

## Part 3: SQL Analysis Script

### Find Agents That Ran with Mini but Recorded as GPT-4o

```sql
-- Check if we have audit trail of model routing decisions
SELECT
  action,
  entity_id as agent_id,
  details->>'model_used' as actual_model,
  details->>'routing_enabled' as routing_enabled,
  created_at
FROM audit_trail
WHERE action = 'AGENTKIT_EXECUTION_COMPLETED'
  AND details->>'model_used' = 'gpt-4o-mini'
ORDER BY created_at DESC
LIMIT 10;

-- Compare with token_usage for same time period
-- (Need to join by user_id, timestamp, and approximate token count)
```

### Calculate Price Differences

```sql
WITH routing_executions AS (
  -- Get all executions that used gpt-4o-mini via routing
  SELECT
    entity_id as agent_id,
    user_id,
    details->>'model_used' as actual_model,
    (details->>'total_tokens')::int as total_tokens,
    created_at
  FROM audit_trail
  WHERE action = 'AGENTKIT_EXECUTION_COMPLETED'
    AND details->>'model_used' = 'gpt-4o-mini'
    AND created_at > NOW() - INTERVAL '7 days'
),
token_records AS (
  -- Get corresponding token_usage records
  SELECT
    t.id,
    t.user_id,
    t.model_name as recorded_model,
    t.total_tokens,
    t.input_tokens,
    t.output_tokens,
    t.cost_usd as recorded_cost,
    t.created_at
  FROM token_usage t
  WHERE t.created_at > NOW() - INTERVAL '7 days'
),
pricing AS (
  -- Get current pricing
  SELECT
    provider,
    model_name,
    input_cost_per_token,
    output_cost_per_token
  FROM ai_model_pricing
  WHERE provider = 'openai'
    AND model_name IN ('gpt-4o', 'gpt-4o-mini')
    AND retired_date IS NULL
)
SELECT
  tr.id,
  tr.recorded_model,
  'gpt-4o-mini' as actual_model,
  tr.total_tokens,
  tr.recorded_cost as incorrect_cost,
  (
    (tr.input_tokens * p_mini.input_cost_per_token) +
    (tr.output_tokens * p_mini.output_cost_per_token)
  ) as correct_cost,
  tr.recorded_cost - (
    (tr.input_tokens * p_mini.input_cost_per_token) +
    (tr.output_tokens * p_mini.output_cost_per_token)
  ) as overcharge_amount,
  ROUND(
    (tr.recorded_cost / NULLIF(
      (tr.input_tokens * p_mini.input_cost_per_token) +
      (tr.output_tokens * p_mini.output_cost_per_token),
    0) - 1) * 100,
  2) as overcharge_percentage
FROM token_records tr
CROSS JOIN pricing p_gpt4o
CROSS JOIN pricing p_mini
WHERE p_gpt4o.model_name = 'gpt-4o'
  AND p_mini.model_name = 'gpt-4o-mini'
  AND tr.recorded_model = 'gpt-4o'
  -- Join condition: try to match with routing_executions by time and tokens
  AND EXISTS (
    SELECT 1 FROM routing_executions re
    WHERE re.user_id = tr.user_id
      AND ABS(EXTRACT(EPOCH FROM (re.created_at - tr.created_at))) < 60  -- Within 60 seconds
      AND ABS(re.total_tokens - tr.total_tokens) < 100  -- Within 100 tokens
  )
ORDER BY overcharge_amount DESC;
```

---

## Part 4: Fix Strategy

### Immediate Fixes Needed:

1. **Find Where Model Name Gets Lost**
   - Trace from `runAgentKit` → `openaiProvider.chatCompletion`
   - Ensure `selectedModel` is passed correctly
   - Verify it's used in tracking

2. **Update Provider Tracking**
   - Make sure `model` parameter in tracking matches actual model used
   - Not the default or configured model

3. **Deprecate usageTracker**
   - Ensure nothing is using the old `calculateCost` from usageTracker.ts
   - All should use `calculateCostSync` from pricing.ts

4. **Backfill Incorrect Records** (Optional)
   - Update `cost_usd` for mis-recorded executions
   - Keep `model_name` as-is for historical record
   - Or add `actual_model_used` column

---

## Part 5: Testing Plan

1. **Run agent with LOW intensity** (should use gpt-4o-mini)
2. **Check audit_trail**: Verify `AGENTKIT_EXECUTION_COMPLETED` has `model_used: 'gpt-4o-mini'`
3. **Check token_usage**: Verify `model_name='gpt-4o-mini'`
4. **Check cost**: Verify `cost_usd` matches gpt-4o-mini pricing
5. **Check analytics**: Verify cost shown is correct

---

## Files to Investigate

### Priority 1 - Tracking Logic:
- `/lib/agentkit/runAgentKit.ts` - Model selection
- `/lib/ai/providers/openaiProvider.ts` - Usage tracking
- `/lib/ai/providers/baseProvider.ts` - Base tracking

### Priority 2 - Cost Calculation:
- `/lib/ai/pricing.ts` - Database pricing (CORRECT)
- `/lib/utils/usageTracker.ts` - Hardcoded pricing (DEPRECATED - should not be used)

### Priority 3 - Analytics Display:
- `/lib/analytics/aiAnalytics.ts` - Analytics service
- `/lib/utils/analyticsHelpers.ts` - Formatters
- `/components/analytics/AnalyticsView.tsx` - UI

---

## Expected Outcomes

### Before Fix:
```
Agent runs with intelligent routing
→ AIS Score: 45 (LOW)
→ Routing selects: gpt-4o-mini
→ Execution completes
→ token_usage record: model_name='gpt-4o' ❌
→ cost_usd: $0.025 ❌ (using gpt-4o pricing)
→ Analytics shows: $0.025 ❌
```

### After Fix:
```
Agent runs with intelligent routing
→ AIS Score: 45 (LOW)
→ Routing selects: gpt-4o-mini
→ Execution completes
→ token_usage record: model_name='gpt-4o-mini' ✅
→ cost_usd: $0.0015 ✅ (using gpt-4o-mini pricing)
→ Analytics shows: $0.0015 ✅
```

**Savings shown correctly**: 94% cost reduction via intelligent routing!
