# CRITICAL BUG FIX: Output Variable vs Step ID Mismatch

## The Bug

The calibration system was **completely failing to detect scatter-gather errors** because it was looking for steps by the wrong identifier.

### Root Cause

When scanning step outputs for errors, the code iterates over `stepOutputs` which is keyed by **output_variable names**, not step IDs:

```typescript
// Line 548: stepId here is the OUTPUT VARIABLE NAME, not the step ID!
for (const [stepId, stepOutput] of Object.entries(stepOutputs)) {
  // ...
  // Line 595: This search NEVER finds the step!
  const scatterStep = (currentAgent.pilot_steps || []).find((s: any) =>
    s.id === stepId || s.step_id === stepId  // ❌ Looking for id="processed_items"
  );
}
```

### Example

**Step4 configuration:**
```json
{
  "id": "step4",
  "type": "scatter_gather",
  "output_variable": "processed_items"
}
```

**stepOutputs object:**
```javascript
{
  "processed_items": [  // ← Key is output_variable, NOT step id!
    { error: "folder_name is required", item: 0 },
    { error: "folder_name is required", item: 1 }
  ]
}
```

**Detection code (BEFORE fix):**
```typescript
// stepId = "processed_items"
const scatterStep = steps.find(s => s.id === "processed_items");  // ❌ Never finds it!
// scatterStep = undefined
```

**Result:**
- ❌ Scatter step not found
- ❌ Error detection skipped
- ❌ No auto-repair proposal generated
- ❌ Calibration exits without fixing anything

## The Fix

Added `output_variable` check to the step search:

```typescript
// Line 595-597 (FIXED)
const scatterStep = (currentAgent.pilot_steps || []).find((s: any) =>
  s.output_variable === stepId ||  // ✅ Check output_variable first!
  s.id === stepId ||
  s.step_id === stepId
);
```

**Same fix applied to both error detection patterns:**
1. **Parameter mismatch** (line 595)
2. **Required parameter null** (line 655)

## Impact

### Before Fix
```
✅ Step outputs scanned
❌ Scatter step lookup fails (stepId="processed_items" doesn't match id="step4")
❌ Error detection skipped
❌ No fixes proposed
❌ Workflow continues to fail
```

### After Fix
```
✅ Step outputs scanned
✅ Scatter step found (output_variable="processed_items" matches!)
✅ Error pattern detected: "folder_name is required"
✅ Smart fallback generated: "Unknown Vendor"
✅ Sanitize step inserted
✅ Workflow succeeds
```

## Files Modified

### `/app/api/v2/calibrate/batch/route.ts`

**Lines 594-607:** Parameter mismatch detection
```typescript
const scatterStep = (currentAgent.pilot_steps || currentAgent.workflow_steps || []).find((s: any) =>
  s.output_variable === stepId || s.id === stepId || s.step_id === stepId
);
```

**Lines 652-664:** Required parameter null detection
```typescript
const scatterStep = (currentAgent.pilot_steps || currentAgent.workflow_steps || []).find((s: any) =>
  s.output_variable === stepId || s.id === stepId || s.step_id === stepId
);
```

## Why This Was Missed

The bug was subtle because:
1. **In pre-flight validation**, steps are accessed by `id` directly (works fine)
2. **In runtime detection**, steps are accessed via `stepOutputs` keys (uses output_variable names)
3. The mismatch only occurs for steps that have **custom output_variable names**
4. Most steps don't set custom output_variable, so `id` and the trace key match

## Testing

To verify the fix works:

1. **Check step output variable:**
   ```bash
   npx tsx scripts/check-step4-output-variable.ts
   # Should show: output_variable="processed_items", id="step4"
   ```

2. **Trigger calibration:**
   ```bash
   # Workflow should fail with "folder_name is required"
   # Calibration should detect it and insert sanitize step
   ```

3. **Check logs:**
   ```
   ✅ "foundScatterStep: true"
   ✅ "scatterStepActualId: step4"
   ✅ "Detected required parameter with variable that resolved to null/empty"
   ✅ "Auto-applied: add_extraction_fallback (inserted sanitize step)"
   ```

4. **Verify workflow updated:**
   ```bash
   npx tsx scripts/check-if-sanitize-step-exists.ts
   # Should show: step6_sanitize exists, step7 uses extracted_fields_clean
   ```

5. **Re-run workflow:**
   ```
   ✅ step6: Extract → {vendor: null}
   ✅ step6_sanitize: Sanitize → {vendor: "Unknown Vendor"}
   ✅ step7: Create folder → SUCCESS
   ✅ All 4 PDFs processed
   ```

## Lessons Learned

1. **Variable naming matters**: Output variable names and step IDs are NOT the same
2. **Trace structure**: Execution traces are keyed by output_variable, not step ID
3. **Lookup ambiguity**: Always check multiple possible identifiers (output_variable, id, step_id)
4. **Error messages**: "Calibration stopped at undefined" was a clue that step lookup failed

## Related Issues

This same pattern needs to be checked in other parts of the codebase:
- Pre-flight validation (likely already correct, uses direct step access)
- Smart logic analyzer (check if it has the same issue)
- Any other code that looks up steps by trace output keys

## Next Steps

1. ✅ Fix applied
2. ✅ Build succeeded
3. ⏳ Test with actual workflow
4. ⏳ Verify end-to-end success
5. ⏳ Add unit test for output_variable vs id mismatch
