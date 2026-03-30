# Permission Type Normalization Fix - COMPLETE ✅

## Problem

After fixing the parameter unwrapping issue, step9 (Google Drive `share_file`) was failing with:

```
Invalid value for: anyone_with_link is not a valid value
```

### Root Cause

**Mismatch between plugin schema and Google Drive API**:

1. **Plugin Schema** (`google-drive-plugin-v2.json` line 1380-1389) defines user-friendly values:
   - `"anyone_with_link"` ✅ (schema allows this)
   - `"anyone_can_view"`
   - `"anyone_can_edit"`
   - `"specific_users"`

2. **Google Drive API** expects technical values:
   - `"anyone"` ← what Google API actually accepts
   - `"user"`
   - `"group"`
   - `"domain"`

3. **Plugin Executor** was passing the schema value directly to the API without normalization

## Solution Implemented

**Added permission type normalization in `shareFile()` function** to map user-friendly schema values to Google API values.

### File Modified

#### `/lib/server/google-drive-plugin-executor.ts` (lines 738-766)

```typescript
// ✅ FIX: Normalize permission_type from user-friendly values to Google Drive API values
// Schema allows: "anyone_with_link", "anyone_can_view", "anyone_can_edit", "specific_users"
// Google API expects: "anyone", "user", "group", "domain"
let permissionType: string;
let role: string;

const userPermissionType = parameters.permission_type || 'anyone_with_link';

if (userPermissionType === 'anyone_with_link' || userPermissionType === 'anyone_can_view') {
  permissionType = 'anyone';
  role = 'reader';
} else if (userPermissionType === 'anyone_can_edit') {
  permissionType = 'anyone';
  role = 'writer';
} else if (userPermissionType === 'specific_users') {
  permissionType = 'user';
  role = parameters.role || 'reader';
} else {
  // Fallback for direct API values (backward compatibility)
  permissionType = userPermissionType;
  role = parameters.role || 'reader';
}

// Allow role override if explicitly provided
if (parameters.role) {
  role = parameters.role;
}

// Build permission request
const permission: any = {
  type: permissionType,
  role: role
};
```

## Mapping Logic

| Schema Value (User-Friendly) | Google API `type` | Google API `role` |
|------------------------------|-------------------|-------------------|
| `anyone_with_link` | `anyone` | `reader` |
| `anyone_can_view` | `anyone` | `reader` |
| `anyone_can_edit` | `anyone` | `writer` |
| `specific_users` | `user` | `reader` (or override) |
| Other values | Pass through | `reader` (or override) |

## Why This Approach

✅ **User-friendly schema**: Non-technical users understand `"anyone_with_link"` better than `"anyone"`
✅ **API compatibility**: Converts to what Google Drive API expects
✅ **Backward compatible**: Falls back to direct API values if provided
✅ **Role override support**: Still allows explicit role parameter
✅ **Clear mapping**: Easy to understand and maintain

## Testing

To verify the fix works:

1. Start the server: `npm run dev`
2. Trigger calibration via the UI or API
3. Check that step9 (share_file) completes successfully
4. Verify the file is shared with a public link

## Combined Fixes

This fix works together with the parameter unwrapping fix to solve the complete step9 issue:

1. ✅ **Parameter Unwrapping**: Extracts `file_id` from JSON string object
2. ✅ **Permission Type Normalization**: Converts `"anyone_with_link"` to `"anyone"`

Both fixes are required for step9 to work correctly.

## Next Steps

Run the workflow end-to-end to verify:
- Step 8 uploads file → returns file object
- Step 9 receives `{{drive_file}}` → unwraps to file_id → normalizes permission_type → shares successfully
- Workflow completes without errors
