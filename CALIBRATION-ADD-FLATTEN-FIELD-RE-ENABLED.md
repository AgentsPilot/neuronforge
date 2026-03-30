# Critical Fix: Re-enabled add_flatten_field Auto-Fix

**Date**: 2026-03-23
**Issue**: Workflow execution failing because flatten step has no field specified
**Root Cause**: Calibration was skipping `add_flatten_field` auto-fix incorrectly

---

## Problem

The Invoice Extraction workflow was failing with:
- **NO files uploaded to Google Drive**
- **NO data added to spreadsheet**
- **Email send failed** (secondary issue)

### Root Cause Analysis

**step2 (flatten) configuration was missing the required `field` property**:

```json
{
  "id": "step2",
  "type": "transform",
  "config": {
    "type": "flatten",
    "input": "matching_emails"
    // MISSING: "field": "emails" or "field": "attachments"
  }
}
```

### Why This Happened

1. **Workflow generation** created an incomplete flatten step (missing field)
2. **Calibration validation** correctly detected the issue (`validateFlattenFields`)
3. **But calibration auto-fix was DISABLED** - lines 1271-1277 in `batch/route.ts`:

```typescript
if (proposal.action === 'add_flatten_field') {
  // ✅ EXECUTION NOW HANDLES THIS - Skip auto-fix
  logger.info({...}, 'SKIPPED: add_flatten_field (execution handles this)');
}
```

4. **Execution layer cannot add missing fields** - it can only:
   - Correct wrong field paths (dot notation bug)
   - Use schema-aware variable resolution
   - Scope AI context

### The Misunderstanding

When we disabled calibration auto-fixes (thinking execution would handle everything), we made a critical distinction error:

| Issue Type | Execution Can Handle? | Calibration Must Fix? |
|------------|----------------------|----------------------|
| **Wrong field path** (e.g., `"emails.attachments"` → `"attachments"`) | ✅ YES - Runtime detection | ❌ NO - Skip fix |
| **Missing field entirely** (e.g., `field: undefined`) | ❌ NO - Nothing to correct | ✅ YES - Must add field |
| **Wrong parameter name** (e.g., `file_url` → `file_content`) | ❌ NO - Different API | ✅ YES - Must fix |

---

## The Fix

**File**: `/app/api/v2/calibrate/batch/route.ts` (lines 1271-1287)

**Changed from**:
```typescript
if (proposal.action === 'add_flatten_field') {
  // Skip - execution handles this
  logger.info({...}, 'SKIPPED: add_flatten_field');
}
```

**Changed to**:
```typescript
if (proposal.action === 'add_flatten_field') {
  // ⚠️ CRITICAL: Execution CANNOT handle missing fields
  const targetStep = findStepByIdRecursive(updatedSteps, proposal.targetStepId);
  const suggestedField = (issue.suggestedFix?.action as any)?.field;

  if (targetStep && suggestedField) {
    if (!(targetStep as any).config) {
      (targetStep as any).config = {};
    }
    (targetStep as any).config.field = suggestedField;
    autoFixesApplied++;
    logger.info({
      issueId: issue.id,
      stepId: proposal.targetStepId,
      field: suggestedField
    }, 'Auto-fix applied: add_flatten_field');
  }
}
```

---

## Impact

### Before Fix
```
step1 (search) → finds 10 emails ✅
step2 (flatten) → field undefined → extracts 0 items ✅ (completes with [])
step3 (filter) → filters 0 items → returns [] ✅
step4 (scatter_gather) → iterates 0 times ✅ (does nothing)
  → NO files uploaded
  → NO spreadsheet rows added
step15 (ai_processing) → generates email from empty data ✅
step16 (send_email) → fails ❌ (separate config issue)
```

**Result**: Workflow appears to complete (7/8 steps) but does nothing useful

### After Fix

When calibration runs again:
1. **Detects** missing field in step2
2. **Applies fix** by adding `field: "attachments"` (or appropriate field from schema)
3. **Workflow executes correctly**:
   ```
   step2 → extracts attachments → returns array of PDFs
   step3 → filters PDFs → returns filtered array
   step4 → iterates over each PDF → uploads files, adds spreadsheet rows ✅
   ```

---

## Calibration Auto-Fix Status (Updated)

| Fix Type | Status | Reason |
|----------|--------|--------|
| **add_flatten_field** | ✅ **ENABLED** | Execution cannot add missing fields |
| **fix_flatten_field** | ❌ DISABLED | Execution handles wrong field paths at runtime |
| **fix_operation_field** (flatten/filter/map) | ❌ DISABLED | Execution handles field path corrections |
| **fix_operation_field** (action_param) | ✅ **ENABLED** | Parameter name validation (execution can't fix) |
| **fix_field_name** | ❌ DISABLED | Execution handles filter field resolution |
| **fix_parameter_reference** | ✅ **ENABLED** | Step reference validation (execution can't fix) |

---

## Testing Instructions

### 1. Verify Fix Applied
```bash
npx tsx scripts/verify-calibration-fix.ts
```

Expected: Should show `add_flatten_field` auto-fix is now enabled

### 2. Run Calibration
Trigger calibration on Invoice Extraction workflow (ID: 43ffbc8a-406d-4a43-9f3f-4e7554160eda)

Expected log:
```
Auto-fix applied: add_flatten_field
stepId: step2
field: attachments
```

### 3. Verify Workflow Fixed
```bash
npx tsx scripts/check-current-workflow-structure.ts
```

Expected:
```
STEP2 (flatten):
  Field: attachments
  ✅ CORRECT - will extract items
```

### 4. Execute Workflow
Run workflow end-to-end

Expected results:
- ✅ Files uploaded to Google Drive
- ✅ Data added to spreadsheet
- ✅ Email sent (if config.digest_recipient resolves correctly)

---

## Remaining Issue: config.digest_recipient

**Separate issue**: step16 still fails with "Recipient address required"

This is NOT a calibration issue - it's a runtime config resolution issue:
- Config value exists: `digest_recipient = "offir.omer@gmail.com"`
- Workflow has reference: `recipients.to = ["{{config.digest_recipient}}"]`
- But variable is not resolving at runtime

**Next steps**: Debug why ExecutionContext.resolveVariable() is not finding config values at step16 execution time.

---

## Summary

**What we fixed**: Re-enabled `add_flatten_field` calibration auto-fix

**Why it was needed**: Execution layer can only correct EXISTING fields, not ADD missing fields

**Expected outcome**: Calibration will now properly fix workflows with missing flatten fields, allowing scatter-gather to process items and upload files/data

**Status**: ✅ Fix applied, ready for testing

---

**Implementation Complete**: 2026-03-23
**Files Modified**: 1 (`app/api/v2/calibrate/batch/route.ts`)
**Lines Changed**: ~15 lines (lines 1271-1287)
