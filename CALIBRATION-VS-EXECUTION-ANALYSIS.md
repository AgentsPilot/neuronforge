# Calibration vs Execution: What's Still Needed?

**Date**: 2026-03-23
**Context**: After implementing execution-layer fixes, analyzing which calibration fixes are now redundant

---

## Executive Summary

With schema-aware execution in place, **MOST calibration fixes are now redundant**. Execution can handle type mismatches, field extraction, and data flow automatically.

However, **some calibration is still valuable** for catching generation errors that execution can't fix.

---

## Calibration Fixes That Are NOW REDUNDANT

### ✅ Field Extraction (No Longer Needed)

**Old Calibration Fix**: Detected `{{drive_file}}` and changed to `{{drive_file.file_id}}`

**Why Redundant**:
- Execution now does schema-aware extraction automatically
- If parameter expects string and variable is object with matching field, auto-extracts
- No need for calibration to rewrite variable references

**Recommendation**: **DISABLE** this calibration fix

**Files to Update**:
- `/app/api/v2/calibrate/apply-fixes/route.ts` - Remove field extraction fixes
- `/lib/pilot/WorkflowValidator.ts` - Keep validation but don't auto-fix

---

### ✅ Flatten Field Path Fixes (No Longer Needed)

**Old Calibration Fix**: Detected wrong flatten field path and corrected it

**Why Redundant**:
- WorkflowValidator now generates correct field paths from the start (includePathPrefixes=false)
- Runtime detection warns about dot-notation fields and uses last segment
- Should never need fixing anymore

**Recommendation**: **KEEP** validation to detect bugs, but **DON'T** auto-fix (execution handles it)

---

### ✅ Parameter Unwrapping (No Longer Needed)

**Old Calibration Fix**: Detected JSON string parameters and suggested unwrapping

**Why Redundant**:
- Schema-aware resolution handles this automatically
- Execution extracts fields based on parameter schema + output schema
- No manual unwrapping needed

**Recommendation**: **DISABLE** this calibration fix

---

## Calibration Fixes That Are STILL USEFUL

### ⚠️ Parameter Name Validation (Keep)

**What It Does**: Checks if parameter names exist in plugin schema

**Example Issue**: Workflow uses `file_url` but plugin only accepts `file_content`

**Why Still Needed**:
- Execution can't fix incorrect parameter names
- Schema-aware resolution only works if parameter names match
- This catches generation errors

**Recommendation**: **KEEP** this validation and auto-fix

**Current Status**: Already implemented in WorkflowValidator

---

### ⚠️ Nullable Field Handling (Keep)

**What It Does**: Detects when nullable fields (e.g., vendor_name) are used in required parameters

**Example Issue**:
```json
{
  "folder_name": "{{extracted_fields.vendor}}"  // vendor might be null
}
```

**Why Still Needed**:
- Execution can't invent values for null fields
- Need to either provide defaults or make conditional
- This catches data flow issues

**Recommendation**: **KEEP** this validation and suggest fixes (sanitize steps, defaults, conditionals)

**Current Status**: Shadow Agent detects this, calibration suggests fixes

---

### ⚠️ Missing Required Parameters (Keep)

**What It Does**: Checks if all required parameters are provided

**Example Issue**: Plugin requires `spreadsheet_id` but workflow doesn't provide it

**Why Still Needed**:
- Execution can't invent missing required parameters
- This catches generation omissions

**Recommendation**: **KEEP** this validation

**Current Status**: Already implemented

---

### ⚠️ Schema Validation (Keep)

**What It Does**: Validates workflow structure against IR schema

**Why Still Needed**:
- Catches structural issues (missing fields, wrong types in workflow definition itself)
- Execution assumes workflow structure is valid

**Recommendation**: **KEEP** schema validation

---

## Calibration Fixes That MIGHT Be Redundant

### 🤔 MIME Type Co-Extraction (Depends)

**What It Does**: Detects when attachment.data is extracted but MIME type is needed

**Example**:
```json
{
  "file_content": "{{attachment.data}}"
  // Missing: mime_type from attachment.mimeType
}
```

**Analysis**:
- If plugin parameter schema has `x-input-mapping` for file objects, execution can handle it
- If not, calibration needs to suggest adding mime_type parameter

**Recommendation**: **KEEP** for now, but enhance plugin schemas with x-input-mapping

---

### 🤔 Output Variable Naming (Depends)

**What It Does**: Checks output_variable names are unique and descriptive

**Why Might Be Redundant**:
- Execution doesn't care about variable names, just references
- This is more of a code quality issue

**Recommendation**: **KEEP** as warning (not error), helps with debugging

---

## Updated Calibration Strategy

### Phase 1: Pre-Execution Validation (Keep)
**Purpose**: Catch generation errors that execution can't fix

**Checks**:
1. ✅ Parameter name validation (exists in plugin schema)
2. ✅ Required parameter validation (all required params provided)
3. ✅ Nullable field handling (warn about potential null values)
4. ✅ Schema structure validation (workflow JSON is valid)
5. ✅ MIME type co-extraction (if x-input-mapping not available)

**Action**: Log issues, suggest fixes, but DON'T auto-rewrite variable references

---

### Phase 2: Execution (Let It Handle Data Flow)
**Purpose**: Execute workflow with schema-aware resolution

**Handles**:
1. ✅ Field extraction (`{{drive_file}}` → auto-extract `file_id`)
2. ✅ Type conversion (object → scalar based on schemas)
3. ✅ Flatten field paths (runtime correction)
4. ✅ AI context scoping (only pass specified params)

**Action**: Use schemas to resolve correctly, provide clear errors if can't

---

### Phase 3: Post-Execution Calibration (Keep for Real Issues)
**Purpose**: Detect execution failures and suggest fixes

**Checks**:
1. ✅ Step failures (plugin errors, API errors)
2. ✅ Unexpected results (filter returned 0 items from N)
3. ✅ Data quality issues (null values, missing fields)

**Action**: Collect real execution issues, suggest workflow improvements

---

## Files to Update

### Disable Redundant Calibration Fixes:

**`/app/api/v2/calibrate/apply-fixes/route.ts`**:
- Remove or comment out field extraction auto-fixes (lines handling `{{var}}` → `{{var.field}}`)
- Remove or comment out parameter unwrapping auto-fixes
- Keep parameter name validation
- Keep nullable field warnings

**`/lib/pilot/WorkflowValidator.ts`**:
- Keep `validateFieldReferences()` but change to warning (not error)
- Keep `validateFlattenFields()` but don't auto-fix (execution handles it)
- Keep `validateParameterNames()` - execution can't fix this
- Keep `validateNullableFields()` - execution can't fix this

**`/lib/pilot/shadow/RepairEngine.ts`**:
- Keep repairs for actual execution errors
- Remove repairs that try to fix variable references
- Keep repairs for missing parameters
- Keep repairs for null value handling

---

## Migration Plan

### Step 1: Mark Redundant Fixes as "Execution-Handled"
```typescript
// In apply-fixes/route.ts
if (fix.type === 'fix_field_extraction') {
  // ✅ NOW HANDLED BY EXECUTION - Skip this fix
  logger.info({
    fix: fix.type,
    step: fix.stepId
  }, 'Skipping fix - execution handles field extraction via schema-aware resolution');
  continue;
}
```

### Step 2: Update Validation to Warn Only
```typescript
// In WorkflowValidator.ts
validateFieldReferences() {
  // Change severity from ERROR to WARNING
  issues.push({
    severity: 'warning',  // was: 'error'
    message: 'Consider using {{var.field}} for clarity, but execution will handle automatically'
  });
}
```

### Step 3: Test Without Calibration
1. Run workflow WITHOUT applying calibration fixes
2. Let execution handle data flow with schema-aware resolution
3. Verify steps complete successfully

### Step 4: Keep Only Essential Calibration
- Parameter name validation (catch generation typos)
- Required parameter checks (catch generation omissions)
- Nullable field warnings (catch potential runtime nulls)
- Real execution errors (actual API failures)

---

## Expected Outcomes

**Before (Heavy Calibration)**:
- 50+ calibration iterations per workflow
- Fixing field extraction, parameter unwrapping, type conversions
- Many auto-fixes that execution should handle

**After (Light Calibration)**:
- 5-10 calibration checks per workflow
- Only catching generation errors (wrong param names, missing required fields)
- Execution handles all data flow automatically

**Benefits**:
✅ Faster workflow execution (no calibration delay)
✅ Simpler calibration logic (fewer fix types)
✅ Clearer separation (calibration = catch gen errors, execution = handle data flow)
✅ More robust (execution uses schemas, not heuristics)

---

## Recommended Next Steps

1. **Test Current Workflow**: Run Invoice Extraction without applying calibration fixes
2. **Verify Execution Handles It**: Check that schema-aware resolution works
3. **Update Calibration Code**: Disable redundant fix types
4. **Document New Flow**: Update calibration docs to explain new execution capabilities

---

**Status**: ✅ **Analysis Complete**
**Recommendation**: **Disable field extraction and unwrapping auto-fixes**, keep parameter validation
**Priority**: P1 - Simplifies calibration, relies on execution
