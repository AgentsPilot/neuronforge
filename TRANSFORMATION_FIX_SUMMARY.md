# StructuralRepairEngine Transformation Detection Fix

> **Date**: 2026-04-24
> **Status**: Fix Applied - Awaiting Calibration Run

## Problem Identified

The `findMissingRequiredParams` method was only checking `step.params` for missing parameters, but workflow steps initially use `step.config` before normalization. This caused:

- Step14's missing `values` parameter was **NOT detected** during initial `scanWorkflow`
- Detection only happened later during `autoFixWorkflow` (after normalization)
- `transformationProposals` count remained 0
- The transformation integration never activated

## Fix Applied

### File: `lib/pilot/shadow/StructuralRepairEngine.ts`

**Line 1557** - Changed from:
```typescript
const paramValue = step.params?.[paramName];
```

**To:**
```typescript
const paramValue = step.params?.[paramName] || step.config?.[paramName];
```

This ensures missing parameters are detected regardless of whether the step uses `params` or `config`.

### Additional Debug Logging

**Lines 310-320** - Added debug logging to track step14 structure:
```typescript
if (stepId === 'step14') {
  logger.info({
    stepId,
    hasParams: !!step.params,
    hasConfig: !!step.config,
    paramsKeys: step.params ? Object.keys(step.params) : [],
    configKeys: step.config ? Object.keys(step.config) : [],
    missingParamsCount: missingParams.length
  }, '[StructuralRepair] DEBUG step14 structure during scanWorkflow');
}
```

## Expected Behavior (Next Calibration Run)

When calibration runs with the fix, you should see:

### 1. During Initial Scan
```json
{
  "msg": "[StructuralRepair] DEBUG step14 structure during scanWorkflow",
  "stepId": "step14",
  "hasParams": false,
  "hasConfig": true,
  "configKeys": ["range", "fields", "spreadsheet_id"],
  "missingParamsCount": 1
}
```

### 2. Missing Parameter Detection
```json
{
  "msg": "[StructuralRepair] Detected missing required parameters",
  "stepId": "step14",
  "plugin": "google-sheets",
  "action": "append_rows",
  "missingParams": [{"name": "values", "hasSmartDefault": false}]
}
```

### 3. Transformation Proposal Created
```json
{
  "msg": "[StructuralRepair] Creating auto-repair proposal for data transformation",
  "stepId": "step14",
  "missingParam": "values",
  "providedParam": "fields"
}
```

### 4. Proposal Collection
```json
{
  "msg": "[StructuralRepair] DEBUG: Analyzing structural issues for transformation proposals",
  "totalStructuralIssues": 19,
  "missingParamIssues": 1,        // ✅ NOW 1 instead of 0
  "autoFixableIssues": 17,
  "missingParamAutoFixable": 1     // ✅ NOW 1 instead of 0
}
```

### 5. Transformation Proposal Collected
```json
{
  "msg": "[StructuralRepair] Collected transformation proposal for calibration auto-fix",
  "stepId": "step14",
  "paramName": "values",
  "sourceParam": "fields",
  "confidence": 0.92
}
```

### 6. Final Summary
```json
{
  "msg": "Structural auto-fix complete",
  "fixedCount": 17,
  "totalIssues": 19,
  "transformationProposals": 1     // ✅ NOW 1 instead of 0
}
```

### 7. Injection into Iteration 1
```json
{
  "msg": "[StructuralRepair] Injecting transformation issues into first iteration",
  "loopIteration": 1,
  "transformationIssuesCount": 1
}
```

### 8. Auto-Fix Application
```json
{
  "msg": "Auto-applied: transform_fields_to_values",
  "stepId": "step14"
}
```

## How to Verify

1. **Restart dev server** (already done with latest code)
2. **Run calibration** from the UI
3. **Check logs** for the sequence above:
   ```bash
   grep -E "(DEBUG step14|transformationProposals|Collected transformation)" /tmp/nextjs-calibration.log
   ```

## Current Status

- ✅ Fix implemented and code deployed
- ✅ Server restarted with new code
- ⏳ Waiting for calibration run to verify fix works
- ⏳ Expected: `transformationProposals: 1` in next run

## Files Modified

| File | Line | Change |
|------|------|--------|
| `lib/pilot/shadow/StructuralRepairEngine.ts` | 1557 | Check both params and config for missing parameters |
| `lib/pilot/shadow/StructuralRepairEngine.ts` | 310-320 | Add debug logging for step14 |
| `app/api/v2/calibrate/batch/route.ts` | 279-313 | Add debug logging for issue counts |
