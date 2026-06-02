# StructuralRepairEngine Transformation Integration

> **Date**: 2026-04-24
> **Status**: Implemented - Ready for Testing

## Overview

Integrated the StructuralRepairEngine with the calibration system to automatically detect and propose data transformation fixes for parameter format mismatches (e.g., `fields` object → `values` 2D array).

## Problem Statement

The StructuralRepairEngine could detect missing required parameters during pre-flight validation, but it couldn't create auto-repair proposals for data transformations. This meant:

1. Step 14 (append_rows) was detected as having a missing `values` parameter
2. Detection logged: `"Detected missing required parameters: values"`
3. BUT no auto-repair proposal was created
4. The issue was never fixed during calibration

**Root Cause**: StructuralRepairEngine detection happened during pre-flight validation (before execution), but the Pattern 4 transformation logic only fired for execution errors.

## Solution: Two-Phase Integration

### Phase 1: Detection in StructuralRepairEngine

**File**: `lib/pilot/shadow/StructuralRepairEngine.ts`

#### 1. Enhanced Issue Detection (Lines 306-351)

```typescript
// Issue 8: Missing required parameters
if (step.plugin && step.action) {
  const missingParams = await this.findMissingRequiredParams(step);

  // CRITICAL: Check if this is a data transformation case
  const stepConfig = step.params || step.config || {};
  const providedParams = Object.keys(stepConfig);

  for (const param of missingParams) {
    const isArrayParam = param.schema?.type === 'array' &&
      (param.schema?.items?.type === 'array' || param.schema?.description?.toLowerCase().includes('2d array'));

    const hasFieldsMapping = providedParams.includes('fields') &&
      stepConfig.fields && typeof stepConfig.fields === 'object';

    if (isArrayParam && hasFieldsMapping) {
      // ✅ Create auto-fixable issue for data transformation
      issues.push({
        type: 'missing_required_parameter',
        stepId,
        description: `Missing required parameter: ${param.name} (fields object provided, needs transformation to array)`,
        severity: 'critical',
        autoFixable: true  // Now auto-fixable!
      });
    }
  }
}
```

#### 2. Enhanced Fix Proposal (Lines 789-845)

```typescript
case 'missing_required_parameter': {
  const paramName = match[1];
  const missingParams = await this.findMissingRequiredParams(step);
  const paramInfo = missingParams.find(p => p.name === paramName);

  // Check if this is a data transformation case
  const stepConfig = step.params || step.config || {};
  const isArrayParam = paramInfo.schema?.type === 'array' && ...;
  const hasFieldsMapping = providedParams.includes('fields') && ...;

  if (isArrayParam && hasFieldsMapping) {
    // ✅ Propose transformation fix
    return {
      action: 'add_missing_parameter',
      description: `Transform fields object to ${paramName} array`,
      confidence: 0.92,
      fix: {
        paramName,
        transformationType: 'fields_to_array',
        sourceParam: 'fields',
        fieldMapping: stepConfig.fields
      }
    };
  }
}
```

#### 3. Fix Application Handler (Lines 1273-1304)

```typescript
case 'add_missing_parameter': {
  if (proposal.fix.transformationType === 'fields_to_array') {
    // ⚠️ This requires AI transform step insertion
    // StructuralRepairEngine can't insert new steps - only modify existing ones
    // Return false so calibration system handles it

    logger.info({
      stepId: proposal.targetStepId,
      message: 'Data transformation needed - will be handled by calibration auto-fix'
    }, '[StructuralRepair] Detected fields-to-array transformation');

    return {
      fixed: false,
      error: 'Data transformation requires AI transform step insertion (handled by calibration auto-fix)'
    };
  }
}
```

### Phase 2: Integration with Calibration System

**File**: `app/api/v2/calibrate/batch/route.ts`

#### 1. Collect Transformation Proposals (Lines 271-303)

```typescript
const transformationProposals: any[] = [];

if (structuralIssues.length > 0) {
  const fixResults = await repairEngine.autoFixWorkflow(agent);
  structuralFixes = fixResults.filter(r => r.fixed);

  // ✅ Extract transformation proposals that need calibration-level handling
  for (const issue of structuralIssues) {
    if (issue.type === 'missing_required_parameter' && issue.autoFixable) {
      const proposal = await repairEngine.proposeStructuralFix(issue, agent);

      if (proposal.fix?.transformationType === 'fields_to_array') {
        transformationProposals.push({
          stepId: issue.stepId,
          paramName: proposal.fix.paramName,
          sourceParam: proposal.fix.sourceParam,
          fieldMapping: proposal.fix.fieldMapping,
          confidence: proposal.confidence,
          description: proposal.description
        });
      }
    }
  }
}
```

#### 2. Convert to Calibration Issues (Lines 332-371)

```typescript
const transformationIssues: any[] = [];

for (const proposal of transformationProposals) {
  transformationIssues.push({
    id: `transformation_${proposal.stepId}_${proposal.paramName}`,
    stepId: proposal.stepId,
    type: 'missing_required_parameter',
    message: `Missing required parameter: ${proposal.paramName} (fields-to-array transformation needed)`,
    severity: 'critical',
    autoRepairAvailable: true,
    autoRepairProposal: {
      type: 'transform_fields_to_values',
      confidence: proposal.confidence,
      changes: [{
        stepId: proposal.stepId,
        path: `params.${proposal.paramName}`,
        action: 'transform_to_array',
        inputVariable: 'item',
        missingParam: proposal.paramName,
        providedParam: proposal.sourceParam,
        fieldMapping: proposal.fieldMapping,
        reasoning: proposal.description
      }]
    },
    affectedSteps: [{ stepId: proposal.stepId }]
  });
}
```

#### 3. Inject into Execution Loop (Lines 1288-1299)

```typescript
// PHASE 3: Analyze execution results and collect issues
let iterationIssues = result.collectedIssues || [];

// ✅ Inject transformation issues on first iteration
if (loopIteration === 1 && transformationIssues.length > 0) {
  logger.info({
    sessionId,
    loopIteration,
    transformationIssuesCount: transformationIssues.length
  }, '[StructuralRepair] Injecting transformation issues into first iteration');

  iterationIssues = [...transformationIssues, ...iterationIssues];
}
```

## How It Works

### Execution Flow

```
1. Pre-Flight Validation (Line 263)
   ├─> StructuralRepairEngine.scanWorkflow()
   │   └─> Detects missing `values` parameter
   │       └─> Sees `fields` object exists
   │           └─> Creates auto-fixable issue
   │
2. Fix Proposal Generation (Line 271-303)
   ├─> repairEngine.proposeStructuralFix()
   │   └─> Detects transformation type: 'fields_to_array'
   │       └─> Returns proposal with fieldMapping
   │
3. Proposal Collection (Line 271-303)
   └─> Extract transformation proposals
       └─> Convert to calibration issues
           └─> Store in transformationIssues array

4. Calibration Loop Iteration 1 (Line 1288-1299)
   ├─> Inject transformationIssues into iterationIssues
   │
5. Auto-Fix Application (Lines 2542-2699)
   └─> Pattern 4 handler detects auto-repair proposal
       └─> Inserts AI transform step before target step
           └─> Updates parameter references
               └─> Workflow fixed!
```

## Example Transformation

### Before

```json
{
  "id": "step14",
  "type": "action",
  "plugin": "google-sheets",
  "action": "append_rows",
  "params": {
    "spreadsheet_id": "{{input.spreadsheet_id}}",
    "range": "{{input.sheet_tab_name}}",
    "fields": {
      "Date": "high_value_items.date",
      "Type": "high_value_items.type",
      "Amount": "high_value_items.amount"
    }
  }
}
```

### After (Auto-Fixed)

```json
// NEW: Transform step inserted
{
  "id": "step14_transform",
  "type": "ai_processing",
  "config": {
    "type": "generate",
    "ai_type": "generate",
    "instruction": "Convert input to values format. Extract fields in order: Date, Type, Amount...",
    "output_schema": {
      "type": "object",
      "required": ["values"],
      "properties": {
        "values": {
          "type": "array",
          "items": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  },
  "input": "high_value_items",
  "output_variable": "step14_transformed_data"
},

// UPDATED: Original step uses transformed data
{
  "id": "step14",
  "type": "action",
  "plugin": "google-sheets",
  "action": "append_rows",
  "params": {
    "spreadsheet_id": "{{input.spreadsheet_id}}",
    "range": "{{input.sheet_tab_name}}",
    "values": "{{step14_transformed_data.values}}"  // ✅ Now correct!
  }
}
```

## Benefits

### For StructuralRepairEngine

- ✅ Can now detect data transformation issues during pre-flight
- ✅ Creates actionable auto-repair proposals
- ✅ Doesn't need to insert new steps (handled by calibration)
- ✅ Works for any plugin with similar parameter mismatches

### For Calibration System

- ✅ Receives transformation proposals before execution
- ✅ Applies fixes in first iteration (no execution needed to detect)
- ✅ Reuses existing Pattern 4 transformation handler
- ✅ No duplicate detection logic

### For Users

- ✅ Automatic workflow fixes without regeneration
- ✅ Works for all plugins with parameter format mismatches
- ✅ Preserves field mapping intent in transformations
- ✅ Faster calibration (detects issues before execution)

## Testing

### Expected Behavior

**Iteration 1**:
1. StructuralRepairEngine scans workflow (pre-flight)
2. Detects step 14 missing `values` parameter
3. Sees `fields` object exists
4. Creates transformation proposal with confidence 0.92
5. Proposal converted to calibration issue
6. Issue injected into iteration 1
7. Calibration auto-fix applies transformation
8. Workflow updated and saved

**Iteration 2**:
9. Step 14 executes successfully with `values` parameter
10. Calibration completes

### Verification Commands

```bash
# Check for StructuralRepairEngine detection
grep "\[StructuralRepair\] Detected missing required parameters" /tmp/nextjs-calibration.log

# Check for transformation proposal creation
grep "\[StructuralRepair\] Creating auto-repair proposal for data transformation" /tmp/nextjs-calibration.log

# Check for proposal collection
grep "\[StructuralRepair\] Collected transformation proposal" /tmp/nextjs-calibration.log

# Check for injection into iteration 1
grep "\[StructuralRepair\] Injecting transformation issues into first iteration" /tmp/nextjs-calibration.log

# Check for auto-fix application
grep "Auto-applied: transform_fields_to_values" /tmp/nextjs-calibration.log

# Verify step 14 execution
grep "step14.*completed" /tmp/nextjs-calibration.log
```

## Files Modified

| File | Lines | Change |
|------|-------|--------|
| `lib/pilot/shadow/StructuralRepairEngine.ts` | 306-351 | Enhanced issue detection for transformations |
| `lib/pilot/shadow/StructuralRepairEngine.ts` | 789-845 | Enhanced fix proposal for transformations |
| `lib/pilot/shadow/StructuralRepairEngine.ts` | 1273-1304 | Fix application handler (delegates to calibration) |
| `app/api/v2/calibrate/batch/route.ts` | 271-303 | Collect transformation proposals |
| `app/api/v2/calibrate/batch/route.ts` | 332-371 | Convert proposals to calibration issues |
| `app/api/v2/calibrate/batch/route.ts` | 1288-1299 | Inject issues into iteration 1 |

## Architecture Notes

### Why This Design?

**Separation of Concerns**:
- StructuralRepairEngine: Detects structural issues, proposes fixes
- Calibration System: Applies complex fixes (AI step insertion, workflow modification)

**Benefits**:
- ✅ StructuralRepairEngine doesn't need step insertion logic
- ✅ Calibration system reuses existing transformation handler
- ✅ Clear ownership: detection vs. application
- ✅ Easier to test and maintain

### When to Use This Pattern

**Good for**:
- ✅ Data format transformations (object → array)
- ✅ Parameter type conversions
- ✅ Field mapping to positional data
- ✅ Any fix requiring AI processing step insertion

**Not suitable for**:
- ❌ Simple parameter renames (StructuralRepairEngine can fix directly)
- ❌ Field normalization (operation → action)
- ❌ Variable reference corrections

## Summary

The StructuralRepairEngine can now:

1. **Detect** data transformation issues during pre-flight validation
2. **Propose** fixes with field mappings and confidence scores
3. **Delegate** to calibration system for complex fixes (AI step insertion)

This makes the calibration system significantly more powerful - it can now fix parameter format mismatches BEFORE execution, reducing calibration iterations and improving success rates.

**Key Principle**: Detect early (pre-flight), fix once (iteration 1), validate always (execution).
