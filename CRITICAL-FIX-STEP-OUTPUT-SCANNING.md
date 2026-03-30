# Critical Fix: Scan Step Outputs Instead of Execution Trace

## Problem Discovered

The scatter-gather error detection code was scanning the wrong data structure!

**What was happening**:
```typescript
// OLD CODE - WRONG
const { data: executionRecord } = await supabase
  .from('workflow_executions')
  .select('execution_trace')
  .eq('id', result.executionId)
  .single();

const executionTrace = executionRecord?.execution_trace || {};

for (const [stepId, stepTrace] of Object.entries(executionTrace)) {
  // Scanning execution_trace which contains METADATA
}
```

**Execution trace structure** (from logs):
```json
{
  "failedSteps": [...],
  "skippedSteps": [...],
  "completedSteps": [...],
  "stepExecutions": {...}
}
```

This is **metadata about execution**, not the actual step outputs!

**What we needed**:
```json
{
  "step1": { "emails": [...] },
  "step2": [ {...}, {...} ],
  "step3": [ {...}, {...} ],
  "step4": [
    {"error": "...", "item": 0},
    {"error": "...", "item": 1}
  ]  // ← This is what we're looking for!
}
```

## The Fix

Changed to scan `result.output` which contains actual step outputs:

```typescript
// NEW CODE - CORRECT
const stepOutputs = result.output || {};

logger.info({
  sessionId,
  loopIteration,
  outputStepIds: Object.keys(stepOutputs),
  outputStepCount: Object.keys(stepOutputs).length
}, 'Scanning step outputs for scatter-gather errors');

for (const [stepId, stepOutput] of Object.entries(stepOutputs)) {
  const output = stepOutput as any;

  if (output && Array.isArray(output)) {
    // Check if any items have error fields
    const errorItems = output.filter((item: any) =>
      item && typeof item === 'object' && item.error
    );

    if (errorItems.length > 0) {
      // Found scatter-gather errors!
      // Create auto-fixable issue...
    }
  }
}
```

## Why This Matters

Your logs showed:
```
"step4": [
  {
    "error": "Calibration stopped at undefined: document-extractor extract_structured_data failed: Fetching from file_url not implemented...",
    "item": 0
  },
  {
    "error": "...",
    "item": 1
  }
]
```

This is in `result.output.step4`, NOT in `executionTrace`!

The old code was looking in the wrong place, so it never found the errors.

## Impact

**Before**:
- ❌ Scanned execution_trace (metadata only)
- ❌ Never found step4's error array
- ❌ No scatter-gather errors detected
- ❌ Parameter mismatch auto-fix never triggered
- ❌ Calibration exited with "awaiting_fixes"

**After**:
- ✅ Scans result.output (actual step outputs)
- ✅ Finds step4's error array
- ✅ Detects scatter-gather errors
- ✅ Parses error message for parameter mismatch
- ✅ Creates auto-fixable issue
- ✅ Applies fix and re-executes

## Test Now

Please trigger calibration again. You should now see:

1. **Log**: "Scanning step outputs for scatter-gather errors"
2. **Log**: "outputStepIds": ["step1", "step2", "step3", "step4", ...]
3. **Log**: "Checking step output for errors" (for step4)
4. **Log**: "Detected scatter-gather items with errors"
5. **Log**: "Searching for scatter-gather step with parameter mismatch"
6. **Log**: "Detected auto-fixable parameter mismatch in scatter-gather nested step"
7. **Log**: "Applied parameter rename fix"

Then iteration 2 should succeed with file_content instead of file_url!

## Files Modified

**`app/api/v2/calibrate/batch/route.ts`**:
- Lines 531-565: Changed from scanning execution_trace to result.output
- Line 677-683: Re-added execution_trace fetch for SmartLogicAnalyzer only (it needs metadata)
