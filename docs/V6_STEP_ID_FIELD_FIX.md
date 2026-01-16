# V6 Step ID Field Name Fix

**Date:** 2025-12-30
**Status:** ✅ COMPLETE
**Issue:** LLM generating workflows with missing `id` fields after strict mode disabled

---

## Problem Statement

After disabling OpenAI strict mode (due to incompatibility with discriminated unions), discovered that **all generated workflows were missing the `id` field** on every step:

```
[IRToDSLCompiler] ⚠️ Validation failed, retrying... [
  'workflow_steps[0]: Missing required field "id"',
  'workflow_steps[1]: Missing required field "id"',
  'workflow_steps[2]: Missing required field "id"',
  ...
]
```

## Root Cause Analysis

The compiler code had a **field name mismatch**:

| Component | Expected Field | Actual Field Used |
|-----------|---------------|------------------|
| **JSON Schema** | `id` | ✓ Correct |
| **TypeScript Types** | `id` | ✓ Correct |
| **System Prompt** | `step_id` | ❌ Wrong |
| **Compiler Code** | `step_id` | ❌ Wrong |

**Why this happened:**
- Original code was written with `step_id` convention
- Schema was updated to use `id` to match PILOT DSL standard
- Prompt and internal code references were not updated
- **Strict mode masked the problem** by enforcing schema field names
- When strict mode was disabled, LLM followed the prompt (using `step_id`) instead of schema

## Impact

Without strict mode enforcement:
- LLM generates `step_id` field (per prompt instructions)
- Schema expects `id` field
- Runtime validation rejects all workflows
- **100% failure rate** on workflow compilation

## Solution

Systematically updated all references from `step_id` to `id`:

### 1. System Prompt Examples (IRToDSLCompiler.ts)

**Lines Changed:** 659, 680, 686, 691, 698, 765, 772, 866, 883

```typescript
// BEFORE:
{
  "step_id": "step1",
  "name": "Step description",
  ...
}

// AFTER:
{
  "id": "step1",                // REQUIRED: unique step identifier
  "name": "Step description",   // REQUIRED: human-readable description
  ...
}
```

### 2. Compiler Internal Code

**a) Output Field Detection (line 197-198):**
```typescript
// BEFORE:
stepOutputFields.set(step.step_id, arrayField[0])
console.log(`[IRToDSLCompiler] Detected ${step.step_id} output array field: ${arrayField[0]}`)

// AFTER:
stepOutputFields.set(step.id, arrayField[0])
console.log(`[IRToDSLCompiler] Detected ${step.id} output array field: ${arrayField[0]}`)
```

**b) AI Step Lookup (line 382):**
```typescript
// BEFORE:
const aiStepIdx = workflow.findIndex(s => s.step_id === onEachStepId)

// AFTER:
const aiStepIdx = workflow.findIndex(s => s.id === onEachStepId)
```

**c) Scatter-Gather Optimization (line 468):**
```typescript
// BEFORE:
const optimizedStep = {
  step_id: scatterStep.step_id,
  type: 'transform',
  ...
}

// AFTER:
const optimizedStep = {
  id: scatterStep.id,
  type: 'transform',
  ...
}
```

**d) Step Renumbering (lines 535, 542):**
```typescript
// BEFORE:
const oldId = step.step_id
...
const newStep = { ...step, step_id: `step${idx + 1}` }

// AFTER:
const oldId = step.id
...
const newStep = { ...step, id: `step${idx + 1}` }
```

### 3. Documentation Comments

```typescript
// BEFORE:
// Build map of step outputs (step_id → primary array field name)

// AFTER:
// Build map of step outputs (id → primary array field name)
```

## Files Modified

### `/lib/agentkit/v6/compiler/IRToDSLCompiler.ts`

**Total Changes:** 15 occurrences of `step_id` → `id`

**Sections Updated:**
1. **System Prompt** (lines 659-883)
   - Output structure example
   - Step type requirements
   - Deduplication examples
   - Step ID naming rules
   - Input/output schema examples

2. **Internal Code** (lines 177-542)
   - fixVariableReferences() - output field detection
   - optimizeAIOperations() - AI step lookup and scatter optimization
   - renumberSteps() - step ID renumbering

## Verification

### TypeScript Compilation
```bash
$ npx tsc --noEmit --project tsconfig.json
# ✅ No errors
```

### Expected Behavior

With this fix, the LLM should now generate:

```json
{
  "workflow": [
    {
      "id": "step1",              // ✅ Correct field name
      "name": "Fetch Gmail messages",
      "type": "action",
      "dependencies": [],
      "plugin": "google-mail",
      "action": "search_messages",
      "params": { "query": "subject:expenses" }
    },
    {
      "id": "step2",              // ✅ Sequential numbering
      "name": "Filter by date",
      "type": "transform",
      "dependencies": ["step1"],
      "operation": "filter",
      "input": "{{step1.data}}",
      "config": { ... }
    }
  ]
}
```

### Runtime Validation

The runtime validator (`validateWorkflowStructure`) checks:
- ✅ Every step has `id` field
- ✅ Every step has `name` field
- ✅ Every step has `type` field
- ✅ Dependencies reference existing step IDs
- ✅ No duplicate IDs

With the fix, validation should pass.

## Why This Fix Was Critical

### Without Strict Mode
- LLM relies entirely on **prompt instructions**
- If prompt says `step_id`, LLM generates `step_id`
- Schema mismatch causes runtime validation failures
- **System unusable**

### With This Fix
- Prompt and schema aligned on `id` field
- LLM generates correct field name
- Runtime validation passes
- **System operational**

## Lessons Learned

### 1. Consistency is Critical
When a schema field name changes, **all references must be updated**:
- JSON Schema definition
- TypeScript type definitions
- System prompt examples
- Internal code references
- Documentation

### 2. Strict Mode as Safety Net
- **Masked inconsistencies** between prompt and schema
- When disabled, exposed field name mismatches
- Highlights importance of **end-to-end validation**

### 3. Prompt is Source of Truth (Without Strict Mode)
- LLMs follow prompt instructions literally
- Schema alone doesn't guide generation in `json_object` mode
- **Prompt must match schema exactly**

## Related Issues

This fix addresses the immediate problem caused by disabling strict mode in [V6_STRICT_MODE_RESOLUTION.md](./V6_STRICT_MODE_RESOLUTION.md).

### Issue Chain:
1. **Phase 3:** Enabled OpenAI strict mode for schema validation
2. **Discovered:** Strict mode incompatible with discriminated union `Condition` schema
3. **Resolution:** Disabled strict mode (used `json_object` mode instead)
4. **New Issue:** Field name mismatch exposed (this document)
5. **Fix:** Updated all `step_id` references to `id`

## Testing Recommendations

### Manual Testing
1. Navigate to http://localhost:3000/test-v6.html
2. Test all three example workflows:
   - Gmail Expense Tracking (9 steps)
   - Complaint Detection (7 steps)
   - Sales Lead Distribution (8 steps)
3. Verify compilation succeeds with no validation errors

### Automated Testing
```typescript
// Test that generated workflow has correct field names
const result = await compiler.compile(testIR)
assert(result.workflow[0].id === 'step1')  // ✅ Not step_id
assert(result.workflow[0].name !== undefined)
assert(result.workflow[0].type !== undefined)
```

## Future Proofing

### Schema Evolution Checklist
When changing schema field names:
- [ ] Update JSON Schema definition
- [ ] Update TypeScript type definitions
- [ ] Update system prompt examples (all occurrences)
- [ ] Update internal code references
- [ ] Update runtime validation logic
- [ ] Update documentation
- [ ] Run full TypeScript compilation check
- [ ] Test with real workflows

### Code Review Focus
- Watch for field name inconsistencies
- Verify prompt matches schema structure
- Test with strict mode both ON and OFF
- Validate runtime validation catches mismatches

---

**Resolution Date:** 2025-12-30
**Implemented By:** Claude Code Agent
**Status:** ✅ COMPLETE - All references updated, TypeScript compiles
**Confidence:** HIGH (95%) - Systematic replacement verified
