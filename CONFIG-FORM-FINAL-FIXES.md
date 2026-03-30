# Config Form - Final Fixes Complete

## Issues Fixed

### 1. Chat Clearing Issue ✅

**Problem**: When clicking "Start Test", the chat would clear and only show the config form, losing the welcome message.

**Solution**: Don't set `hasStarted = true` when showing the config form. Only set it when actually running calibration.

**Changes**:
- [CalibrationSetup.tsx:440](components/v2/calibration/CalibrationSetup.tsx#L440) - Removed `setHasStarted(true)` from config form display
- [CalibrationSetup.tsx:617](components/v2/calibration/CalibrationSetup.tsx#L617) - Added `setHasStarted(true)` before running calibration in `saveConfigAndContinue`
- [CalibrationSetup.tsx:1625](components/v2/calibration/CalibrationSetup.tsx#L1625) - Updated button condition to hide when `isWaitingForConfig`
- [CalibrationSetup.tsx:1064-1175](components/v2/calibration/CalibrationSetup.tsx#L1064-L1175) - Config form now renders within the welcome screen

### 2. Dropdown Preventing Text Entry ✅

**Problem**: Fields like `drive_folder_name` and `user_email` were showing as dropdowns but the API returned errors because these parameters don't support dynamic options. The combobox prevented manual text entry.

**Root Cause**:
- `drive_folder_name` is used with `get_or_create_folder` action, which takes a text input for the folder name to CREATE (not select)
- `user_email` is used with `send_email` action's `to` parameter, which takes an email address (not a selection)

**Solution**: Updated `DynamicSelectField` to fall back to a regular text input when there's an error fetching options.

**Changes**:
- [DynamicSelectField.tsx:164-180](components/v2/DynamicSelectField.tsx#L164-L180) - Added error fallback rendering:
```typescript
// If there's an error fetching options, fall back to regular text input
if (error && options.length === 0) {
  return (
    <div className="relative">
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className={...}
      />
      <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
        <AlertCircle className="w-4 h-4 text-amber-500" title={error} />
      </div>
    </div>
  )
}
```

### 3. Field Ordering (Dependencies) ✅

**Problem**: `sheet_tab_name` appeared before `google_sheet_id`, but you need to select the spreadsheet first before selecting a tab within it.

**Solution**: Include `depends_on` metadata in `getConfigDynamicOptions` return value. `AgentInputFields` already has sorting logic that respects `depends_on` relationships.

**Changes**:
- [CalibrationSetup.tsx:1112-1134](components/v2/calibration/CalibrationSetup.tsx#L1112-L1134) - Updated `getConfigDynamicOptions` to include `depends_on` from `schemaMetadata`:
```typescript
const getConfigDynamicOptions = (fieldName: string): { plugin: string; action: string; parameter: string; depends_on?: string[] } | null => {
  const field = configSchema.find((f: any) => f.name === fieldName)
  if (field && field.plugin && field.action && field.parameter) {
    // Get depends_on from schema metadata if available
    let depends_on: string[] | undefined
    if (schemaMetadata) {
      const paramMetadata = schemaMetadata[field.parameter]
      if (paramMetadata && paramMetadata.length > 0) {
        depends_on = paramMetadata[0]?.depends_on
      }
    }

    return {
      plugin: field.plugin,
      action: field.action,
      parameter: field.parameter,
      depends_on  // Now included!
    }
  }
  return null
}
```

## How It Works Now

### User Flow

1. **User clicks "Start Test"**
   - Pre-flight check scans workflow for `{{config.X}}` patterns
   - Finds 5 missing config keys

2. **Config form appears in welcome screen**
   - Welcome message stays visible
   - Bot explains config is needed
   - Form shows with proper field ordering

3. **Fields are properly ordered**
   - `google_sheet_id` appears first (dropdown with 32 spreadsheets)
   - `sheet_tab_name` appears after (depends on spreadsheet selection)
   - Other fields in logical order

4. **Field types are appropriate**
   - `google_sheet_id` → Dropdown (supports dynamic options)
   - `drive_folder_name` → Text input (create new folder name)
   - `user_email` → Text input (enter email address)
   - `sheet_tab_name` → Dropdown if API supports it, text input otherwise
   - `amount_threshold_usd` → Number input

5. **User fills form and clicks "Save & Continue"**
   - Config saved to database
   - `hasStarted` set to true NOW
   - Calibration runs with config

### Field Type Logic

```
For each config field:
  1. Check if parameter supports dynamic options (via API)
  2. If YES: Show dropdown (DynamicSelectField)
  3. If NO (API error): Fall back to text input
  4. Field order determined by depends_on relationships
```

### Dependencies Handling

The `range` parameter (sheet tab name) has:
```json
{
  "x-dynamic-options": {
    "source": "list_sheets",
    "depends_on": ["spreadsheet_id"]
  }
}
```

When `AgentInputFields` renders, it:
1. Calls `getConfigDynamicOptions` for each field
2. Gets `depends_on: ["spreadsheet_id"]` for `range`
3. Sorts fields so `spreadsheet_id` comes before `range`
4. Passes `dependentValues` to `DynamicSelectField`

## Files Modified

1. ✅ **components/v2/calibration/CalibrationSetup.tsx**
   - Removed `setHasStarted(true)` from config form display (line 440)
   - Added `setHasStarted(true)` before running calibration (line 617)
   - Updated button condition to check `isWaitingForConfig` (line 1625)
   - Moved config form rendering to welcome screen (lines 1064-1175)
   - Enhanced `getConfigDynamicOptions` to include `depends_on` (lines 1112-1134)

2. ✅ **components/v2/DynamicSelectField.tsx**
   - Added error fallback to text input (lines 164-180)

## Testing Results

✅ **Chat preservation**: Welcome message stays visible when config form appears
✅ **Text entry**: Can type folder names and email addresses
✅ **Dropdowns work**: `google_sheet_id` shows 32 spreadsheets
✅ **Field order**: `google_sheet_id` before `sheet_tab_name`
✅ **Error handling**: Fields without dynamic options gracefully fall back to text input

## Summary

The config form now provides a smooth UX:
- Welcome message preserved throughout
- Fields ordered logically (dependencies respected)
- Appropriate input types (dropdowns vs text inputs)
- Graceful error handling (fallback to text input)
- Natural conversation flow (config as setup, not error)

All issues resolved! 🎉
