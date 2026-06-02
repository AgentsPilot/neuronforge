# Calibration Auto-Fix Implementation Summary

> **Date**: 2026-04-24
> **Status**: Ready for Testing

## Issues Fixed

### ✅ Issue 1: Base64url Corruption (COMPLETED EARLIER)
**File**: `lib/server/gmail-plugin-executor.ts`

**Problem**: Gmail API returns base64url format, Google Drive expects standard base64

**Fix Applied**:
- Added `convertBase64UrlToBase64()` method to convert `-` and `_` to `+` and `/`
- Modified `getEmailAttachment()` to convert base64url before returning

**Impact**: PDF files now upload correctly to Google Drive

---

### ✅ Issue 2: Object-to-Field Extraction Auto-Fix (NEW)
**File**: `app/api/v2/calibrate/batch/route.ts`

**Problem**: Step 9 receives `{{drive_file}}` (entire object) instead of `{{drive_file.file_id}}` (string)

**Root Cause**:
- Google Drive share_file action expects `file_id` parameter as a string
- Workflow was passing the entire drive_file object
- This caused step 4 (scatter-gather) to fail completely
- Step 15 (ai_processing) depends on step 4, so it was skipped
- Step 16 (send_email) failed because `digest_content` from step 15 didn't exist

**Fix Applied** (Lines 1751-1868):

```typescript
// Pattern 3: Object-to-field extraction
const objectToFieldPattern = /(?:resource|file|item|record).*?not found/i;
if (objectMatch && !issue.autoRepairAvailable) {
  // Find scatter-gather step
  // Check each nested step's parameters
  // If parameter is {{varName}} without field accessor (no dot)
  // Suggest {{varName.paramName}} to extract the field

  issue.autoRepairProposal = {
    type: 'extract_object_field',
    stepId: nestedStepId,
    confidence: 0.90,
    changes: [{
      path: `config.${paramName}`,
      oldValue: '{{drive_file}}',
      newValue: '{{drive_file.file_id}}',
      action: 'add_field_accessor'
    }]
  };
}
```

**Fix Application Handler** (Lines 2439-2508):

```typescript
else if (proposal.type === 'extract_object_field') {
  // Find nested step in scatter-gather
  // Update parameter value from {{object}} to {{object.field}}
  nestedConfig[paramName] = change.newValue;

  logger.info('Auto-applied: extract_object_field (added field accessor to parameter)');
}
```

**Impact**:
- Step 9 will now correctly extract `file_id` from drive_file object
- Step 4 (scatter-gather) will succeed
- Step 11 and 15 (dependent on step 4) will execute
- Step 15 will create `digest_content` variable
- Step 16 will successfully send email using `digest_content`
- **Entire workflow becomes executable**

---

### ⚠️ Issue 3: Fields-to-Values Transformation (LOGGED ONLY)
**File**: `app/api/v2/calibrate/batch/route.ts`

**Problem**: Step 14 (append_rows) has `fields` parameter but Google Sheets expects `values` 2D array

**Current Status**:
- Detection logged for analysis
- NOT auto-fixed in calibration
- **Should be fixed at IR compiler level** (not calibration level)

**Reason**:
- Complex transformations should be handled by the IR compiler
- Calibration auto-fixes should be simple, high-confidence corrections
- This ensures generic behavior across all plugins

**Logged Information** (Lines 1869-1898):
```typescript
logger.info({
  stepPlugin: targetStep.plugin,
  stepAction: targetStep.action,
  providedParams,
  missingParam: 'values',
  message: 'Detected missing required parameter. Provided params logged for analysis.'
}, 'Missing required parameter detected - check if transformation needed');
```

---

## Expected Calibration Flow

### Before Fixes:
1. Step 1-3: Execute successfully
2. Step 4 (scatter-gather): **FAILS** at step 9 (file_id issue)
3. Step 11, 15: **SKIPPED** (dependency on failed step 4)
4. Step 16: **FAILS** (digest_content doesn't exist)
5. Calibration detects 2 issues but `autoFixesApplied: 0`

### After Fixes:
1. **Iteration 1**:
   - Step 9 fails with "Resource not found"
   - Calibration detects object-to-field pattern
   - Auto-fix applied: `{{drive_file}}` → `{{drive_file.file_id}}`
   - Workflow updated and saved

2. **Iteration 2**:
   - Step 1-3: Execute successfully
   - Step 4 (scatter-gather): **SUCCEEDS** (step 9 now works)
   - Step 11: Filters high-value items
   - Step 15: Creates digest_content variable
   - Step 16: **SUCCEEDS** (digest_content exists)
   - Calibration completes with no remaining issues

---

## Testing Instructions

1. **Start dev server with logging**:
   ```bash
   lsof -ti:3000 | xargs kill -9 2>/dev/null || true
   npm run dev > /tmp/nextjs-calibration.log 2>&1 &
   sleep 3
   ```

2. **Run calibration** via UI

3. **Check logs**:
   ```bash
   # Check for auto-fix detection
   grep "Pattern 3 matched (object-to-field)" /tmp/nextjs-calibration.log

   # Check for auto-fix application
   grep "Auto-applied: extract_object_field" /tmp/nextjs-calibration.log

   # Check final calibration status
   grep "autoFixesApplied\|remainingIssues" /tmp/nextjs-calibration.log | tail -5

   # Check if step 15 executes
   grep "Executing step.*step15" /tmp/nextjs-calibration.log

   # Check if step 16 succeeds
   grep "step16.*completed" /tmp/nextjs-calibration.log
   ```

---

## Files Modified

| File | Lines | Change |
|------|-------|--------|
| `lib/server/gmail-plugin-executor.ts` | 252, 689-709 | Base64url conversion |
| `app/api/v2/calibrate/batch/route.ts` | 1751-1868 | Object-to-field detection |
| `app/api/v2/calibrate/batch/route.ts` | 2439-2508 | Object-to-field fix handler |
| `app/api/v2/calibrate/batch/route.ts` | 1869-1898 | Missing param logging |

---

## Next Steps

1. ✅ **Completed**: Implement auto-fix patterns
2. ⬜ **Pending**: Test calibration with new fixes
3. ⬜ **Pending**: Verify workflow is 100% executable
4. ⬜ **Future**: Fix fields-to-values transformation at IR compiler level

---

## Architecture Notes

### Why Not Auto-Fix Everything?

**Good auto-fixes (calibration level)**:
- Parameter renames: `file_url` → `file_content`
- Field extraction: `{{object}}` → `{{object.field}}`
- Adding fallback values for null fields
- Simple missing parameter detection

**Bad auto-fixes (compiler level)**:
- Complex transformations: `fields` object → `values` array
- Plugin-specific logic
- Structural changes to workflow steps
- Changes that require understanding business logic

**Principle**: Calibration auto-fixes should be **high-confidence, simple corrections** that work generically across all plugins.
