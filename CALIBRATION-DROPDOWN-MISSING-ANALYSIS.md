# Calibration Dropdown Missing - Root Cause Analysis

**Date**: February 18, 2026
**Status**: ⚠️ INVESTIGATION COMPLETE - FIX NEEDED

## User Report

"When running calibration the hardcoded function suppose to parameterized all plugins if the user choose to do so. The issue for the google drive I didn't get the dropdown"

## Expected Behavior

When user chooses to parameterize a Google Drive plugin parameter (e.g., `folder_id` in `create_folder` action), the calibration UI should show a dynamic dropdown populated with available folders from Google Drive.

## System Architecture

### 1. Schema Metadata API (`/api/plugins/schema-metadata`)

**Purpose**: Provides mapping of parameter names → dynamic option configs

**Implementation**: [app/api/plugins/schema-metadata/route.ts](app/api/plugins/schema-metadata/route.ts)

**Process**:
1. Scans all plugin schemas
2. Finds parameters with `x-dynamic-options`
3. Returns metadata indexed by parameter name

**Example Output**:
```json
{
  "metadata": {
    "folder_id": [
      {
        "plugin": "google-drive",
        "action": "create_folder",
        "parameter": "folder_id",
        "source": "list_folders",
        "depends_on": []
      },
      {
        "plugin": "google-drive",
        "action": "upload_file",
        "parameter": "folder_id",
        "source": "list_folders"
      }
    ],
    "file_id": [
      {
        "plugin": "google-drive",
        "action": "get_file_metadata",
        "parameter": "file_id",
        "source": "list_files"
      }
    ]
  }
}
```

### 2. Plugin Schema (google-drive-plugin-v2.json)

**x-dynamic-options Definitions**:

✅ **folder_id** (in `create_folder`):
```json
{
  "parent_folder_id": {
    "type": "string",
    "description": "ID of the parent folder",
    "x-dynamic-options": {
      "source": "list_folders",
      "description": "Fetches available folders dynamically"
    }
  }
}
```

✅ **folder_id** (in `upload_file`):
```json
{
  "folder_id": {
    "type": "string",
    "description": "ID of the folder to upload to",
    "x-dynamic-options": {
      "source": "list_folders",
      "description": "Fetches available folders dynamically"
    }
  }
}
```

✅ **file_id** (in `share_file`):
```json
{
  "file_id": {
    "type": "string",
    "description": "ID of the file or folder to share",
    "x-dynamic-options": {
      "source": "list_files",
      "description": "Fetches available files dynamically"
    }
  }
}
```

### 3. Plugin Executor (GoogleDrivePluginExecutor.ts)

**Dynamic Option Methods**:

✅ **list_folders()** (lines 745-785):
```typescript
async list_folders(connection: any, options: { page?: number; limit?: number } = {}): Promise<Array<{value: string; label: string; description?: string; icon?: string; group?: string}>> {
  // Fetches folders from Drive API
  // Returns dropdown options
}
```

✅ **list_files()** (lines 790-840):
```typescript
async list_files(connection: any, options: { page?: number; limit?: number } = {}): Promise<Array<{value: string; label: string; description?: string; icon?: string; group?: string}>> {
  // Fetches files from Drive API
  // Returns dropdown options
}
```

### 4. Fetch Options API (`/api/plugins/fetch-options`)

**Purpose**: Fetches dynamic dropdown options for a specific parameter

**Implementation**: [app/api/plugins/fetch-options/route.ts](app/api/plugins/fetch-options/route.ts)

**Process**:
1. Receives `{ plugin, action, parameter }` from frontend
2. Gets user's plugin connection
3. Validates parameter has `x-dynamic-options`
4. Calls executor's fetch method (e.g., `list_folders`)
5. Returns options to frontend

### 5. Frontend Components

#### DynamicSelectField Component

[components/v2/DynamicSelectField.tsx](components/v2/DynamicSelectField.tsx)

**Purpose**: Dropdown that fetches options from `/api/plugins/fetch-options`

**Props**:
- `plugin`: Plugin name (e.g., "google-drive")
- `action`: Action name (e.g., "create_folder")
- `parameter`: Parameter name (e.g., "folder_id")

#### AgentInputFields Component

[components/v2/AgentInputFields.tsx](components/v2/AgentInputFields.tsx)

**Purpose**: Renders input fields based on schema

**Key Function**: `getDynamicOptions(fieldName)` prop

**Behavior**:
- If `getDynamicOptions` returns `{ plugin, action, parameter }` → Uses `DynamicSelectField`
- Otherwise → Uses regular input/select

#### Calibration Components

**CalibrationSetup.tsx**:
```typescript
const getDynamicOptions = (fieldName: string) => {
  if (!schemaMetadata) return null

  // First try exact match
  let matchingParams = schemaMetadata[fieldName]

  // If no match, try stripping prefixes
  if (!matchingParams) {
    const prefixes = [/^step\d+_/, 'source_', 'target_', 'input_', 'output_']
    for (const prefix of prefixes) {
      const baseFieldName = fieldName.replace(prefix, '')
      matchingParams = schemaMetadata[baseFieldName]
      if (matchingParams) break
    }
  }

  if (matchingParams && matchingParams.length > 0) {
    return matchingParams[0]  // Return first match
  }

  return null
}
```

**FixesApplied.tsx**: Similar implementation

## Root Cause Analysis

### Scenario: User Parameterizes `folder_id` in Step 2

**Step 2 DSL** (before calibration):
```json
{
  "id": "step2",
  "plugin": "google-drive",
  "action": "create_folder",
  "params": {
    "folder_name": "Expense Receipts"  // Hardcoded
  }
}
```

**After Calibration** (user parameterizes `folder_name`):
```json
{
  "id": "step2",
  "plugin": "google-drive",
  "action": "create_folder",
  "params": {
    "folder_name": "{{step2_folder_name}}"  // Now parameterized
  }
}
```

**Calibration Input Schema Generated**:
```json
{
  "name": "step2_folder_name",  // ✅ With step prefix
  "type": "string",
  "required": true
}
```

### Problem Flow

1. **User chooses to parameterize** `folder_name` in Step 2
2. **Calibration creates input field**: `step2_folder_name`
3. **getDynamicOptions() called**: `getDynamicOptions("step2_folder_name")`
4. **Lookup in schemaMetadata**:
   - Exact match: `schemaMetadata["step2_folder_name"]` → ❌ NOT FOUND
   - Strip `step\d+_` prefix: `schemaMetadata["folder_name"]` → ❌ NOT FOUND (schema has `folder_id`, not `folder_name`)
5. **Returns null** → Regular text input used instead of dropdown

### Why It Fails for Google Drive

**The Issue**: Google Drive `create_folder` action has `folder_name` parameter but it does NOT have `x-dynamic-options`.

Looking at the schema:
```json
{
  "create_folder": {
    "parameters": {
      "properties": {
        "folder_name": {
          "type": "string",
          "description": "Name for the new folder"
          // ❌ NO x-dynamic-options - it's a free-text input
        },
        "parent_folder_id": {
          "type": "string",
          "description": "ID of the parent folder",
          "x-dynamic-options": {
            "source": "list_folders"  // ✅ HAS x-dynamic-options
          }
        }
      }
    }
  }
}
```

**Conclusion**: `folder_name` is NOT supposed to have a dropdown! It's a free-text input where the user types the folder name.

## Actual Problem: Misunderstanding vs Bug

###  Clarification Needed

**User's Expectation**: "All plugins should be parameterized" with dropdowns

**Reality**: Only parameters with `x-dynamic-options` get dropdowns. Others are text inputs.

### Which Parameters SHOULD Have Dropdowns in Google Drive?

✅ **Should have dropdowns**:
- `folder_id` (parent_folder_id in create_folder)
- `folder_id` (in upload_file, get_folder_contents)
- `file_id` (in get_file_metadata, read_file_content, share_file)

❌ **Should NOT have dropdowns** (free text):
- `folder_name` (create_folder)
- `file_name` (upload_file)
- `file_content` (upload_file)
- `query` (search_files)

## Testing: Verify Dropdowns Work

### Test Case 1: upload_file with folder_id

**Workflow DSL**:
```json
{
  "id": "step7",
  "plugin": "google-drive",
  "action": "upload_file",
  "params": {
    "file_content": "{{step6.data}}",
    "file_name": "{{current_attachment.filename}}",
    "folder_id": "{{step2.data.folder_id}}"  // Hardcoded folder_id
  }
}
```

**Calibration Scenario**: User wants to parameterize `folder_id` to make it user-selectable

**Expected**:
1. User selects `folder_id` for parameterization
2. Calibration creates input field: `step7_folder_id`
3. `getDynamicOptions("step7_folder_id")` is called
4. Strips `step7_` → looks up `folder_id` in schemaMetadata
5. Finds match:
   ```json
   {
     "plugin": "google-drive",
     "action": "upload_file",
     "parameter": "folder_id",
     "source": "list_folders"
   }
   ```
6. Renders `DynamicSelectField` with plugin="google-drive", action="upload_file", parameter="folder_id"
7. `DynamicSelectField` calls `/api/plugins/fetch-options`
8. API calls `GoogleDrivePluginExecutor.list_folders()`
9. Returns dropdown options with available folders

### Test Case 2: share_file with file_id

**Similar flow for `file_id`** → Should show dropdown with available files

## Diagnostic Steps

### 1. Check Console Logs

**Expected logs** (if working correctly):
```
[CalibrationSetup] getDynamicOptions called for field: step7_folder_id
[CalibrationSetup] schemaMetadata available: true
[CalibrationSetup] schemaMetadata keys: ["folder_id", "file_id", "spreadsheet_id", ...]
[CalibrationSetup] Exact match failed, trying with stripped prefix
[CalibrationSetup] Stripped field name: folder_id
[CalibrationSetup] Found match: { plugin: "google-drive", action: "upload_file", parameter: "folder_id", source: "list_folders" }
```

**If NOT working**:
```
[CalibrationSetup] getDynamicOptions called for field: step7_folder_name
[CalibrationSetup] schemaMetadata available: true
[CalibrationSetup] Exact match failed, trying with stripped prefix
[CalibrationSetup] Stripped field name: folder_name
[CalibrationSetup] No match found for: folder_name
[CalibrationSetup] Returning null
```

### 2. Verify schemaMetadata Loading

**Check in browser console**:
```javascript
// After page loads
fetch('/api/plugins/schema-metadata')
  .then(r => r.json())
  .then(data => console.log('Schema metadata:', data.metadata))
```

**Expected**:
```json
{
  "folder_id": [
    { "plugin": "google-drive", "action": "create_folder", "parameter": "parent_folder_id", "source": "list_folders" },
    { "plugin": "google-drive", "action": "upload_file", "parameter": "folder_id", "source": "list_folders" }
  ],
  "file_id": [
    { "plugin": "google-drive", "action": "share_file", "parameter": "file_id", "source": "list_files" }
  ]
}
```

### 3. Check Google Drive Connection

**Prerequisite**: User must have an active Google Drive connection

**Verify**:
```javascript
fetch('/api/plugins/user-status?plugin=google-drive')
  .then(r => r.json())
  .then(data => console.log('Connection status:', data))
```

**Expected**:
```json
{
  "connected": true,
  "username": "user@example.com"
}
```

## Potential Issues & Fixes

### Issue 1: User Parameterizing Wrong Fields

**Problem**: User is trying to parameterize `folder_name` (which shouldn't have a dropdown)

**Fix**: Educate user that:
- `folder_name`: Free text input (e.g., "Expense Receipts")
- `folder_id`/`parent_folder_id`: Dropdown with existing folders

### Issue 2: schemaMetadata Not Loading

**Problem**: `/api/plugins/schema-metadata` failing or not being called

**Fix**:
1. Check browser network tab for `/api/plugins/schema-metadata` request
2. Verify response contains `folder_id` and `file_id` entries
3. Check for JavaScript errors in console

### Issue 3: Connection Not Found

**Problem**: User not connected to Google Drive

**Fix**:
1. User must connect Google Drive plugin first
2. Go to Settings → Integrations → Connect Google Drive
3. Complete OAuth flow
4. Return to calibration

### Issue 4: Parameter Name Mismatch

**Problem**: Calibration generates `step2_parent_folder_id` but schemaMetadata has `folder_id`

**Current Logic** (CalibrationSetup.tsx lines 146-180):
```typescript
const getDynamicOptions = (fieldName: string) => {
  if (!schemaMetadata) return null

  // Try exact match
  let matchingParams = schemaMetadata[fieldName]

  // Try stripping prefixes
  if (!matchingParams) {
    const prefixes = [/^step\d+_/, 'source_', 'target_', ...]
    for (const prefix of prefixes) {
      const baseFieldName = fieldName.replace(prefix, '')
      matchingParams = schemaMetadata[baseFieldName]
      if (matchingParams) break
    }
  }

  return matchingParams?.[0] || null
}
```

**Issue**: `parent_folder_id` ≠ `folder_id` in schemaMetadata

**Fix Needed**: Update schema-metadata API to index BOTH `folder_id` AND `parent_folder_id` for the same dynamic options config:

```typescript
// In schema-metadata/route.ts
for (const [paramName, paramSchema] of Object.entries(actionDef.parameters.properties)) {
  const dynamicOptions = (paramSchema as any)['x-dynamic-options'];

  if (dynamicOptions && dynamicOptions.source) {
    // Index by exact parameter name
    if (!metadata[paramName]) {
      metadata[paramName] = [];
    }
    metadata[paramName].push({ plugin, action, parameter: paramName, source: dynamicOptions.source });

    // ✅ ALSO index by base name if different (e.g., "folder_id" for "parent_folder_id")
    const baseName = paramName.replace(/^(parent_|target_|source_)/, '');
    if (baseName !== paramName) {
      if (!metadata[baseName]) {
        metadata[baseName] = [];
      }
      metadata[baseName].push({ plugin, action, parameter: paramName, source: dynamicOptions.source });
    }
  }
}
```

## Recommendation

1. **Ask user for specific example**: Which exact parameter are they trying to parameterize?
   - If `folder_name` → Explain it's a text input, not dropdown
   - If `folder_id`/`parent_folder_id` → Debug further

2. **Check console logs**: Have user open browser console during calibration and look for `[CalibrationSetup] getDynamicOptions` logs

3. **Verify connection**: Ensure Google Drive is connected in Settings → Integrations

4. **Test fetch-options directly**:
   ```bash
   curl -X POST http://localhost:3000/api/plugins/fetch-options \
     -H "Content-Type: application/json" \
     -d '{
       "plugin": "google-drive",
       "action": "upload_file",
       "parameter": "folder_id"
     }'
   ```

5. **If schema-metadata doesn't have `parent_folder_id`**: Implement the base name indexing fix above

## Summary

**Architecture**: ✅ All components correctly implemented
**Google Drive Schema**: ✅ Has `x-dynamic-options` for `folder_id` and `file_id`
**Executor Methods**: ✅ `list_folders()` and `list_files()` implemented
**Frontend Logic**: ✅ `getDynamicOptions()` strips prefixes correctly

**Most Likely Issue**: User is trying to parameterize a field that shouldn't have a dropdown (like `folder_name`)

**Possible Bug**: `parent_folder_id` might not be indexed in schemaMetadata (only `folder_id` is)

**Next Step**: Get specific parameter name from user and check browser console logs
