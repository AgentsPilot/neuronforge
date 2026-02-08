# Execution Output Cache Solution

## Problem

When resuming a failed calibration execution after fixing hardcoded values:
- ❌ All steps re-executed from step 1 (wasteful, especially for LLM steps)
- ❌ Non-deterministic LLM steps may produce different results on re-execution
- ❌ Costs more tokens and time

**Root Cause**: Step outputs (client data) were not persisted anywhere, so resume had to re-execute all steps to rebuild data flow.

---

## Solution: In-Memory Output Cache

Store step outputs in **memory** (not database) during execution, restore on resume.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Initial Execution                         │
├─────────────────────────────────────────────────────────────┤
│ Step 1 → Success                                            │
│   ├─ Output cached in ExecutionOutputCache (memory)         │
│   └─ Metadata saved to DB (no data)                         │
│                                                              │
│ Step 2 → Success                                            │
│   ├─ Output cached in ExecutionOutputCache (memory)         │
│   └─ Metadata saved to DB (no data)                         │
│                                                              │
│ ...                                                          │
│                                                              │
│ Step 10 → Failed (hardcoded value error)                    │
│   └─ Error metadata saved to DB                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              User Fixes Hardcoded Value                      │
├─────────────────────────────────────────────────────────────┤
│ 1. User enters corrected value in UI                        │
│ 2. fix-hardcode API updates workflow_steps                  │
│ 3. User clicks "Retry with Fixed Value"                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   Resume Execution                           │
├─────────────────────────────────────────────────────────────┤
│ Resume API:                                                  │
│   ├─ Clears only failedSteps[] (keeps completedSteps[])     │
│   └─ Status → 'running'                                      │
│                                                              │
│ StateManager.resumeExecution():                              │
│   ├─ Detects partial resume (completedSteps.length > 0)     │
│   ├─ Restores outputs from ExecutionOutputCache             │
│   │   ├─ step1 output → context.stepOutputs.set('step1')    │
│   │   ├─ step2 output → context.stepOutputs.set('step2')    │
│   │   └─ ... all completed steps                            │
│   └─ Returns ExecutionContext with restored outputs         │
│                                                              │
│ WorkflowPilot.resume():                                      │
│   ├─ Loads execution plan                                   │
│   ├─ Filters to incomplete steps (only step10)              │
│   └─ Executes step 10 with FIXED value                      │
│       └─ Can access {{step9.data}} ✅ (restored from cache) │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation

### 1. ExecutionOutputCache (New File)
**File**: `lib/pilot/ExecutionOutputCache.ts`

Global singleton that stores step outputs in memory:
- `setStepOutput(executionId, stepId, data, metadata)` - Cache output
- `getAllOutputs(executionId)` - Get all outputs for execution
- `clearExecution(executionId)` - Clean up when done
- Auto-cleanup: Expires after 1 hour (prevents memory leaks)

### 2. StepExecutor (Modified)
**File**: `lib/pilot/StepExecutor.ts:390-424`

When step completes:
```typescript
// Cache full output in memory (NOT in database)
executionOutputCache.setStepOutput(
  context.executionId,
  step.id,
  result, // Full data
  metadata
);

// Save only metadata to database (NO client data)
await this.stateManager.updateStepExecution(
  context.executionId,
  step.id,
  'completed',
  {
    item_count: result.length,
    field_names: Object.keys(result[0]),
    // NO output_data!
  }
);
```

### 3. StateManager (Modified)
**File**: `lib/pilot/StateManager.ts:605-630`

On resume, restore outputs from cache:
```typescript
if (!isFreshRestart && context.completedSteps.length > 0) {
  const cachedOutputs = executionOutputCache.getAllOutputs(executionId);

  for (const stepId of context.completedSteps) {
    const cached = cachedOutputs.get(stepId);
    if (cached) {
      context.setStepOutput(stepId, {
        stepId,
        data: cached.data, // Restored!
        metadata: cached.metadata,
      });
    }
  }
}
```

### 4. Resume API (Modified)
**File**: `app/api/calibrate/resume/route.ts:163-183`

Only clear failed steps (not completed):
```typescript
const updatedTrace = {
  ...executionTrace,
  failedSteps: [],  // Only clear failed
  // Keep completedSteps intact!
};
```

---

## Privacy & Security

✅ **Client data NEVER stored in database**
- Only metadata (item count, field names) saved to DB
- Full output data only in memory (ExecutionOutputCache)

✅ **Auto-expiration**
- Cache entries expire after 1 hour
- Prevents memory leaks

✅ **Single-server limitation**
- Cache is in Node.js process memory
- For production with load balancing, replace with Redis

---

## Benefits

✅ **No re-execution of completed steps**
- Fix step 10 → only step 10 re-executes
- Steps 1-9 outputs restored from cache

✅ **Deterministic results**
- LLM steps don't re-run with potentially different results
- Data consistency guaranteed

✅ **Cost savings**
- No wasted tokens on re-executing LLM steps
- Faster execution (no waiting for completed steps)

✅ **Privacy-first**
- No client data in database
- Only in memory during active execution

---

## Trade-offs

⚠️ **Memory usage**
- Step outputs stored in Node.js heap
- For large workflows, consider output size limits

⚠️ **Single server only**
- Doesn't work with horizontal scaling
- For production, use Redis/Memcached

⚠️ **Cache miss handling**
- If cache expires or server restarts, falls back to re-executing from step 1
- Acceptable for calibration (rare occurrence)

---

## Testing

Test scenario:
1. Create agent with 10 steps
2. Step 2 and step 10 have hardcoded values
3. Run calibration → fails at step 2
4. Fix step 2 → retry → fails at step 10
5. ✅ Verify: Steps 1-9 NOT re-executed (check logs)
6. Fix step 10 → retry → succeeds
7. ✅ Verify: Steps 1-9 NOT re-executed (check logs)
8. ✅ Verify: All steps complete successfully
9. ✅ Verify: Total token count is correct (no duplicate LLM calls)

---

## Files Modified

1. ✅ `lib/pilot/ExecutionOutputCache.ts` - NEW: In-memory cache
2. ✅ `lib/pilot/StepExecutor.ts` - Cache outputs, removed output_data from DB
3. ✅ `lib/pilot/StateManager.ts` - Restore outputs from cache on resume
4. ✅ `app/api/calibrate/resume/route.ts` - Only clear failed steps
5. ✅ `app/api/calibrate/status/route.ts` - Updated to use field_names instead of output_data

---

## Future Enhancements

### Option 1: Redis Cache (Production)
Replace ExecutionOutputCache with Redis:
```typescript
await redis.setex(
  `execution:${executionId}:step:${stepId}`,
  3600, // 1 hour TTL
  JSON.stringify({ data, metadata })
);
```

### Option 2: Selective Re-execution
Analyze step dependencies:
- If step 10 doesn't use {{stepN.data}} from completed steps → re-execute only step 10
- If step 10 uses {{step9.data}} but cache miss → re-execute from step 9

### Option 3: Output Size Limits
Prevent memory issues:
```typescript
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB
if (JSON.stringify(output).length > MAX_OUTPUT_SIZE) {
  // Don't cache, force re-execution on resume
}
```
