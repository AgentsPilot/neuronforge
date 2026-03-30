# Config Form - Both Issues Fixed ✅

## Issue 1: "Ready to start?" Text Disappearing ✅ FIXED

**Problem**: After clicking "Start Test", the text "Ready to start? Click the 'Start Test' button below..." would disappear from the chat.

**Root Cause**: The text was wrapped in `{!isWaitingForConfig && (...)}` condition, so when `isWaitingForConfig` was set to `true`, the text disappeared.

**Solution**: Removed the conditional wrapper - the text now always shows in the welcome screen.

**Change**:
- [CalibrationSetup.tsx:1051-1062](components/v2/calibration/CalibrationSetup.tsx#L1051-L1062) - Removed `{!isWaitingForConfig && (...)}` wrapper

**Before**:
```typescript
{!isWaitingForConfig && (
  <div className="flex items-start gap-3">
    <div>Ready to start? Click the "Start Test" button...</div>
  </div>
)}
```

**After**:
```typescript
<div className="flex items-start gap-3">
  <div>Ready to start? Click the "Start Test" button...</div>
</div>
```

## Issue 2: depends_on Not Working ✅ FIXED

**Problem**: Fields were not sorting correctly - `sheet_tab_name` appeared before `google_sheet_id`, but you need to select the spreadsheet first.

**Root Cause**: The `depends_on` array from schema metadata contains **parameter names** (e.g., `["spreadsheet_id"]`), but AgentInputFields sorts by **field names** (e.g., `"google_sheet_id"`). We were passing parameter names in `depends_on`, which didn't match any field names.

**Example**:
- Schema metadata: `range` parameter depends on `["spreadsheet_id"]` parameter
- Config fields: `sheet_tab_name` (uses `range`) and `google_sheet_id` (uses `spreadsheet_id`)
- AgentInputFields: Checks if `sheet_tab_name` depends on any field matching `"spreadsheet_id"`
- **Mismatch**: No field named `"spreadsheet_id"` exists (it's `"google_sheet_id"`)

**Solution**: Convert `depends_on` from parameter names to config field names by finding which config keys map to those parameters.

**Change**:
- [CalibrationSetup.tsx:1113-1121](components/v2/calibration/CalibrationSetup.tsx#L1113-L1121) - Added mapping logic:

```typescript
// Get depends_on from schema metadata if available
let depends_on: string[] | undefined
if (schemaMetadata) {
  const paramMetadata = schemaMetadata[field.parameter]
  if (paramMetadata && paramMetadata.length > 0) {
    const rawDependsOn = paramMetadata[0]?.depends_on

    // Convert depends_on from parameter names to config field names
    if (rawDependsOn && rawDependsOn.length > 0) {
      depends_on = rawDependsOn.map((paramName: string) => {
        // Find the config field that uses this parameter
        const dependentField = configSchema.find((f: any) => f.parameter === paramName)
        return dependentField ? dependentField.name : paramName
      })
    }
  }
}
```

**Example Flow**:

1. **Schema metadata** (for `range` parameter):
   ```json
   {
     "parameter": "range",
     "depends_on": ["spreadsheet_id"]
   }
   ```

2. **Config schema** (generated from workflow):
   ```typescript
   [
     { name: "google_sheet_id", parameter: "spreadsheet_id", ... },
     { name: "sheet_tab_name", parameter: "range", ... }
   ]
   ```

3. **Conversion**:
   - Raw `depends_on`: `["spreadsheet_id"]` (parameter names)
   - Find config field with `parameter === "spreadsheet_id"` → `"google_sheet_id"`
   - Converted `depends_on`: `["google_sheet_id"]` (field names)

4. **AgentInputFields sorting**:
   - Checks: Does `sheet_tab_name` depend on `google_sheet_id`? **YES** ✅
   - Result: `google_sheet_id` comes before `sheet_tab_name`

## Files Modified

1. ✅ **components/v2/calibration/CalibrationSetup.tsx**
   - Line 1051: Removed conditional wrapper for "Ready to start?" text
   - Lines 1113-1121: Added parameter-to-field name conversion for `depends_on`

## Testing Results

✅ **Text visibility**: "Ready to start?" text stays visible after clicking Start Test
✅ **Field ordering**: `google_sheet_id` appears before `sheet_tab_name`
✅ **Dynamic behavior**: When selecting a spreadsheet, the tab dropdown updates accordingly

## How It Works Now

### User Experience

1. **Welcome screen** shows:
   - Checklist of what will be tested
   - "Ready to start?" message
   - "Start Test" button

2. **Click "Start Test"**:
   - All welcome content stays visible
   - Config form appears below
   - Button disappears

3. **Config form fields** are ordered correctly:
   1. `google_sheet_id` (dropdown - select spreadsheet first)
   2. `sheet_tab_name` (dropdown - depends on spreadsheet)
   3. `drive_folder_name` (text input)
   4. `user_email` (text input)
   5. `amount_threshold_usd` (number input)

4. **Selecting spreadsheet**:
   - Choose from dropdown (32 options)
   - `sheet_tab_name` dropdown activates
   - Shows tabs from selected spreadsheet

5. **Fill form and continue**:
   - All fields populated
   - Click "Save & Continue"
   - Config saved, calibration starts

## Summary

Both issues resolved! The config form now:
- ✅ Preserves all welcome messages
- ✅ Orders fields based on dependencies
- ✅ Provides smooth UX with dependent dropdowns working correctly

The fix ensures that parameter-level dependencies (from plugin schemas) are correctly translated to field-level dependencies (for UI sorting).
