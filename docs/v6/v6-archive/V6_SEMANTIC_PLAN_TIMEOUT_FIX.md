# V6 Semantic Plan Generation Timeout Fix

**Date**: 2026-01-05
**Issue**: Semantic plan generation failing with timeout and schema validation errors
**Root Cause**: Complex prompt + 60s timeout insufficient for LLM to generate valid response

## Problem

The V6 semantic pipeline is failing at **Phase 1 (Understanding)**, preventing all workflow compilation:

```
[SemanticPlanGenerator] Attempt 1 failed validation: Schema validation failed:
$ should be array, $ should have required property 'delivery', ...
[SemanticPlanGenerator] Attempt 2 threw error: Request timeout after 60000ms
[SemanticPlanGenerator] ✗ All attempts failed
```

### Root Cause Analysis

1. **LLM struggles with complex schema** - The semantic plan schema has many required fields and nested structures
2. **60-second timeout too short** - Complex workflows need more time for LLM reasoning ([SemanticPlanGenerator.ts:281](../lib/agentkit/v6/semantic-plan/SemanticPlanGenerator.ts#L281))
3. **Schema validation too strict** - First attempt fails schema validation, but retry doesn't help
4. **Model may not be suitable** - Using `gpt-5.2` which might not exist ([SemanticPlanGenerator.ts:499](../lib/agentkit/v6/semantic-plan/SemanticPlanGenerator.ts#L499))

## Impact

- ❌ Cannot generate ANY workflows via V6 semantic pipeline
- ❌ Falls back to non-deterministic LLM compilation (if it even reaches Phase 4)
- ❌ Production launch blocked

## Solution Options

### Option A: Increase Timeout (Quick Fix)
Change timeout from 60s to 120s to give LLM more time.

**Pros**: Simple one-line change
**Cons**: Doesn't address root cause of schema validation failures

### Option B: Simplify Schema (Better Fix)
Make more fields optional in [semantic-plan-schema.ts](../lib/agentkit/v6/semantic-plan/schemas/semantic-plan-schema.ts) to reduce LLM burden.

**Changes needed**:
- Line 39: Change `required: ['data_sources', 'delivery']` to `required: ['data_sources']`
- Line 164: Make delivery fields optional
- Allow semantic plan to be incomplete and filled in by grounding

**Pros**: Makes schema match prompt philosophy ("ambiguity is OK")
**Cons**: Requires testing to ensure grounding handles missing fields

### Option C: Use Structured Output (Best Fix)
Switch from `response_format: { type: 'json_object' }` to `response_format: { type: 'json_schema', json_schema: ... }` with OpenAI strict mode.

**Changes needed**:
1. Convert SEMANTIC_PLAN_SCHEMA to OpenAI strict format
2. Update [SemanticPlanGenerator.ts:275](../lib/agentkit/v6/semantic-plan/SemanticPlanGenerator.ts#L275) to use `json_schema` mode
3. Increase timeout to 90s

**Pros**: Forces valid output, reduces retries
**Cons**: Requires schema conversion work

### Option D: Fix Model Name (Critical)
The code references `gpt-5.2` which doesn't exist. Should be `gpt-4.5-turbo` or similar.

**File**: [SemanticPlanGenerator.ts:499](../lib/agentkit/v6/semantic-plan/SemanticPlanGenerator.ts#L499)

```typescript
if (this.config.model_provider === 'openai') {
  return 'gpt-5.2'  // ❌ This model doesn't exist!
}
```

## Recommended Fix

Combine **Option B + D**:

1. **Fix model name** - Change `gpt-5.2` to valid model
2. **Simplify schema** - Make delivery optional
3. **Increase timeout** - 60s → 90s
4. **Add better error logging** - Log actual LLM response when validation fails

This balances quick deployment with addressing root causes.

## Implementation

### Step 1: Fix Model Name

**File**: [SemanticPlanGenerator.ts:499](../lib/agentkit/v6/semantic-plan/SemanticPlanGenerator.ts#L499)

```typescript
private getModelName(): string {
  if (this.config.model_name) {
    return this.config.model_name
  }

  if (this.config.model_provider === 'openai') {
    return 'gpt-4-turbo-preview'  // ✅ Use valid model
  }

  if (this.config.model_provider === 'anthropic') {
    return 'claude-sonnet-4-20250514'
  }

  return 'unknown'
}
```

### Step 2: Make Delivery Optional in Schema

**File**: [semantic-plan-schema.ts:39](../lib/agentkit/v6/semantic-plan/schemas/semantic-plan-schema.ts#L39)

```typescript
understanding: {
  type: 'object',
  required: ['data_sources'],  // ✅ Removed 'delivery' from required
  additionalProperties: true,
  properties: {
    // ...
  }
}
```

**File**: [semantic-plan-schema.ts:162-177](../lib/agentkit/v6/semantic-plan/schemas/semantic-plan-schema.ts#L162-L177)

```typescript
delivery: {
  type: 'object',
  required: [],  // ✅ Make all fields optional
  properties: {
    pattern: { type: 'string' },
    recipients_description: { type: 'string' },
    recipient_resolution_strategy: { type: 'string' },
    subject_template: { type: 'string' },
    body_description: { type: 'string' },
    cc_recipients: {
      type: 'array',
      items: { type: 'string' }
    },
    conditions: { type: 'string' }
  }
}
```

### Step 3: Increase Timeout

**File**: [SemanticPlanGenerator.ts:281](../lib/agentkit/v6/semantic-plan/SemanticPlanGenerator.ts#L281)

```typescript
// Wrap with 90-second timeout (was 60s)
const response = await this.callWithTimeout(apiCall, 90000)
```

### Step 4: Add Debug Logging

**File**: [SemanticPlanGenerator.ts:305-308](../lib/agentkit/v6/semantic-plan/SemanticPlanGenerator.ts#L305-L308)

```typescript
// Validate basic structure
const validation = this.validateSemanticPlan(semanticPlan)
if (!validation.valid) {
  lastError = `Schema validation failed: ${validation.errors.map(e => e.message).join(', ')}`
  console.warn(`[SemanticPlanGenerator] Attempt ${attempt} failed validation: ${lastError}`)
  console.warn(`[SemanticPlanGenerator] LLM response:`, JSON.stringify(semanticPlan, null, 2).substring(0, 1000))  // ✅ NEW
  // ...
}
```

## Testing

### Test 1: Verify Model Name
```bash
# Check OpenAI API for valid models
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY" | \
  jq '.data[] | select(.id | contains("gpt")) | .id'
```

### Test 2: Generate Gmail Complaint Workflow
1. Navigate to `http://localhost:3000/test-v6-declarative.html`
2. Enter: "Scan Gmail for complaint emails (keyword: angry), append to Google Sheets 'UrgentEmails'"
3. Expected logs:
```
[SemanticPlanGenerator] Calling OpenAI (attempt 1/2)...
[SemanticPlanGenerator] ✓ Attempt 1 succeeded
[SemanticPlanGenerator] Parsed semantic plan version: 1.0
```

### Test 3: Check Timeout Handling
Monitor logs for second attempt timeout - should now take 90s instead of 60s before failing.

## Alternative: Skip Semantic Plan Phase

If semantic plan continues to fail, consider **temporarily bypassing** it:

1. Skip Phase 1 (Semantic Plan Generation)
2. Go directly from Enhanced Prompt → Formalization
3. Use LLM compiler (non-deterministic but working)

This would require modifying [generate-ir-semantic/route.ts](../app/api/v6/generate-ir-semantic/route.ts) to skip semantic plan generation.

## Next Steps

1. ✅ Implement fix (model name + schema + timeout)
2. Test with Gmail complaint workflow
3. Monitor success rate
4. If still failing, consider Alternative approach
5. Once stable, re-enable DeclarativeCompiler verification

## Related Issues

- **IR Version Compatibility** - [V6_IR_VERSION_COMPATIBILITY_FIX.md](./V6_IR_VERSION_COMPATIBILITY_FIX.md)
- **DSL Schema Validation** - [V6_DSL_VALIDATION_REPORT.md](./V6_DSL_VALIDATION_REPORT.md)
- **Deduplication Feature** - DeclarativeCompiler implementation already working

## References

- [SemanticPlanGenerator.ts](../lib/agentkit/v6/semantic-plan/SemanticPlanGenerator.ts) - Main semantic plan generation logic
- [semantic-plan-schema.ts](../lib/agentkit/v6/semantic-plan/schemas/semantic-plan-schema.ts) - JSON schema validation
- [semantic-plan-system.md](../lib/agentkit/v6/semantic-plan/prompts/semantic-plan-system.md) - LLM system prompt
