# Parameter Auto-Unwrapping Fix - COMPLETE ✅

## Problem

The Invoice Extraction workflow's step9 (Google Drive `share_file` action) was failing with:

```
Error 404 (Not Found)
/drive/v3/files/%7B%20%20%22file_id%22:%20%221xw3POvVsrzsL6zqSGrcZI-3kGc2f0n-O%22...%7D/permissions
```

### Root Cause

1. **Step 8 (upload_file)** returns an object:
   ```json
   {
     "file_id": "123",
     "file_name": "invoice.pdf",
     "file_size": "100 KB",
     ...
   }
   ```

2. **Step 9 config** has:
   ```json
   {
     "file_id": "{{drive_file}}"
   }
   ```

3. **Variable Resolver** resolves `{{drive_file}}` and **stringifies the entire object to JSON**

4. **Plugin receives**: A JSON string instead of just the file ID

5. **Google Drive API** receives the entire JSON object in the URL → 404 error

## Solution Implemented

**Added automatic parameter unwrapping in BasePluginExecutor** that handles both objects AND JSON strings.

### Files Modified

#### `/lib/server/base-plugin-executor.ts` (lines 207-249)

Added `unwrapParameter()` method that:

1. **Checks if value is a JSON string** (starts with `{`)
2. **Parses the JSON string** to an object
3. **Extracts the field matching the parameter name** (e.g., `file_id` from object)
4. **Returns the scalar value** instead of the object/string

```typescript
protected unwrapParameter(value: any, paramName: string): any {
  // ✅ FIX: Handle JSON strings (variable resolver stringifies objects)
  // If value is a string that looks like JSON, try to parse it first
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(value);
      // Now check if the parsed object has the parameter field
      if (typeof parsed === 'object' && parsed !== null && paramName in parsed) {
        this.logger.info({
          paramName,
          objectKeys: Object.keys(parsed),
          unwrappedValue: typeof parsed[paramName] === 'string' ? parsed[paramName] : typeof parsed[paramName]
        }, 'Auto-unwrapped nested parameter from JSON string (workflow passed object instead of scalar)');

        return parsed[paramName];
      }
      // If parsed but no matching field, return original string
      return value;
    } catch (e) {
      // Not valid JSON, return as-is
      return value;
    }
  }

  // Only unwrap if value is an object (not null, not array)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }

  // Check if the object has a field matching the parameter name
  if (paramName in value) {
    this.logger.info({
      paramName,
      objectKeys: Object.keys(value),
      unwrappedValue: typeof value[paramName] === 'string' ? value[paramName] : typeof value[paramName]
    }, 'Auto-unwrapped nested parameter (workflow passed object instead of scalar)');

    return value[paramName];
  }

  // No unwrapping needed
  return value;
}
```

#### `/lib/server/google-drive-plugin-executor.ts`

Applied unwrapping to **9 locations**:

1. **shareFile** (line 730): `let fileId = this.unwrapParameter(parameters.file_id, 'file_id');`
2. **uploadFile** (line 629): `const folderId = this.unwrapParameter(parameters.folder_id, 'folder_id');`
3. **getFileMetadata** (line 204): `const fileId = this.unwrapParameter(parameters.file_id, 'file_id');`
4. **readFileContent** (line 265): `const fileId = this.unwrapParameter(parameters.file_id, 'file_id');`
5. **getFolderContents** (line 354): `const folderId = this.unwrapParameter(parameters.folder_id, 'folder_id');`
6. **createFolder** (line 445): `const parentFolderId = this.unwrapParameter(parameters.parent_folder_id, 'parent_folder_id');`
7. **getOrCreateFolder - search** (line 500): Same as above
8. **getOrCreateFolder - create** (line 555): Same as above
9. **buildListQuery** (line 844): Same as above

## Verification

### Logs Confirm Success ✅

```json
{
  "level":30,
  "module":"PluginExecutor",
  "plugin":"google-drive",
  "paramName":"file_id",
  "objectKeys":["file_id","file_name","file_size","mime_type","web_view_link","uploaded_at"],
  "unwrappedValue":"1wxt-pEPX144OW8xK5S8x_DU-L8fBfa9a",
  "msg":"Auto-unwrapped nested parameter from JSON string (workflow passed object instead of scalar)"
}
```

**Before**: `file_id` received entire JSON object → 404 error
**After**: `file_id` unwrapped to just `"1wxt-pEPX144OW8xK5S8x_DU-L8fBfa9a"` → Successfully calls Google Drive API

## Current Status

✅ **file_id unwrapping is working perfectly**
❌ **New error**: `"anyone_with_link is not a valid value"` for `permission_type` parameter

This is a **different issue** - the Google Drive API expects `"anyone"` but the workflow is passing `"anyone_with_link"`.

## Why This Solution Is Scalable

✅ **No workflow changes needed** - Existing workflows continue to work
✅ **Works for ALL plugins** - Any plugin can use `unwrapParameter()`
✅ **Works for ALL parameters** - Generic matching by parameter name
✅ **Handles both objects and JSON strings** - Covers all variable resolution cases
✅ **Backward compatible** - If parameter is already a scalar, it passes through unchanged
✅ **Self-documenting** - Logs show when unwrapping happens and what was unwrapped

## Next Steps

The `permission_type` error is unrelated to parameter unwrapping. It's a parameter **value** issue, not a **type** issue:

- Expected: `"anyone"` or `"user"` or `"group"` or `"domain"`
- Received: `"anyone_with_link"` (invalid value)

This needs to be fixed separately (either in the workflow config or in the Google Drive plugin executor to normalize the value).

## Impact

This fix will benefit:
- ✅ **Current workflow** (Invoice Extraction step9)
- ✅ **Any future workflow** that passes objects where scalars are expected
- ✅ **All plugins** (Gmail, Google Sheets, etc.) when they inherit from BasePluginExecutor
