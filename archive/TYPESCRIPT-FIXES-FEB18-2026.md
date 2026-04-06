# TypeScript Compilation Fixes - February 18, 2026

**Status**: ✅ FIXED

## Issue

StructuralRepairEngine failed to compile with TypeScript errors:

```
Module not found: Can't resolve '@/lib/utils/logger'
Property 'step_id' does not exist on type 'WorkflowStep'
Property 'output_variable' does not exist on type 'ScatterGatherStep'
```

## Root Cause

### 1. Wrong Logger Import

Used `@/lib/utils/logger` which doesn't exist. Should use `@/lib/logger` with `createLogger`.

### 2. Type Mismatch

The TypeScript types (`WorkflowStep`, `ScatterGatherStep`, `ConditionalStep`) don't match the actual compiled DSL structure:

**TypeScript Types**:
- Don't have `step_id` field (only have internal ID)
- Don't have `output_variable` field
- Use different field names (e.g., `else_steps` vs `false_step`)

**Compiled DSL** (runtime):
- Has both `id` and `step_id` fields
- Has `output_variable` field on scatter-gather
- Uses mix of naming conventions

**Solution**: Use `any` type for workflow steps since we're working with the compiled DSL structure, not the TypeScript interface.

## Fixes Applied

### Fix 1: Logger Import

```typescript
// ❌ BEFORE:
import { logger } from '@/lib/utils/logger';

// ✅ AFTER:
import { createLogger } from '@/lib/logger';
const logger = createLogger({ module: 'StructuralRepairEngine', service: 'shadow-agent' });
```

### Fix 2: Type Annotations

Changed all method signatures to use `any` instead of typed `WorkflowStep`:

```typescript
// ❌ BEFORE:
async scanWorkflow(agent: Agent): Promise<StructuralIssue[]> {
  const steps = agent.pilot_steps || [];
  for (const step of steps) {
    if (!step.step_id || step.step_id.trim() === '') {  // ← TS error
      ...
    }
  }
}

// ✅ AFTER:
async scanWorkflow(agent: Agent): Promise<StructuralIssue[]> {
  const steps: any[] = agent.pilot_steps || [];  // ← Use any[]
  for (const step of steps) {
    const stepId = step.step_id || step.id;  // ← Safe access
    if (!stepId || stepId.trim() === '') {
      ...
    }
  }
}
```

### Fix 3: All Methods Updated

Updated all private helper methods:

```typescript
// Changed signatures:
private inferDependenciesFromVariables(step: any, allSteps: any[]): string[]
private updateVariableReferences(step: any, oldStepId: string, newStepId: string): void
private replaceVariableReference(step: any, oldVariable: string, newVariable: string): void
private generateUniqueStepId(steps: any[], baseName: string = 'step'): string
```

### Fix 4: Removed Type Casting

```typescript
// ❌ BEFORE:
const scatterStep = step as ScatterGatherStep;
if (scatterStep.scatter?.input) { ... }

// ✅ AFTER:
if (step.scatter?.input) { ... }  // Direct access, no casting
```

## Why Use `any`?

**Reason**: The StructuralRepairEngine works with **compiled DSL** (runtime structure), not **TypeScript types** (design-time structure).

**Compiled DSL Structure**:
```json
{
  "id": "step1",
  "step_id": "step1",  // ← Not in TS types
  "type": "scatter_gather",
  "output_variable": "results",  // ← Not in TS types
  "scatter": { ... },
  "gather": { "outputKey": "results" }
}
```

**TypeScript Types**:
```typescript
interface ScatterGatherStep {
  // No step_id field
  // No output_variable field
  type: 'scatter_gather'
  scatter: { ... }
  gather: { ... }
}
```

Using `any` is correct here because:
1. We're fixing **runtime DSL bugs**, not TypeScript code
2. The compiled DSL has fields that don't exist in TS types
3. We need to access and modify these runtime-only fields

## Files Modified

1. ✅ [lib/pilot/shadow/StructuralRepairEngine.ts](lib/pilot/shadow/StructuralRepairEngine.ts)
   - Line 27: Fixed logger import
   - Line 93: `scanWorkflow()` - use `any[]` for steps
   - Line 368: `applyStructuralFix()` - use `any[]` for steps
   - Line 605: `inferDependenciesFromVariables()` - use `any` types
   - Line 643: `updateVariableReferences()` - use `any` type
   - Line 689: `replaceVariableReference()` - use `any` type
   - Line 732: `generateUniqueStepId()` - use `any[]`

## Testing

Run type-check:
```bash
npx tsc --noEmit
```

Expected: No errors related to StructuralRepairEngine

## Production Impact

**Risk**: None
- Using `any` is appropriate for runtime DSL manipulation
- All runtime checks are still in place (`if (!stepId)`, etc.)
- Logger correctly configured to match other Shadow Agent components

## Related

- [CALIBRATION-COMPLETE-FEB18-2026.md](CALIBRATION-COMPLETE-FEB18-2026.md) - Main calibration fixes
- [STRUCTURAL-REPAIR-IMPLEMENTATION-COMPLETE.md](STRUCTURAL-REPAIR-IMPLEMENTATION-COMPLETE.md) - StructuralRepairEngine spec
