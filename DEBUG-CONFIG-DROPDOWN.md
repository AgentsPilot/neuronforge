# Debug: Config Dropdown Not Loading

## Issue

The config form shows text inputs instead of dropdowns for fields like `drive_folder_name` and `google_sheet_id`.

## What Should Happen

1. **Scanning Phase** (`checkMissingConfig()`)
   - Should find `{{config.drive_folder_name}}` in workflow steps
   - Should extract: `{plugin: "google-drive", action: "get_or_create_folder", parameter: "folder_name"}`

2. **Schema Transformation**
   - Config field object should have: `{key: "drive_folder_name", plugin: "google-drive", action: "get_or_create_folder", parameter: "folder_name"}`

3. **getDynamicOptions Call**
   - AgentInputFields calls `getConfigDynamicOptions("drive_folder_name")`
   - Should return: `{plugin: "google-drive", action: "get_or_create_folder", parameter: "folder_name"}`

4. **DynamicSelectField Render**
   - Should receive the metadata and fetch options from `/api/plugins/fetch-options`

## Console Logs to Check

Open browser console and click "Start Test". You should see:

### 1. Scanning Logs

```
[CalibrationSetup] Checking missing config: {stepsCount: X, currentConfig: {...}, firstStepStructure: {...}}
```

Check `firstStepStructure` - does it have the expected format?
- Should have: `{step_id: "...", plugin: "google-drive", action: "get_or_create_folder", config: {...}}`

```
[CalibrationSetup] Scanning step: {stepId: "step4", plugin: "google-drive", action: "get_or_create_folder", type: "action"}
```

Check if plugin and action are being extracted correctly.

```
[CalibrationSetup] Found config reference: {
  configKey: "drive_folder_name",
  plugin: "google-drive",
  action: "get_or_create_folder",
  parameter: "folder_name",
  matchedString: "{{config.drive_folder_name}}",
  fullString: "{{config.drive_folder_name}}"
}
```

**If this log is MISSING**: The scanning isn't finding the config reference. Possible causes:
- pilot_steps structure is different than expected
- Config value is in a different path than `step.config`
- The recursive scanning isn't working correctly

### 2. Schema Transformation Logs

```
[CalibrationSetup] Config schema for form: [
  {
    name: "drive_folder_name",
    label: "Drive Folder Name",
    type: "string",
    description: "...",
    required: true,
    plugin: "google-drive",    ← Should have this
    action: "get_or_create_folder",  ← Should have this
    parameter: "folder_name"   ← Should have this
  }
]
```

**If plugin/action/parameter are MISSING**: The metadata extraction worked, but it's not being passed through to the schema.

### 3. getDynamicOptions Logs

```
[CalibrationSetup] getConfigDynamicOptions for drive_folder_name returning: {
  plugin: "google-drive",
  action: "get_or_create_folder",
  parameter: "folder_name"
}
```

**If returning null**: The schema doesn't have the metadata, or the field name doesn't match.

### 4. DynamicSelectField Logs

```
[DynamicSelectField] Fetching options with: {
  plugin: "google-drive",
  action: "get_or_create_folder",
  parameter: "folder_name",
  refresh: false,
  dependentValues: {}
}
```

**If this log is MISSING**: AgentInputFields is NOT using DynamicSelectField. This means getDynamicOptions returned null or the metadata isn't being recognized.

## Common Issues

### Issue 1: pilot_steps structure is different

**Check:** Look at the `firstStepStructure` log. Does it have the flat format?

```json
{
  "step_id": "step4",
  "type": "action",
  "plugin": "google-drive",  ← Must be here
  "action": "get_or_create_folder",  ← Must be here
  "config": {
    "folder_name": "{{config.drive_folder_name}}"  ← Config reference here
  }
}
```

**If NOT:** The agent's pilot_steps might be in execution graph IR format (nested structure) instead of PILOT DSL format. Need to adjust scanning logic.

### Issue 2: Scanning not finding the parameter name

**Check:** Look for the "Found config reference" log. Does `parameter` match the actual parameter name?

For `folder_name: "{{config.drive_folder_name}}"`, parameter should be `"folder_name"`.

**If NOT:** The recursive scanning might be passing the wrong key. The `currentKey` should be the immediate parent key of the string value.

### Issue 3: Config field name doesn't match schema

**Check:** The config field has `key: "drive_folder_name"`, and the schema should have `name: "drive_folder_name"`.

When `getConfigDynamicOptions("drive_folder_name")` is called, it looks for `configSchema.find(f => f.name === "drive_folder_name")`.

**If NOT:** There's a mismatch in naming.

## Quick Fix Test

If dropdown still not working, try this manual test in browser console:

```javascript
// Test the API directly
fetch('/api/plugins/fetch-options', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    plugin: 'google-drive',
    action: 'get_or_create_folder',
    parameter: 'folder_name',
    refresh: false,
    dependentValues: {}
  })
}).then(r => r.json()).then(console.log)
```

This should return a list of folders. If it fails, the issue is with the API endpoint, not the frontend.

## Status

- ✅ Scanning logic fixed (uses `currentKey` for parameter name)
- ✅ pilot_steps format confirmed (flat PILOT DSL format)
- ✅ Schema transformation includes metadata
- ✅ getConfigDynamicOptions returns metadata
- ❓ **Need to verify:** DynamicSelectField is receiving the metadata and rendering

Next step: Check browser console logs to see where the pipeline breaks.
