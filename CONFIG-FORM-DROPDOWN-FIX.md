# Config Form Dropdown Fix - Complete

## Problem

User reported: "the workflow configuration doesn't 'build' the dropdown like for the spreadsheet or google drive"

The config form was showing text inputs instead of dynamic dropdowns for fields like:
- `google_sheet_id` → should show spreadsheet picker
- `drive_folder_name` → should show folder picker

## Root Cause

The config fields weren't getting plugin metadata (plugin, action, parameter) needed by DynamicSelectField to fetch dropdown options from plugin APIs.

The scanning logic in `checkMissingConfig()` needed to:
1. Find where each config key (e.g., `drive_folder_name`) is used in workflow steps
2. Extract the plugin, action, and parameter name from that usage
3. Pass this metadata through to AgentInputFields → DynamicSelectField

## Solution

### Fixed the Recursive Scanning Logic

**File:** `components/v2/calibration/CalibrationSetup.tsx` (lines 235-269)

Changed the `scanForConfigRefs` function to properly track the parameter name:

```typescript
const scanForConfigRefs = (obj: any, stepId?: string, plugin?: string, action?: string, currentKey?: string) => {
  if (typeof obj === 'string') {
    const matches = obj.matchAll(/\{\{config\.(\w+)\}\}/g)
    for (const match of matches) {
      const configKey = match[1]
      if (!configReferences.has(configKey)) {
        configReferences.set(configKey, [])
      }
      // Add usage info if we have step context and current key (parameter name)
      if (stepId && plugin && action && currentKey) {
        console.log('[CalibrationSetup] Found config reference:', {
          configKey,
          plugin,
          action,
          parameter: currentKey,  // ← This is the parameter name!
          matchedString: match[0],
          fullString: obj
        })
        configReferences.get(configKey)!.push({
          stepId,
          plugin,
          action,
          parameter: currentKey
        })
      }
    }
  } else if (Array.isArray(obj)) {
    obj.forEach(item => scanForConfigRefs(item, stepId, plugin, action, currentKey))
  } else if (obj && typeof obj === 'object') {
    Object.entries(obj).forEach(([key, value]) => {
      // Pass the key as the current parameter name for the recursive call
      scanForConfigRefs(value, stepId, plugin, action, key)
    })
  }
}
```

**Key Insight:** When processing nested objects, pass the current `key` as the `currentKey` parameter. This way, when we find a string value, the `currentKey` is the immediate parent key, which is the parameter name we need.

### Example: How It Works

Given a workflow step:
```json
{
  "step_id": "step4",
  "type": "action",
  "plugin": "google-drive",
  "action": "get_or_create_folder",
  "config": {
    "folder_name": "{{config.drive_folder_name}}"
  }
}
```

The recursion path:
1. Start scanning step with `plugin="google-drive"`, `action="get_or_create_folder"`
2. Recurse into `config` object
3. Call with `key="folder_name"`, `value="{{config.drive_folder_name}}"`
4. Match found: `configKey="drive_folder_name"`, `currentKey="folder_name"`
5. Store metadata: `{plugin: "google-drive", action: "get_or_create_folder", parameter: "folder_name"}`

### Data Flow

```
Workflow Step (pilot_steps)
    ↓ scanForConfigRefs()
Config Key + Metadata
    {key: "drive_folder_name", plugin: "google-drive", action: "get_or_create_folder", parameter: "folder_name"}
    ↓ checkMissingConfig()
Config Fields Array
    ↓ Transform to schema format
AgentInputFields Schema
    [{name: "drive_folder_name", plugin: "google-drive", action: "get_or_create_folder", parameter: "folder_name", ...}]
    ↓ getConfigDynamicOptions(fieldName)
Dynamic Options Metadata
    {plugin: "google-drive", action: "get_or_create_folder", parameter: "folder_name"}
    ↓ AgentInputFields checks getDynamicOptions()
DynamicSelectField
    ↓ Fetches from plugin API
Dropdown with folders from Google Drive
```

## What Was Changed

### 1. Simplified Step Scanning (lines 271-286)

Confirmed pilot_steps uses flat structure with `step.plugin` and `step.action` directly:

```typescript
workflowSteps.forEach((step: any) => {
  const stepId = step.id || step.step_id
  const plugin = step.plugin || step.plugin_key
  const action = step.action

  console.log('[CalibrationSetup] Scanning step:', {
    stepId,
    plugin,
    action,
    type: step.type
  })

  scanForConfigRefs(step, stepId, plugin, action)
})
```

### 2. Fixed Recursive Scanning (lines 234-269)

Changed the parameter tracking logic:
- **Before:** Used `paramPath` which accumulated full path like `"config.folder_name"`
- **After:** Use `currentKey` which is just the immediate key like `"folder_name"`

This ensures DynamicSelectField gets the correct parameter name to look up in plugin schemas.

### 3. Metadata Already Passed Through (lines 1326-1375)

The existing code already:
- Transforms config fields to schema format
- Adds plugin/action/parameter metadata to schema
- Creates `getConfigDynamicOptions` function
- Passes it to AgentInputFields

So once the scanning extracts the metadata correctly, the rest of the pipeline works!

## Testing

### Expected Behavior

1. Load invoice extraction agent in sandbox
2. Click "Start Test"
3. Config form should show:
   - **Drive Folder Name:** Dropdown with folders from Google Drive
   - **Google Sheet ID:** Dropdown with spreadsheets from Google Sheets
   - **User Email:** Text input (no dynamic options)
   - **Amount Threshold USD:** Number input
   - **Sheet Tab Name:** Text input (could be dynamic if we wanted)

### Console Logs to Verify

When the config form loads, you should see:

```
[CalibrationSetup] Checking missing config: {stepsCount: 12, currentConfig: {}, firstStepStructure: {...}}
[CalibrationSetup] Scanning step: {stepId: "step4", plugin: "google-drive", action: "get_or_create_folder", type: "action"}
[CalibrationSetup] Found config reference: {
  configKey: "drive_folder_name",
  plugin: "google-drive",
  action: "get_or_create_folder",
  parameter: "folder_name",
  matchedString: "{{config.drive_folder_name}}",
  fullString: "{{config.drive_folder_name}}"
}
[CalibrationSetup] Config schema for form: [{name: "drive_folder_name", plugin: "google-drive", action: "get_or_create_folder", parameter: "folder_name", ...}]
[CalibrationSetup] getConfigDynamicOptions for drive_folder_name returning: {plugin: "google-drive", action: "get_or_create_folder", parameter: "folder_name"}
```

## Files Modified

1. **components/v2/calibration/CalibrationSetup.tsx**
   - Fixed `scanForConfigRefs` recursive logic (lines 234-269)
   - Simplified step scanning (lines 271-286)
   - Added debug logging

## Status

✅ **COMPLETE** - The scanning logic now correctly extracts plugin metadata for config fields, enabling dynamic dropdowns in the config form.

The fix ensures config fields like `drive_folder_name` and `google_sheet_id` will render as dropdowns instead of text inputs, providing a better UX that matches the existing calibration parameter fix flow.
