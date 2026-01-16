# Data Type Mismatch Between Steps - Solutions

**Issue**: Transform steps (filter, map) expect arrays but receive objects, causing "Filter operation requires array input, but received object" errors.

## Root Cause

There are **two places** where data type mismatches occur:

### 1. **Generation Time** (Compiler)
The LLM compiler generates step inputs like:
```json
{
  "input": "{{step2}}"  // ❌ References whole step output object
}
```

Instead of:
```json
{
  "input": "{{step2.data}}"  // ✅ References the data array
}
```

### 2. **Execution Time** (Runtime)
Even with correct input references, steps can return complex objects:
```javascript
{
  stepId: "step2",
  plugin: "google-mail",
  action: "search_emails",
  data: [...],  // The actual array data
  metadata: {...}
}
```

When the next step references `{{step2}}`, it gets the whole object, not just `data`.

## Current Mitigation (Execution Time)

We **already have auto-extraction** in [StepExecutor.ts:1328-1370](../lib/pilot/StepExecutor.ts#L1328-L1370):

```typescript
// Handle case where input resolves to a StepOutput object instead of direct data
// This happens when using {{stepX}} instead of {{stepX.data}} or {{stepX.data.field}}
if (data && typeof data === 'object' && !Array.isArray(data)) {
  // Check if it's a StepOutput structure
  if ('data' in data && data.data !== undefined) {
    // Auto-extract data field
    logger.info({
      stepId: step.id,
      operation,
      before: 'StepOutput object',
      after: Array.isArray(data.data) ? `array[${data.data.length}]` : typeof data.data
    }, '✅ Auto-extracted .data from StepOutput');
    data = data.data;
  }
  // ... more extraction logic for scatter-gather, etc.
}
```

**This works at runtime**, but doesn't prevent generation errors.

## Solution Options

### Option A: Fix at Generation Time (Best - Prevents Root Cause)

Make the compiler generate correct input references.

#### A1: Post-Generation Validation & Auto-Fix

Add a **post-compilation normalization step** in [DeclarativeCompiler.ts](../lib/agentkit/v6/compiler/DeclarativeCompiler.ts):

```typescript
private normalizeStepInputs(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.map((step, index) => {
    if (step.type === 'transform') {
      const transformStep = step as TransformStep;
      const input = transformStep.input;

      // Check if input references a previous action step without .data
      if (typeof input === 'string' && input.match(/^\{\{step\d+\}\}$/)) {
        const referencedStepId = input.replace(/\{\{|\}\}/g, '');
        const referencedStep = steps.find(s => s.id === referencedStepId);

        // If referenced step is an action (returns StepOutput object), append .data
        if (referencedStep && referencedStep.type === 'action') {
          transformStep.input = `{{${referencedStepId}.data}}`;
          console.log(`[Normalizer] Fixed input reference: ${input} → ${transformStep.input}`);
        }
      }
    }
    return step;
  });
}
```

**Call after compilation**:
```typescript
compile(ir: DeclarativeLogicalIR): CompilationResult {
  // ... existing compilation logic ...

  // ✅ NEW: Normalize step inputs before validation
  const normalizedSteps = this.normalizeStepInputs(steps);

  return {
    success: true,
    workflow: normalizedSteps,
    logs: ctx.logs
  };
}
```

**Pros**:
- ✅ Fixes all input references systematically
- ✅ Works for both DeclarativeCompiler and LLM compiler
- ✅ No execution overhead

**Cons**:
- Only fixes known patterns (might miss edge cases)

#### A2: Improve LLM Compiler Prompt

Add explicit instructions in the LLM compiler prompt:

```markdown
## CRITICAL: Step Input References

When referencing previous steps in transform operations:
- ❌ WRONG: "input": "{{step2}}"  // References whole StepOutput object
- ✅ CORRECT: "input": "{{step2.data}}"  // References the data array

Rule: Transform steps (filter, map, reduce) ALWAYS need arrays.
- If previous step is an action → use {{stepX.data}}
- If previous step is a transform → use {{stepX.data}} or {{stepX.data.filtered}}
```

**Pros**:
- ✅ Educates the LLM to generate correct references
- ✅ No code changes needed

**Cons**:
- ❌ LLM might still make mistakes (non-deterministic)
- ❌ Doesn't fix DeclarativeCompiler

### Option B: Enhanced Runtime Auto-Extraction (Safest - Already Partially Implemented)

Make runtime auto-extraction more aggressive and add logging.

```typescript
// In executeTransform() - line 1328
if (data && typeof data === 'object' && !Array.isArray(data)) {
  // Auto-extract patterns (in priority order)
  const extractionAttempts = [
    { path: 'data', condition: () => 'data' in data },
    { path: 'items', condition: () => 'items' in data },
    { path: 'filtered', condition: () => 'filtered' in data },
    { path: 'results', condition: () => 'results' in data },
    { path: 'output', condition: () => 'output' in data },
  ];

  for (const attempt of extractionAttempts) {
    if (attempt.condition() && data[attempt.path] !== undefined) {
      const extracted = data[attempt.path];
      logger.info({
        stepId: step.id,
        extractedFrom: attempt.path,
        type: Array.isArray(extracted) ? 'array' : typeof extracted
      }, `✅ Auto-extracted .${attempt.path}`);
      data = extracted;
      break;
    }
  }

  // If still not an array, provide helpful error
  if (!Array.isArray(data) && operation === 'filter') {
    const availableFields = Object.keys(data);
    throw new ExecutionError(
      `Filter operation requires array input. Received object with fields: ${availableFields.join(', ')}. ` +
      `Try using one of: ${availableFields.map(f => `{{previousStep.${f}}}`).join(', ')}`,
      'INVALID_INPUT_TYPE'
    );
  }
}
```

**Pros**:
- ✅ Works regardless of how workflow was generated
- ✅ Provides helpful error messages
- ✅ No generation changes needed

**Cons**:
- ❌ Runtime overhead (small)
- ❌ Doesn't prevent bad workflow generation

### Option C: Hybrid Approach (Recommended)

**Combine all three**:

1. **Post-compilation normalization** (Option A1) - Fixes most cases
2. **Improved LLM prompt** (Option A2) - Educates LLM compiler
3. **Enhanced runtime extraction** (Option B) - Safety net for edge cases

This gives us **defense in depth**:
- Generation-time fixes prevent most issues
- Runtime auto-extraction handles edge cases
- Clear error messages help debug failures

## Implementation Priority

### Phase 1: Quick Win (Execution Time)
1. ✅ **Already done**: Basic auto-extraction in StepExecutor.ts:1328-1370
2. **Enhance**: Add more extraction paths (items, filtered, results, output)
3. **Improve**: Better error messages showing available fields

### Phase 2: Compiler Fix (Generation Time)
1. Implement normalizeStepInputs() in DeclarativeCompiler
2. Add same normalization to LLM compiler output
3. Update compiler prompt with input reference rules

### Phase 3: Validation (Prevent Bad Workflows)
1. Add WorkflowValidator.validateStepInputs()
2. Check transform steps have array-compatible inputs
3. Warn (don't fail) on suspicious references

## Testing

### Test Case 1: Gmail Search → Filter
```json
{
  "steps": [
    {
      "id": "step1",
      "type": "action",
      "plugin": "google-mail",
      "action": "search_emails",
      "params": {...}
    },
    {
      "id": "step2",
      "type": "transform",
      "operation": "filter",
      "input": "{{step1}}",  // ❌ Should be {{step1.data}}
      "config": {...}
    }
  ]
}
```

**Expected**: Auto-extraction succeeds, step2 receives array

### Test Case 2: Scatter-Gather → Map
```json
{
  "id": "step3",
  "type": "transform",
  "operation": "map",
  "input": "{{step2_scatter}}",  // scatter-gather output
  "config": {...}
}
```

**Expected**: Extracts results array from scatter-gather output

## Related Files

- [StepExecutor.ts:1282-1370](../lib/pilot/StepExecutor.ts#L1282-L1370) - Transform execution with auto-extraction
- [StepExecutor.ts:1527-1537](../lib/pilot/StepExecutor.ts#L1527-L1537) - Filter type validation
- [DeclarativeCompiler.ts](../lib/agentkit/v6/compiler/DeclarativeCompiler.ts) - Rule-based compiler
- [ParallelExecutor.ts:100-150](../lib/pilot/ParallelExecutor.ts#L100-L150) - Scatter-gather auto-extraction reference

## Monitoring

Add telemetry to track:
- Auto-extraction success rate
- Most common extraction paths used
- Failed extractions with object structure

This data will inform which fields to prioritize in extraction logic.
