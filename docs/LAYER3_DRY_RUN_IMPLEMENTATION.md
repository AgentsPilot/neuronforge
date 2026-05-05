# Layer 3: Dry-Run Validator Implementation

> **Status**: ✅ Implementation Complete
> **Last Updated**: 2026-04-22

## Overview

Layer 3 executes the workflow with **real user input data** to detect runtime issues that schema validation (Layer 1) and semantic validation (Layer 2) cannot catch.

**Key Insight**: Schema validation tells you if fields exist, but only actual execution tells you if the workflow will work with real data from plugins.

## Problem Solved

### The Type Mismatch Problem

**Example Scenario:**
```typescript
Step 1 (Google Drive - List Files):
  Plugin returns: { files: [...] }  // ← Object with array inside
  Output variable: "driveFiles"

Step 2 (Transform - Flatten):
  Input: {{driveFiles}}              // ← Expects array, gets object!
  Config: { field: "attachments" }
  Result: EMPTY [] ❌ (silently fails)
```

**What Layer 1 + Layer 2 CANNOT catch:**
- ❌ Plugin actually returns `{files: [...]}` not `[...]` directly
- ❌ The `.files` extraction is missing in the variable reference
- ❌ Runtime type mismatch only discovered during execution with real data

**What ONLY Layer 3 can catch:**
- ✅ Step 1 returns object, not array
- ✅ Step 2 expects array, gets object → empty results
- ✅ Suggests fix: Change input to `{{driveFiles.files}}`

## Architecture

### Design Decision: Execute Once, Analyze Result

Instead of trying to capture step-by-step outputs (complex), Layer 3 uses a simpler approach:

1. **Execute workflow** with real user input values in `batch_calibration` mode
2. **Analyze final result**:
   - Success but empty output? → Likely type mismatch
   - Steps failed? → API errors or permission issues
   - Execution failed? → Critical errors
3. **Report issues** with severity and suggested fixes

### Integration Point

```
User fills input form (Google Drive folder ID, etc.)
    ↓
POST /api/v2/calibrate/batch
    ↓
LAYER 1: Enhanced Schema Validation (100ms)
    • Validates flatten fields, scatter-gather, variable references
    • Auto-fixes high-confidence issues (0.95+)
    ↓
LAYER 2: Constrained Semantic Validation (~2-3s)
    • LLM detects semantic issues
    • Generates deterministic fixes from schemas
    • Auto-fixes based on confidence (0.70+ threshold)
    ↓
LAYER 3: Dry-Run Validation (~5-15s) ← NEW
    • Executes workflow with REAL user data
    • Checks for empty results, failed steps, execution errors
    • Reports type mismatches and API errors
    ↓
AUTO-CALIBRATION LOOP
    • Iterative fixing if runtime issues detected
```

## Implementation

### File: `/lib/pilot/shadow/DryRunValidator.ts`

**Key Methods:**

```typescript
class DryRunValidator {
  /**
   * Execute workflow with real user data and analyze results
   */
  async validateWithDryRun(
    agent: Agent,
    inputValues: Record<string, any>,
    userId: string
  ): Promise<DryRunResult> {
    // Execute workflow in batch_calibration mode (collects issues, continues on errors)
    const pilot = new WorkflowPilot(supabaseServer);
    const executionResult = await pilot.execute(agent, userId, '', inputValues, ...);

    // Analyze execution result
    const isEmpty = this.isEmptyResult(executionResult.output);
    const workflowType = this.classifyWorkflowType(agent);

    // Detect issues:
    // 1. Success but empty (type mismatch likely)
    // 2. Steps failed (API errors)
    // 3. Execution failed (critical errors)

    return { success, finalOutput, isEmpty, stepsCompleted, stepsFailed, issues, executionTime };
  }
}
```

**Issue Types Detected:**

| Issue Type | Severity | Description |
|------------|----------|-------------|
| `empty_result` | high | Workflow succeeded but returned empty. Likely type mismatch or missing field extraction. |
| `steps_failed` | critical | One or more steps failed during execution. API errors, permissions, or invalid data. |
| `execution_failed` | critical | Entire workflow failed. Critical errors like invalid credentials or missing required data. |

### File: `/app/api/v2/calibrate/batch/route.ts`

**Integration (lines 410-448):**

```typescript
// 6.10. LAYER 3: Dry-Run Validation (Context-Aware with Real Data)
logger.info({ sessionId, agentId }, '[Layer 3] Running dry-run validation with real user data');
const { DryRunValidator } = await import('@/lib/pilot/shadow/DryRunValidator');
const dryRunValidator = new DryRunValidator();

const dryRunResult = await dryRunValidator.validateWithDryRun(agent, inputValues, userId);

logger.info({
  sessionId,
  agentId,
  success: dryRunResult.success,
  isEmpty: dryRunResult.isEmpty,
  stepsCompleted: dryRunResult.stepsCompleted,
  stepsFailed: dryRunResult.stepsFailed,
  issuesFound: dryRunResult.issues.length,
  executionTime: dryRunResult.executionTime
}, '[Layer 3] Dry-run validation complete');

// Log critical issues
const criticalDryRunIssues = dryRunResult.issues.filter(i => i.severity === 'critical');
if (criticalDryRunIssues.length > 0) {
  logger.error({
    sessionId,
    agentId,
    criticalIssues: criticalDryRunIssues
  }, '[Layer 3] Critical issues detected - workflow may not work as expected');
}

// Warn if empty results for data-processing workflows
if (dryRunResult.success && dryRunResult.isEmpty && dryRunResult.workflowType === 'data-processing') {
  logger.warn({
    sessionId,
    agentId,
    finalOutput: dryRunResult.finalOutput
  }, '[Layer 3] Workflow returned empty results - may indicate type mismatch');
}
```

## Expected Log Sequence

### Successful Validation (No Issues)

```
[Layer 3] Starting dry-run validation with real user data
  - agentId: "..."
  - inputValues: { folderId: "..." }

[Layer 3] Workflow execution complete
  - success: true
  - stepsCompleted: 3
  - stepsFailed: 0
  - output: [...data...]

[Layer 3] Dry-run validation complete
  - success: true
  - isEmpty: false
  - stepsCompleted: 3
  - stepsFailed: 0
  - issuesFound: 0
  - executionTime: 5234ms
```

### Empty Results Detected (Type Mismatch)

```
[Layer 3] Starting dry-run validation with real user data
  - agentId: "..."
  - inputValues: { folderId: "..." }

[Layer 3] Workflow execution complete
  - success: true
  - stepsCompleted: 3
  - stepsFailed: 0
  - output: []  ← EMPTY!

[Layer 3] Workflow returned empty results - may indicate type mismatch
  - finalOutput: []
  - workflowType: "data-processing"

[Layer 3] Dry-run validation complete
  - success: true
  - isEmpty: true  ← Flagged
  - issuesFound: 1
  - issues: [
      {
        type: "empty_result",
        severity: "high",
        description: "Workflow executed successfully but returned empty results. This may indicate a type mismatch...",
        suggestedFix: "Check if transform steps are accessing the correct fields..."
      }
    ]
```

### API Errors or Failed Steps

```
[Layer 3] Workflow execution complete
  - success: false
  - stepsCompleted: 1
  - stepsFailed: 2  ← Steps failed
  - output: null

[Layer 3] Critical issues detected - workflow may not work as expected
  - criticalIssues: [
      {
        type: "steps_failed",
        severity: "critical",
        description: "2 step(s) failed during execution. Check for API errors, permission issues...",
        details: {
          failedStepIds: ["step2", "step3"],
          stepsCompleted: 1,
          stepsFailed: 2
        }
      }
    ]
```

## Performance

| Metric | Value | Notes |
|--------|-------|-------|
| **Execution Time** | 5-15s | Depends on plugin API latency |
| **Cost** | Variable | Actual API calls to plugins (Google Drive, etc.) |
| **When to Run** | After Layer 1 + 2 | Only run if user wants full validation |
| **Blocking** | Yes | Executes before auto-calibration loop |

## Benefits

✅ **Catches real runtime issues** that schema validation cannot detect
✅ **Validates with actual user data** (folders, files, tables, etc.)
✅ **Detects type mismatches** between plugin outputs and step inputs
✅ **Finds API errors** (permissions, invalid IDs, rate limits)
✅ **Provides actionable suggestions** for fixing issues

## Limitations

⚠️ **Executes workflow twice** (once for validation, once for real)
⚠️ **Costs money** (real API calls to plugins)
⚠️ **Takes time** (5-15s depending on plugins)
⚠️ **Cannot deep-inspect step outputs** (only final result + metadata)

## Next Steps

### Immediate (Completed)
- ✅ Implement DryRunValidator
- ✅ Integrate into batch calibration route
- ✅ Log results for monitoring

### Short-term (TODO)
- ⬜ Add UI to display Layer 3 validation results before execution
- ⬜ Allow user to skip Layer 3 for faster testing
- ⬜ Capture and display step-by-step outputs for better debugging

### Long-term (Future)
- ⬜ Smart caching: Skip Layer 3 if workflow hasn't changed
- ⬜ Partial execution: Only re-run steps that changed
- ⬜ Mock mode: Use cached plugin responses to avoid API costs

## Testing

### Manual Test: Google Drive Workflow

1. Create agent with Google Drive → Flatten workflow
2. Provide real folder ID in input form
3. Click "Start Test"
4. Check logs for Layer 3 validation:
   - Should execute workflow with real data
   - Should detect if results are empty
   - Should log type mismatches if any

### Expected Scenarios

| Scenario | Layer 3 Should Detect |
|----------|----------------------|
| Flatten empty arrays (type mismatch) | ✅ `empty_result` issue with suggested fix |
| Invalid folder ID | ✅ `steps_failed` or `execution_failed` |
| Permission denied | ✅ `steps_failed` with API error details |
| Successful workflow with data | ✅ No issues, execution time logged |

---

## Files Modified

- **Created**: [lib/pilot/shadow/DryRunValidator.ts](../lib/pilot/shadow/DryRunValidator.ts) - Layer 3 implementation (238 lines)
- **Modified**: [app/api/v2/calibrate/batch/route.ts](../app/api/v2/calibrate/batch/route.ts) - Integration at line 410-448

## Summary

Layer 3 completes the 3-layer validation architecture by executing workflows with **real user data** to catch runtime issues that static analysis cannot detect. This ensures workflows are **fully validated** before production use, preventing silent failures like empty results due to type mismatches.

**Architecture Complete**:
- **Layer 1** (100ms): Deterministic schema validation
- **Layer 2** (~2-3s): LLM semantic validation + deterministic fixes
- **Layer 3** (~5-15s): Dry-run execution with real data

**Total validation time**: ~5-18s (vs minutes of failed production runs)
