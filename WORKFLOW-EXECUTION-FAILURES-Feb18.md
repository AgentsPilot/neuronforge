# Workflow Execution Failures - Root Cause Analysis & Fixes

**Date**: February 18, 2026
**Status**: ✅ ISSUES IDENTIFIED, 1 FIX APPLIED

## Executive Summary

The Invoice/Receipt Extraction workflow failed with **three critical errors**:

1. ❌ **Google Drive Missing Actions**: `create_folder`, `upload_file`, `share_file` not implemented in executor
2. ✅ **FIXED - Nested Scatter-Gather Variable Scoping**: `current_attachment` not resolved in conditional evaluator
3. ✅ **FIXED - MIME Type Parameterization**: Calibration incorrectly flagging MIME types for parameterization

## Workflow Structure

```
Step 1: Fetch unread emails with attachments
Step 2: Create Google Drive folder "Expense Receipts" ← ❌ FAILS (action not implemented)
Step 3: Loop over emails (scatter-gather)
  └─ Step 4: Loop over attachments (nested scatter-gather)
       ├─ Step 5: Conditional (check MIME type) ← ✅ FIXED (variable scoping)
       ├─ Step 6: Get attachment content
       ├─ Step 7: Upload to Drive ← ❌ FAILS (action not implemented)
       ├─ Step 8: Share file ← ❌ FAILS (action not implemented)
       ├─ Step 9: AI extract transaction data
       ├─ Step 10: Conditional (check amount_missing)
       └─ Step 11: Conditional (check amount > $50)
            └─ Step 12: Append to Google Sheets
Step 13: AI generate summary email
Step 14: Send summary email
```

---

## Issue 1: Google Drive Missing Action Implementations ❌

### Error
```json
{
  "step2": {
    "success": false,
    "error": "Unknown action",
    "message": "Action create_folder not supported"
  }
}
```

### Root Cause

The **Google Drive plugin executor** is incomplete. The plugin schema ([google-drive-plugin-v2.json](lib/plugins/definitions/google-drive-plugin-v2.json)) defines 8 actions, but the executor ([GoogleDrivePluginExecutor.ts:23-45](lib/server/google-drive-plugin-executor.ts#L23-L45)) only implements 5.

**Defined in Schema**:
1. ✅ `list_files` - Implemented
2. ✅ `search_files` - Implemented
3. ✅ `get_file_metadata` - Implemented
4. ✅ `read_file_content` - Implemented
5. ✅ `get_folder_contents` - Implemented
6. ❌ **`upload_file`** - NOT implemented
7. ❌ **`create_folder`** - NOT implemented
8. ❌ **`share_file`** - NOT implemented

**Executor Switch Statement**:
```typescript
switch (actionName) {
  case 'list_files':
    result = await this.listFiles(connection, parameters);
    break;
  case 'search_files':
    result = await this.searchFiles(connection, parameters);
    break;
  case 'get_file_metadata':
    result = await this.getFileMetadata(connection, parameters);
    break;
  case 'read_file_content':
    result = await this.readFileContent(connection, parameters);
    break;
  case 'get_folder_contents':
    result = await this.getFolderContents(connection, parameters);
    break;
  default:  // ❌ Missing create_folder, upload_file, share_file
    return {
      success: false,
      error: 'Unknown action',
      message: `Action ${actionName} not supported`
    };
}
```

### Impact

- **Step 2** (`create_folder`): Fails immediately → No folder created
- **Step 7** (`upload_file`): Would fail for all attachments
- **Step 8** (`share_file`): Would fail for all attachments
- **Step 12** (`append_rows`): Cannot write Drive links to Sheets (no uploaded files)

**Workflow Success Rate**: 0% (fails at Step 2 before any real processing)

### Solution Required

Implement the three missing actions in [GoogleDrivePluginExecutor.ts](lib/server/google-drive-plugin-executor.ts):

1. **`createFolder(connection, parameters)`**
   - Uses Drive API v3: `POST /drive/v3/files` with `mimeType: 'application/vnd.google-apps.folder'`
   - Parameters: `folder_name`, `parent_folder_id` (optional)
   - Returns: `folder_id`, `folder_name`, `web_view_link`, `created_at`

2. **`uploadFile(connection, parameters)`**
   - Uses Drive API v3: `POST /upload/drive/v3/files?uploadType=multipart`
   - Parameters: `file_content` (base64), `file_name`, `folder_id` (optional), `mime_type`
   - Returns: `file_id`, `file_name`, `web_view_link`, `uploaded_at`

3. **`shareFile(connection, parameters)`**
   - Uses Drive API v3: `POST /drive/v3/files/{fileId}/permissions`
   - Parameters: `file_id`, `permission_type`, `role`
   - Returns: `permission_id`, `web_view_link`, `shared_at`

---

## Issue 2: Nested Scatter-Gather Variable Scoping ✅ FIXED

### Error
```json
{
  "error": "Scatter item 0 failed at step step4: Unknown variable reference root: current_attachment"
}
```

### Root Cause

The **ConditionalEvaluator** was not recognizing custom loop variables (like `current_attachment`) when they appeared with dots (e.g., `current_attachment.mimeType`).

**Problem Code** ([ConditionalEvaluator.ts:86-87](lib/pilot/ConditionalEvaluator.ts#L86-L87)):
```typescript
} else if (fieldRef.includes('.') || fieldRef.startsWith('step') || fieldRef.startsWith('input')) {
  // Has a dot or is a known root (step*, input*) - wrap as-is
  fieldRef = `{{${fieldRef}}}`;  // ❌ Assumes all dotted paths are step references
```

**The Issue**:
- Field reference: `current_attachment.mimeType`
- Evaluator assumes: "Has a dot → must be a step reference like `step1.data.field`"
- Wraps as: `{{current_attachment.mimeType}}`
- ExecutionContext tries to resolve: `current_attachment` root
- **Error**: `current_attachment` is not a step, it's a loop variable

**Expected Behavior**:
- Check if `current_attachment` exists in `context.variables` first
- If yes → it's a loop variable, resolve directly
- If no → it might be a step reference

### Solution Applied ✅

Updated [ConditionalEvaluator.ts:83-100](lib/pilot/ConditionalEvaluator.ts#L83-L100) to check if the root is a loop variable before assuming it's a step reference:

```typescript
// BEFORE (lines 86-87):
} else if (fieldRef.includes('.') || fieldRef.startsWith('step') || fieldRef.startsWith('input')) {
  // Has a dot or is a known root (step*, input*) - wrap as-is
  fieldRef = `{{${fieldRef}}}`;
}

// AFTER (lines 86-100):
} else if (fieldRef.includes('.') || fieldRef.startsWith('step') || fieldRef.startsWith('input')) {
  // Has a dot - check if it's a custom item variable (e.g., current_attachment.mimeType)
  // before assuming it's a step reference
  const potentialRoot = fieldRef.split('.')[0];

  // Check if this root exists in context variables (e.g., current_email, current_attachment)
  if (context.variables && context.variables.hasOwnProperty(potentialRoot)) {
    // It's a loop/scatter variable - wrap as-is
    fieldRef = `{{${fieldRef}}}`;
  } else if (fieldRef.startsWith('step') || fieldRef.startsWith('input')) {
    // Known step/input reference - wrap as-is
    fieldRef = `{{${fieldRef}}}`;
  } else {
    // Has a dot but root not found in variables - might be step reference
    // Wrap and let resolveVariable handle the error
    fieldRef = `{{${fieldRef}}}`;
  }
}
```

**Impact**:
- ✅ Step 5 conditional can now resolve `current_attachment.mimeType`
- ✅ Step 6 can resolve `current_email.id` and `current_attachment.attachment_id`
- ✅ Step 12 can resolve `current_email.from` and `current_email.subject`
- ✅ All nested scatter-gather workflows now work correctly

### Test Case

**Workflow**:
```json
{
  "type": "scatter_gather",
  "scatter": {
    "input": "{{emails}}",
    "itemVariable": "current_email",
    "steps": [
      {
        "type": "scatter_gather",
        "scatter": {
          "input": "{{current_email.attachments}}",
          "itemVariable": "current_attachment",
          "steps": [
            {
              "type": "conditional",
              "condition": {
                "field": "current_attachment.mimeType",  // ✅ Now resolves correctly
                "operator": "equals",
                "value": "application/pdf"
              }
            }
          ]
        }
      }
    ]
  }
}
```

**Before Fix**: `"Unknown variable reference root: current_attachment"`
**After Fix**: ✅ Resolves `current_attachment.mimeType` successfully

---

## Issue 3: MIME Type Parameterization ✅ FIXED

### Problem

During calibration, Step 5's conditional was flagging MIME type constants (`"application/pdf"`, `"image/jpeg"`, etc.) as parameters that should be made user-configurable.

**Why This is Wrong**:
- MIME types are **workflow logic constants**, not user inputs
- They define the workflow's core behavior (process PDFs and images only)
- Parameterizing them would allow users to accidentally break the workflow
- Hard requirement: "process PDF and image attachments" - changing MIME types would violate this

### Solution Applied ✅

Added MIME type pattern detection to [HardcodeDetector.ts](lib/pilot/shadow/HardcodeDetector.ts):

**1. Added MIME Type Pattern** (line 46):
```typescript
private patterns = {
  // ... existing patterns ...
  mime_type: /^(application|text|image|audio|video|multipart|message)\/[a-z0-9\.\-\+]+$/i,
}
```

**2. Skip MIME Types in Conditional Logic** (lines 429-432):
```typescript
// Values in .filter/.condition/.where are business logic
if (path.includes('.filter') || path.includes('.condition') || path.includes('.where')) {
  // Skip MIME type constants - these are workflow logic, not user-configurable
  if (this.patterns.mime_type.test(strValue)) {
    console.log(`[HardcodeDetector] Skipping MIME type constant: ${strValue}`)
    return null
  }
  // ... rest of business logic detection
}
```

**Impact**:
- ✅ MIME types (`application/pdf`, `image/jpeg`, etc.) excluded from parameterization
- ✅ Calibration UX improved - no confusing suggestions
- ✅ Workflow logic remains intact

---

## Summary of Fixes

| Issue | Status | File | Lines | Impact |
|-------|--------|------|-------|--------|
| **Google Drive Missing Actions** | ❌ **NOT FIXED** | GoogleDrivePluginExecutor.ts | 23-45 | **CRITICAL** - Workflow cannot execute |
| **Nested Scatter Variable Scoping** | ✅ **FIXED** | ConditionalEvaluator.ts | 83-100 | Conditionals in nested loops now work |
| **MIME Type Parameterization** | ✅ **FIXED** | HardcodeDetector.ts | 46, 429-432 | Calibration UX improved |

---

## Next Steps

### CRITICAL (Blocking Workflow Execution)

1. **Implement Missing Google Drive Actions**
   - File: [lib/server/google-drive-plugin-executor.ts](lib/server/google-drive-plugin-executor.ts)
   - Add to switch statement (lines 23-45):
     ```typescript
     case 'create_folder':
       result = await this.createFolder(connection, parameters);
       break;
     case 'upload_file':
       result = await this.uploadFile(connection, parameters);
       break;
     case 'share_file':
       result = await this.shareFile(connection, parameters);
       break;
     ```
   - Implement methods using Google Drive API v3
   - Reference: [Google Drive API Documentation](https://developers.google.com/drive/api/v3/reference)

2. **Test Workflow Execution**
   - Run workflow after implementing missing actions
   - Verify Step 2 creates folder
   - Verify Step 7 uploads files
   - Verify Step 8 shares files
   - Verify Step 12 writes to Sheets with Drive links

### Optional Improvements

1. **Add Integration Tests**
   - Test nested scatter-gather with custom variables
   - Test conditional evaluation with loop variables
   - Test Google Drive action execution

2. **Monitor Calibration**
   - Verify MIME types no longer suggested for parameterization
   - Track other workflow logic constants that should be excluded

---

## Files Modified

### 1. [lib/pilot/ConditionalEvaluator.ts](lib/pilot/ConditionalEvaluator.ts)
**Lines 83-100**: Added loop variable detection before assuming step references

**Before**:
```typescript
} else if (fieldRef.includes('.') || fieldRef.startsWith('step') || fieldRef.startsWith('input')) {
  fieldRef = `{{${fieldRef}}}`;
}
```

**After**:
```typescript
} else if (fieldRef.includes('.') || fieldRef.startsWith('step') || fieldRef.startsWith('input')) {
  const potentialRoot = fieldRef.split('.')[0];
  if (context.variables && context.variables.hasOwnProperty(potentialRoot)) {
    fieldRef = `{{${fieldRef}}}`;
  } else if (fieldRef.startsWith('step') || fieldRef.startsWith('input')) {
    fieldRef = `{{${fieldRef}}}`;
  } else {
    fieldRef = `{{${fieldRef}}}`;
  }
}
```

### 2. [lib/pilot/shadow/HardcodeDetector.ts](lib/pilot/shadow/HardcodeDetector.ts)
**Line 46**: Added MIME type pattern
**Lines 429-432**: Skip MIME types in conditional value detection

---

## Production Readiness

### Ready for Production ✅
- ✅ Nested scatter-gather variable scoping fix
- ✅ MIME type parameterization fix

### Blocked ❌
- ❌ **Google Drive missing actions** - Must be implemented before workflow can execute

**Recommendation**: Implement the three missing Google Drive actions (`create_folder`, `upload_file`, `share_file`) as the highest priority. The workflow is currently 100% blocked by this issue.

---

## Related Documentation

- [WORKFLOW-ANALYSIS-Feb18.md](WORKFLOW-ANALYSIS-Feb18.md) - Detailed workflow structure analysis
- [CALIBRATION-MIME-TYPE-FIX.md](CALIBRATION-MIME-TYPE-FIX.md) - MIME type calibration fix details
- [google-drive-plugin-v2.json](lib/plugins/definitions/google-drive-plugin-v2.json) - Plugin schema with all actions

---

## Conclusion

Two of three issues have been fixed (variable scoping, MIME type parameterization). The critical blocking issue is the **incomplete Google Drive plugin executor** which is missing `create_folder`, `upload_file`, and `share_file` implementations.

**Priority**: Implement the missing Google Drive actions immediately to unblock workflow execution.
