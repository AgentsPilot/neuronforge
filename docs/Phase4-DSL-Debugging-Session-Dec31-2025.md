# Phase 4 DSL Builder Debugging Session - December 31, 2025

## Overview

This document captures the debugging session focused on fixing workflow execution failures in the Phase4DSLBuilder and PILOT DSL execution pipeline. The goal was to make a complete workflow (Gmail → filter urgent client emails → log to Google Sheets) execute successfully end-to-end.

## Target Workflow

**"Urgent External Email Logger to Google Sheets"**
- Scan Gmail inbox for emails from the last 24 hours
- Normalize emails and compute: `sender_domain`, `is_client_sender`, `is_urgent` flags
- Filter for client senders (external domain)
- Filter for urgent emails (subject contains "urgent"/"immediately" or has IMPORTANT label)
- Deduplicate against already-logged entries in Google Sheets
- Loop over each new urgent email and append a row to the sheet
- Output a summary of how many emails were logged

---

## Issues Fixed (In Order)

### Issue 1: Filter Condition Field Reference

**Symptom:** Step 3 failed with `"Unknown variable reference root: is_client_sender"`

**Root Cause:** Filter conditions used plain field names (`is_client_sender`) but the ConditionalEvaluator expected `item.is_client_sender` because during filtering, each array element is set as the `item` variable.

**Fix Location:** `lib/agentkit/v4/core/phase4-dsl-builder.ts` - `buildFilterConfig` method

**Fix:** Updated to output `item.fieldName` instead of stripping the prefix:
```typescript
// Add item. prefix for filter context
field = `item.${plainField}`;
```

---

### Issue 2: AI Processing Steps Routed to Wrong Handler

**Symptom:** Step 2 (ai_processing) went through `GenerateHandler` instead of `ExtractHandler`, returning raw strings instead of parsed JSON. This caused downstream steps to fail with "no input data".

**Root Cause:** `IntentClassifier` forced `generate` intent for any step with both `input` AND `prompt` fields. AI processing steps from Phase4DSLBuilder have both fields.

**Fix Locations:**
1. `lib/agentkit/v4/core/phase4-dsl-builder.ts` - `buildAIProcessingStep` method
2. `lib/orchestration/IntentClassifier.ts` - `classify` method

**Fix:**
1. Added explicit `intent: 'extract'` to all ai_processing steps in DSL builder
2. Added check in IntentClassifier to respect explicit `step.intent` field before classification

```typescript
// In buildAIProcessingStep:
return {
  id: step.id,
  type: 'ai_processing',
  intent: 'extract',  // Explicit intent ensures ExtractHandler is used
  ...
}

// In IntentClassifier.classify():
if (step.intent && validIntents.includes(step.intent)) {
  return { intent: step.intent, confidence: 1.0, ... };
}
```

---

### Issue 3: Aggregate Transform Output Path

**Symptom:** Step 10 failed because `{{step9.data.run_summary}}` resolved to `undefined`.

**Root Cause:** `resolveInput` generated `{{stepId.data.fieldName}}` for aggregate transforms, but `transformAggregate` returns results directly at the `.data` level (e.g., `{ to_log_count: 0 }`), not nested under an output key.

**Fix Location:** `lib/agentkit/v4/core/phase4-dsl-builder.ts` - `resolveInput` method

**Fix:** Added special case for aggregate transforms:
```typescript
if (operation === 'aggregate') {
  // Aggregate transforms return results directly at .data level
  return `{{${stepId}.data}}`;
}
```

---

### Issue 4: Format Transform Using Wrong Operation

**Symptom:** Step 10's format transform was mapped to `map` operation, which expects arrays and doesn't handle template variable expansion from input data.

**Root Cause:** `TRANSFORM_TYPE_TO_OPERATION` mapped `'format'` to `'map'`, but format transforms have different semantics (object-to-string with template expansion).

**Fix Locations:**
1. `lib/agentkit/v4/core/phase4-dsl-builder.ts` - `TRANSFORM_TYPE_TO_OPERATION`
2. `lib/pilot/StepExecutor.ts` - Added `transformFormat` method

**Fix:**
1. Changed mapping: `'format': 'format'` (dedicated operation)
2. Added `case 'format':` in `executeTransformOperation` switch
3. Implemented `transformFormat` and `expandTemplate` methods that resolve template variables (`{{to_log_count}}`) from input data fields directly

```typescript
// Template variable resolution priority:
// 1. Input data fields ({{to_log_count}} → data.to_log_count)
// 2. Nested paths ({{user.name}} → data.user.name)
// 3. Context variables ({{step1.data.field}})
```

---

### Issue 5: Model Name with Embedded Quotes

**Symptom:** ExtractHandler used `max_tokens=4096` (default) instead of `32768` (GPT-5.2's actual limit), causing LLM response truncation.

**Root Cause:** Model name stored in database had embedded quotes (`"gpt-5.2"` instead of `gpt-5.2`). The lookup in `MODEL_MAX_OUTPUT_TOKENS` failed, returning the default.

**Fix Location:** `lib/orchestration/handlers/ExtractHandler.ts`

**Fix:** Added model name sanitization before calling `getModelMaxOutputTokens()`:
```typescript
const sanitizedModel = context.routingDecision.model
  .trim()
  .replace(/^["']|["']$/g, '');  // Remove leading/trailing quotes
```

---

### Issue 6: Scatter-Gather Missing Debug Event

**Symptom:** UI showed step 8 (scatter-gather) as "still running" even though it completed successfully.

**Root Cause:** `WorkflowPilot` emitted `step_complete` debug events for regular steps but not for scatter-gather steps. The `DebugSessionManager.emitEvent()` call was missing.

**Fix Location:** `lib/pilot/WorkflowPilot.ts` - scatter-gather handling section

**Fix:** Added debug event emission for scatter-gather completion:
```typescript
if (debugRunId) {
  DebugSessionManager.emitEvent(debugRunId, {
    type: 'step_complete',
    stepId: stepDef.id,
    stepName: stepDef.name,
    data: {
      output: results,
      duration: Date.now() - startTime,
      plugin: 'system',
      action: 'scatter_gather',
      itemCount: Array.isArray(results) ? results.length : undefined,
    }
  });
}
```

---

### Issue 7: Scatter Input Reference Wrong Path

**Symptom:** Step 8's scatter processed 0 items even though step 7 had 3 emails to log. The workflow reported "Logged 3 emails" but actually logged 0.

**Root Cause:** `buildScatterGatherStep` used `{{${control.collection_ref}}}` directly (e.g., `{{step7.to_log}}`), but step 7's ai_processing output was at `{{step7.data.items}}`.

**Fix Location:** `lib/agentkit/v4/core/phase4-dsl-builder.ts` - `buildScatterGatherStep` method

**Fix:** Added `resolveScatterInput` method that delegates to `resolveInput` for proper path resolution:
```typescript
private resolveScatterInput(collectionRef: string): string {
  const parts = collectionRef.split('.');
  if (parts.length < 2) {
    return `{{${collectionRef}}}`;
  }
  // Use resolveInput with from_step source type
  return this.resolveInput({
    source: 'from_step',
    ref: collectionRef
  });
}
```

---

## Files Modified

| File | Changes |
|------|---------|
| `lib/agentkit/v4/core/phase4-dsl-builder.ts` | Filter field prefix, explicit intent, aggregate path, format operation mapping, scatter input resolution |
| `lib/orchestration/IntentClassifier.ts` | Explicit intent check at start of classify() |
| `lib/orchestration/handlers/ExtractHandler.ts` | Model name sanitization |
| `lib/pilot/StepExecutor.ts` | `transformFormat`, `expandTemplate` methods, format case in switch, JSON response parsing in `executeLLMDecision`, `params` field resolution for non-action steps |
| `lib/pilot/WorkflowPilot.ts` | Scatter-gather debug event emission |
| `lib/server/google-sheets-plugin-executor.ts` | `normalizeValuesForSheets`, `objectToValueArray`, `describeValueFormat` methods for auto-converting objects to value arrays |
| `docs/Phase4-to-PILOT_DSL-Mapping.md` | Updated to v2.8 with all changes documented |

---

## Step Reference Resolution Summary

The `resolveInput` method now correctly resolves step references based on source step type:

| Source Step Type | Phase 4 Reference | PILOT DSL Output |
|------------------|-------------------|------------------|
| action | `step1.emails` | `{{step1.data.emails}}` |
| transform (map) | `step2.mapped` | `{{step2.data}}` |
| transform (filter) | `step3.filtered` | `{{step3.data.items}}` |
| transform (aggregate) | `step9.summary` | `{{step9.data}}` |
| ai_processing | `step7.to_log` | `{{step7.data.items}}` |

---

### Issue 8: AI Processing JSON Response Not Parsed

**Symptom:** `{{step8_2.data.items}}` resolved to `undefined` even though step8_2 returned `{"items":[...]}`.

**Root Cause:** `executeLLMDecision` stored the LLM's JSON response as a raw string under aliases (`result`, `response`, `output`, etc.) but never parsed it. So `step8_2.data` was:
```json
{
  "result": "{\"items\":[...]}",  // STRING - not parsed!
  "response": "{\"items\":[...]}",
  ...
}
```
There was no `items` property at the top level.

**Fix Location:** `lib/pilot/StepExecutor.ts` - `executeLLMDecision` method

**Fix:** Added JSON parsing before returning data, spreading parsed properties for direct access:
```typescript
let parsedData: any = null;
if (typeof cleanedResponse === 'string') {
  try {
    const trimmed = cleanedResponse.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      parsedData = JSON.parse(trimmed);
    }
  } catch (e) {
    // Not valid JSON, keep as string
  }
}

return {
  data: {
    ...(parsedData && typeof parsedData === 'object' ? parsedData : {}),
    result: cleanedResponse,  // Keep string aliases for backward compatibility
    response: cleanedResponse,
    // ... other aliases
  }
};
```

---

### Issue 9: Google Sheets Values Format (Objects Instead of Arrays)

**Symptom:** Google Sheets API returned error: `Invalid values[0][0]: struct_value`. Workflow reported "Logged 3 emails" but 0 rows were actually written.

**Root Cause:** The `values` parameter sent to `append_rows` contained objects instead of flat value arrays:
```json
"values": [[{ "Message ID": "", "Logged at": "...", ... }]]  // WRONG
```
Google Sheets API expects:
```json
"values": [["", "2025-12-31T23:14:57.661Z", ...]]  // CORRECT
```

**Fix Location:** `lib/server/google-sheets-plugin-executor.ts` - `appendRows` method

**Fix:** Added `normalizeValuesForSheets` method that auto-converts objects to value arrays:
```typescript
private normalizeValuesForSheets(values: any): any[][] {
  // Handles:
  // 1. [[{obj}]] → [["v1","v2"]] (array of arrays of objects)
  // 2. [{obj}] → [["v1","v2"]] (array of objects)
  // 3. [["v1","v2"]] → unchanged (already correct)
}

private objectToValueArray(obj: any): any[] {
  return Object.values(obj).map(val => String(val ?? ''));
}
```

---

### Issue 10: Scatter Variable Not Resolved in ai_processing Steps

**Symptom:** step8_2's `params: { "data": "{{email}}" }` resolved to empty `{}`. The LLM only received step8_1's summary text instead of the original email object, causing missing fields (Message ID, From email, Subject).

**Root Cause:** In `StepExecutor.execute()`, parameter resolution for non-action steps only included specific fields (`operation`, `input`, `config`, etc.) but NOT `params`:
```typescript
} else {
  const fieldsToResolve = {};
  if ('operation' in step) fieldsToResolve.operation = step.operation;
  if ('input' in step) fieldsToResolve.input = step.input;
  // ... NO CHECK FOR 'params'!
  resolvedParams = context.resolveAllVariables(fieldsToResolve);
}
```

**Fix Location:** `lib/pilot/StepExecutor.ts` - parameter resolution block

**Fix:** Added `params` to the fields to resolve:
```typescript
if ('params' in stepAny) fieldsToResolve.params = stepAny.params;
```

Now `{{email}}` in ai_processing step params resolves to the actual email object set by the scatter loop.

---

## Current Status

**All issues fixed and tested.** The workflow now:
1. Correctly routes ai_processing steps to ExtractHandler (returns parsed JSON)
2. Parses JSON responses so `{{stepX.data.items}}` works
3. Normalizes object values to arrays for Google Sheets API
4. Resolves scatter loop variables (`{{email}}`) in ai_processing step params
5. Uses correct output paths for all transform types
6. Resolves scatter input to the actual data array
7. Emits proper debug events for UI updates
8. Uses correct max_tokens for LLM calls

**Workflow successfully logged 3 emails to Google Sheets with all columns populated.**

---

## Testing Checklist

- [x] Run workflow and verify step 2 returns `{ items: [...] }` (not raw string)
- [x] Verify step 3 and 4 filters work with `item.field` references
- [x] Verify step 8 scatter receives the correct number of items from step 7
- [x] Verify emails are actually appended to Google Sheets
- [x] Verify all columns are populated (Message ID, From email, Subject, etc.)
- [x] Verify step 8 shows as "completed" in UI (not stuck on "running")
- [x] Verify step 10 format output is correct

---

## Known Remaining Items

1. **Generic OUTPUT FORMAT examples**: The DSL builder generates generic examples like `{"items": [{"field1": "value1", ...}]}` instead of domain-specific examples with actual field names. This could lead to less precise LLM outputs. A future enhancement could generate examples based on step outputs and computed fields mentioned in the prompt.

2. **Token budget allocation**: The budget system allocates conservative tokens for extract intent. There's a dev bypass in ExtractHandler that uses model max tokens in development mode.

---

## Key Architectural Insight

The Phase 4 workflow declares output keys like:
```json
"outputs": {
  "to_log": { "type": "object[]" }
}
```

But these are **documentation/contract metadata only** - they don't affect the actual runtime data structure. The execution layer stores outputs based on the handler's return value:
- `ExtractHandler` returns `{ items: [...] }` or `{ result: ... }`
- `transformAggregate` returns the aggregation object directly
- `transformFilter` returns `{ items: [...], removed: N, ... }`

The DSL builder must translate Phase 4 output key references to actual runtime paths.

---

## Session Context for Future Reference

**Workflow file tested:** `thread-communications- v5Generator 2.10O.json`
**Test page:** `/test-plugins-v2`
**Log file:** `dev.log` in project root
**Initial session:** December 31, 2025
**Last updated:** January 1, 2026 (Issues 8-10 fixed, workflow fully operational)
