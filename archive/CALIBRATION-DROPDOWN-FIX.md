# Calibration Dropdown Fix - Parameter Name Matching

**Date**: February 18, 2026
**Status**: ✅ FIXED

## Problem

User reported: "When running calibration the hardcoded function suppose to parameterized all plugins if the user choose to do so. The issue for the google drive I didn't get the dropdown"

## Root Cause

The schema-metadata API was only indexing parameters by their exact name (e.g., `parent_folder_id`), but calibration lookup was using base names (e.g., `folder_id` after stripping `parent_` prefix).

**Example Mismatch**:
- Google Drive `create_folder` action has parameter: `parent_folder_id`
- Schema metadata indexed as: `metadata["parent_folder_id"]`
- Calibration generates parameterized field: `step2_folder_id` (strips `parent_` during generation)
- Lookup: `getDynamicOptions("step2_folder_id")` → strips `step2_` → looks up `metadata["folder_id"]`
- **Result**: ❌ NOT FOUND (schema has `parent_folder_id`, lookup uses `folder_id`)

## Solution

**File**: [app/api/plugins/schema-metadata/route.ts](app/api/plugins/schema-metadata/route.ts)

**Change** (lines 70-82):

```typescript
// BEFORE (only exact match):
metadata[paramName].push({
  plugin: pluginName,
  action: actionName,
  parameter: paramName,
  source: dynamicOptions.source,
  depends_on: dynamicOptions.depends_on
});

// AFTER (exact match + base name):
metadata[paramName].push({
  plugin: pluginName,
  action: actionName,
  parameter: paramName,
  source: dynamicOptions.source,
  depends_on: dynamicOptions.depends_on
});

// ✅ NEW: Also index by base name
const baseName = paramName.replace(/^(parent_|target_|source_|from_|to_)/, '');
if (baseName !== paramName && !metadata[baseName]) {
  metadata[baseName] = [];
  metadata[baseName].push({
    plugin: pluginName,
    action: actionName,
    parameter: paramName, // Keep original parameter name for API calls
    source: dynamicOptions.source,
    depends_on: dynamicOptions.depends_on
  });
}
```

## Impact

### Before Fix

**Schema Metadata Response**:
```json
{
  "metadata": {
    "parent_folder_id": [
      {
        "plugin": "google-drive",
        "action": "create_folder",
        "parameter": "parent_folder_id",
        "source": "list_folders"
      }
    ]
  }
}
```

**Calibration Lookup**:
- Field name: `step2_folder_id`
- After stripping `step2_`: `folder_id`
- Lookup: `metadata["folder_id"]` → ❌ NOT FOUND
- Result: Regular text input (no dropdown)

### After Fix

**Schema Metadata Response**:
```json
{
  "metadata": {
    "parent_folder_id": [
      {
        "plugin": "google-drive",
        "action": "create_folder",
        "parameter": "parent_folder_id",
        "source": "list_folders"
      }
    ],
    "folder_id": [  // ✅ NEW: Base name entry
      {
        "plugin": "google-drive",
        "action": "create_folder",
        "parameter": "parent_folder_id",  // Still references original param
        "source": "list_folders"
      }
    ]
  }
}
```

**Calibration Lookup**:
- Field name: `step2_folder_id`
- After stripping `step2_`: `folder_id`
- Lookup: `metadata["folder_id"]` → ✅ FOUND
- Result: Dynamic dropdown with available folders

## Affected Parameters

### Google Drive

✅ **Now works**:
- `parent_folder_id` → Also indexed as `folder_id`

### Future-Proof for Other Plugins

The fix also handles other common prefixes:
- `target_channel_id` → `channel_id`
- `source_spreadsheet_id` → `spreadsheet_id`
- `from_email` → `email`
- `to_email` → `email`

## Testing

### Test Case 1: Create Folder (parent_folder_id)

**Before Fix**:
```javascript
fetch('/api/plugins/schema-metadata')
  .then(r => r.json())
  .then(data => {
    console.log(data.metadata['folder_id']); // undefined ❌
    console.log(data.metadata['parent_folder_id']); // [{ ... }] ✅
  });
```

**After Fix**:
```javascript
fetch('/api/plugins/schema-metadata')
  .then(r => r.json())
  .then(data => {
    console.log(data.metadata['folder_id']); // [{ parameter: 'parent_folder_id', ... }] ✅
    console.log(data.metadata['parent_folder_id']); // [{ ... }] ✅ (both work)
  });
```

### Test Case 2: Calibration Flow

**Workflow DSL** (before calibration):
```json
{
  "id": "step2",
  "plugin": "google-drive",
  "action": "create_folder",
  "params": {
    "folder_name": "Expense Receipts",
    "parent_folder_id": "root"  // Hardcoded
  }
}
```

**User Action**: Parameterize `parent_folder_id`

**Calibration Generates**:
```json
{
  "params": {
    "folder_name": "Expense Receipts",
    "parent_folder_id": "{{step2_folder_id}}"  // Parameterized
  }
}
```

**Input Field**:
```json
{
  "name": "step2_folder_id",
  "type": "string",
  "required": false
}
```

**getDynamicOptions() Flow**:
1. Called with: `"step2_folder_id"`
2. Strip `step2_`: `"folder_id"`
3. Lookup: `schemaMetadata["folder_id"]`
4. **Before Fix**: `undefined` → Regular text input
5. **After Fix**: `{ plugin: "google-drive", action: "create_folder", parameter: "parent_folder_id", source: "list_folders" }` ✅
6. Renders `DynamicSelectField`
7. Dropdown shows available folders from Google Drive

## Important Notes

### Why Keep Original Parameter Name?

The base name entry still references the ORIGINAL parameter name (`parent_folder_id`):

```javascript
{
  "plugin": "google-drive",
  "action": "create_folder",
  "parameter": "parent_folder_id",  // ✅ Original - used for API calls
  "source": "list_folders"
}
```

**Reason**: When `DynamicSelectField` calls `/api/plugins/fetch-options`, it needs the exact parameter name to validate against the plugin schema.

### Duplicate Prevention

The fix only adds base name entry if it doesn't already exist:

```typescript
if (baseName !== paramName && !metadata[baseName]) {
  metadata[baseName] = [];
  // ...
}
```

**Why**: Avoids conflicts if a plugin has both `folder_id` AND `parent_folder_id` parameters.

## Edge Cases Handled

### Case 1: Plugin with Both `folder_id` and `parent_folder_id`

**Scenario**: A plugin action has:
- `folder_id` (with x-dynamic-options)
- `parent_folder_id` (with x-dynamic-options)

**Behavior**:
1. First iteration: `folder_id` → indexes as `metadata["folder_id"]`
2. Second iteration: `parent_folder_id` → indexes as `metadata["parent_folder_id"]`
3. Base name check: `baseName = "folder_id"` → already exists, skip

**Result**: `metadata["folder_id"]` contains only the original `folder_id` parameter (not overwritten)

### Case 2: No Prefix

**Scenario**: Parameter is already `folder_id` (no prefix)

**Behavior**:
- `baseName = paramName.replace(/^(parent_|...)/, '')` → `"folder_id"` (no change)
- Check: `baseName !== paramName` → false
- Skip base name indexing

**Result**: Only one entry in metadata (no duplicate)

## Verification

### Manual Test

1. Open calibration page
2. Run workflow with Google Drive `create_folder` action
3. Choose to parameterize `parent_folder_id`
4. **Expected**: See dropdown with available folders
5. **Before fix**: See text input
6. **After fix**: See dropdown ✅

### Console Verification

```javascript
// After page loads and schemaMetadata is fetched
console.log('folder_id entries:', schemaMetadata['folder_id']);
console.log('parent_folder_id entries:', schemaMetadata['parent_folder_id']);

// Both should have entries after the fix
```

## Production Readiness

**Status**: ✅ Ready for production

**Risk**: Low
- Additive change (doesn't remove existing functionality)
- Only adds additional index entries
- Prevents duplicates with `!metadata[baseName]` check
- No breaking changes to API response format

**Rollback**: Simple (revert single file change)

## Related Documentation

- [CALIBRATION-DROPDOWN-MISSING-ANALYSIS.md](CALIBRATION-DROPDOWN-MISSING-ANALYSIS.md) - Detailed architecture analysis

## Conclusion

The fix ensures that calibration can match parameterized field names (like `step2_folder_id`) to schema metadata entries that use prefixed parameter names (like `parent_folder_id`). This enables dynamic dropdowns for all Google Drive parameters that have `x-dynamic-options`, regardless of prefix variations in naming.

**User Impact**: All Google Drive plugin parameters that support dynamic options now show dropdowns during calibration, as expected.
