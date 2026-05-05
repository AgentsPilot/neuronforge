# Calibration Errors Analysis - April 24, 2026

## Critical Errors Found

### ❌ Error 1: Step 9 - Invalid `file_id` Parameter
**Location:** Step 9 (share_file action)
**Error Message:** `Resource not found. The requested URL /drive/v3/files/%7B%20%20%22file_id%22...`

**Root Cause:**
The workflow is passing the **entire `drive_file` object** instead of extracting the `file_id` field.

**Current (WRONG):**
```json
{
  "params": {
    "file_id": "{{drive_file}}"  // Passes entire object
  }
}
```

**What's being sent to Google Drive API:**
```
/drive/v3/files/{ "file_id": "11CFWHNCpOITDxY8euATf8m_smDZTae7b", "file_name": "Invoice677931.pdf", "file_size": "0 B", ... }/permissions
```

**Should be (CORRECT):**
```json
{
  "params": {
    "file_id": "{{drive_file.file_id}}"  // Extract just the ID string
  }
}
```

**Impact:** High - Prevents file sharing from working

---

### ❌ Error 2: Step 16 - Missing Variable `digest_content`
**Location:** Step 16 (send_email action)
**Error Message:** `Unknown variable reference root: digest_content`

**Root Cause:**
Step 15 (ai_processing) generates the email digest content but doesn't have an `output_variable` declared, so the result isn't stored in the execution context.

**Current step 15:**
```json
{
  "id": "step15",
  "type": "ai_processing",
  "input": "{{processed_items}}",
  "prompt": "Create an HTML email digest...",
  "output_variable": "digest_content"  // This is declared...
}
```

**Problem:** The `output_variable` exists in the schema, but the execution engine isn't storing it properly, OR step 15 is failing silently.

**Impact:** High - Prevents digest email from being sent

---

## Secondary Issues (From Earlier Analysis)

### ⚠️ Issue 3: Step 14 - Missing `values` Parameter
**Location:** Step 14 (append_rows)
**Detected by:** StructuralRepairEngine
**Message:** `Detected missing required parameters: values`

**Current:**
```json
{
  "params": {
    "fields": {
      "Date": "high_value_items.date",
      "Type": "high_value_items.type",
      ...
    }
  }
}
```

**Problem:** The `append_rows` action expects a `values` parameter (2D array), but the workflow is using a `fields` parameter (object mapping).

---

## Fix Priority

### Immediate (Blocking calibration):
1. ✅ **FIXED**: Base64url conversion in Gmail plugin
2. ❌ **TODO**: Step 9 - Extract `file_id` from `drive_file` object
3. ❌ **TODO**: Step 16 - Ensure `digest_content` variable is properly stored
4. ❌ **TODO**: Step 14 - Fix `values` parameter mapping

### Medium (Data quality):
5. Email metadata preservation in step 2/2a transform
6. Step 12 dependency chain

---

## Recommended Fixes

### Fix 1: Step 9 Parameter Extraction
**Where to fix:** Variable resolution in StepExecutor or parameter mapping in IR compiler

**Option A (Runtime):** Detect when a parameter expects a string but receives an object, auto-extract the ID field

**Option B (Compile-time):** When mapping variables to parameters, check if the target parameter type is `string` and source is `object`, auto-add field accessor

### Fix 2: Step 15 Output Variable
**Where to fix:** ai_processing step executor to ensure output_variable is stored

**Check:**
1. Does step 15 execute successfully?
2. Is the AI response being stored?
3. Is the variable name being registered in ExecutionContext?

### Fix 3: Step 14 Values Parameter
**Where to fix:** append_rows action handler or parameter transformer

**Solution:** Convert `fields` object to `values` 2D array format expected by Google Sheets API

---

## Log Evidence

**Step 9 Error (URL shows escaped JSON):**
```
The requested URL /drive/v3/files/%7B%20%20%22file_id%22:%20%2211CFWHNCpOITDxY8euATf8m_smDZTae7b%22,...%7D/permissions
```

**Step 16 Error:**
```json
{
  "level": 50,
  "module": "StepExecutor",
  "err": {
    "type": "VariableResolutionError",
    "message": "Unknown variable reference root: digest_content",
    "code": "VARIABLE_RESOLUTION_ERROR",
    "details": {"variable": "digest_content.subject"}
  },
  "stepId": "step16"
}
```

**Step 14 Missing Parameter:**
```json
{
  "level": 30,
  "module": "StructuralRepairEngine",
  "stepId": "step14",
  "plugin": "google-sheets",
  "action": "append_rows",
  "missingParams": [{"name": "values", "hasSmartDefault": false}]
}
```
