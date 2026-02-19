# Dropdown Verification Test

**Date**: February 18, 2026

## Current Workflow Analysis

### Step 2 - create_folder
```json
{
  "action": "create_folder",
  "params": {
    "folder_name": "{{input.step2_folder_name}}"  // ❌ TEXT INPUT (correct - no dropdown)
  }
}
```

**Expected Behavior**: Text input (type folder name like "Expense Receipts")
**Schema**: Does NOT have `x-dynamic-options` - this is correct
**Issue**: User expects dropdown, but `folder_name` is for CREATING a new folder, not selecting existing

### Step 7 - upload_file
```json
{
  "action": "upload_file",
  "params": {
    "folder_id": "{{drive_folder.folder_id}}"  // ❌ NOT PARAMETERIZED
  }
}
```

**Current Behavior**: Uses folder created in step2 (hardcoded workflow logic)
**To Get Dropdown**: Would need to parameterize this as `{{input.step7_folder_id}}`

## Test Case: Force Parameterization of folder_id

### Scenario 1: Parameterize folder_id in Step 7

**Modified Step 7**:
```json
{
  "action": "upload_file",
  "params": {
    "folder_id": "{{input.step7_folder_id}}"  // ✅ PARAMETERIZED
  }
}
```

**Input Schema Generated**:
```json
{
  "name": "step7_folder_id",
  "type": "string",
  "required": true
}
```

**getDynamicOptions("step7_folder_id") Flow**:
1. Strip `step7_` → `"folder_id"`
2. Lookup `schemaMetadata["folder_id"]`
3. **Before fix**: undefined (if only `parent_folder_id` indexed)
4. **After fix**: `{ plugin: "google-drive", action: "upload_file", parameter: "folder_id", source: "list_folders" }`
5. Render `DynamicSelectField`
6. **Expected**: Dropdown with folders ✅

### Scenario 2: Parameterize parent_folder_id in Step 2

**Modified Step 2**:
```json
{
  "action": "create_folder",
  "params": {
    "folder_name": "{{input.step2_folder_name}}",
    "parent_folder_id": "{{input.step2_parent_folder_id}}"  // ✅ PARAMETERIZED
  }
}
```

**Input Schema Generated**:
```json
{
  "name": "step2_parent_folder_id",
  "type": "string",
  "required": false
}
```

**getDynamicOptions("step2_parent_folder_id") Flow**:
1. Strip `step2_` → `"parent_folder_id"`
2. Lookup `schemaMetadata["parent_folder_id"]`
3. **Before fix**: Found (exact match)
4. **After fix**: Also check `schemaMetadata["folder_id"]` (base name)
5. **Expected**: Dropdown with folders ✅

## Browser Console Test

Run this in the browser console after calibration page loads:

```javascript
// 1. Check if schema metadata is loaded
console.log('Schema metadata loaded:', !!window.schemaMetadata || 'Check React DevTools');

// 2. Fetch schema metadata directly
fetch('/api/plugins/schema-metadata')
  .then(r => r.json())
  .then(data => {
    console.log('=== SCHEMA METADATA ===');
    console.log('folder_id entries:', data.metadata.folder_id);
    console.log('parent_folder_id entries:', data.metadata.parent_folder_id);
    console.log('file_id entries:', data.metadata.file_id);
  });

// 3. Test if Google Drive is connected
fetch('/api/plugins/user-status?plugin=google-drive')
  .then(r => r.json())
  .then(data => {
    console.log('=== GOOGLE DRIVE STATUS ===');
    console.log('Connected:', data.connected);
    console.log('Username:', data.username);
  });

// 4. Test fetching folder options directly
fetch('/api/plugins/fetch-options', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    plugin: 'google-drive',
    action: 'upload_file',
    parameter: 'folder_id'
  })
})
  .then(r => r.json())
  .then(data => {
    console.log('=== FOLDER OPTIONS ===');
    console.log('Success:', data.success);
    console.log('Options count:', data.options?.length);
    console.log('First 5 folders:', data.options?.slice(0, 5));
  })
  .catch(err => {
    console.error('Fetch options failed:', err);
  });
```

## Expected Results

### After Fix Applied

**Schema Metadata Response**:
```json
{
  "metadata": {
    "folder_id": [
      {
        "plugin": "google-drive",
        "action": "upload_file",
        "parameter": "folder_id",
        "source": "list_folders"
      },
      {
        "plugin": "google-drive",
        "action": "get_folder_contents",
        "parameter": "folder_id",
        "source": "list_folders"
      },
      {
        "plugin": "google-drive",
        "action": "create_folder",  // ✅ NEW: Base name from parent_folder_id
        "parameter": "parent_folder_id",
        "source": "list_folders"
      }
    ],
    "parent_folder_id": [
      {
        "plugin": "google-drive",
        "action": "create_folder",
        "parameter": "parent_folder_id",
        "source": "list_folders"
      }
    ],
    "file_id": [
      {
        "plugin": "google-drive",
        "action": "share_file",
        "parameter": "file_id",
        "source": "list_files"
      },
      {
        "plugin": "google-drive",
        "action": "get_file_metadata",
        "parameter": "file_id",
        "source": "list_files"
      },
      {
        "plugin": "google-drive",
        "action": "read_file_content",
        "parameter": "file_id",
        "source": "list_files"
      }
    ]
  }
}
```

### Fetch Options Response

```json
{
  "success": true,
  "options": [
    {
      "value": "1a2b3c4d5e6f7g8h9i0j",
      "label": "My Projects",
      "description": "Owner: User Name",
      "icon": "📁",
      "group": "My Folders"
    },
    {
      "value": "9j0i8h7g6f5e4d3c2b1a",
      "label": "Shared Documents",
      "description": "Owner: User Name",
      "icon": "📁",
      "group": "My Folders"
    }
  ],
  "total": 25,
  "cached": false
}
```

## Troubleshooting

### If Still No Dropdown

**Check 1**: Is Google Drive connected?
```bash
# Should return connected: true
curl http://localhost:3000/api/plugins/user-status?plugin=google-drive
```

**Check 2**: Does schema-metadata have folder_id?
```bash
curl http://localhost:3000/api/plugins/schema-metadata | jq '.metadata.folder_id'
```

**Check 3**: Can you fetch options manually?
```bash
curl -X POST http://localhost:3000/api/plugins/fetch-options \
  -H "Content-Type: application/json" \
  -d '{
    "plugin": "google-drive",
    "action": "upload_file",
    "parameter": "folder_id"
  }'
```

**Check 4**: Look for console errors in browser DevTools

### Common Issues

1. **Not logged in** - Must be authenticated
2. **Google Drive not connected** - Must connect in Settings
3. **Old schema metadata cached** - Refresh page hard (Cmd+Shift+R)
4. **Wrong parameter** - `folder_name` ≠ `folder_id`

## Conclusion

The user is trying to parameterize `folder_name` which is a **text input field** by design. To get dropdowns for folders, they should parameterize:
- `parent_folder_id` in `create_folder` action
- `folder_id` in `upload_file` action
- `file_id` in `share_file` action

The fix for base name matching (e.g., `parent_folder_id` → `folder_id`) is working, but won't help with `folder_name` because that parameter intentionally doesn't have `x-dynamic-options`.
