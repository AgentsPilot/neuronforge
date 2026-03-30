# depends_on Fix - Complete

## Problem

Field ordering in config form wasn't respecting dependencies. The `sheet_tab_name` field was appearing before `google_sheet_id`, even though it depends on selecting a spreadsheet first.

## Root Cause

There was a mismatch between config field names and plugin parameter names:

- **Config field name**: `google_sheet_id` (used in form values)
- **Plugin parameter name**: `spreadsheet_id` (used in API calls)
- **Schema metadata `depends_on`**: `["spreadsheet_id"]` (parameter names)

The sorting logic in AgentInputFields was comparing field names (e.g., `"google_sheet_id"`) against `depends_on` array items (e.g., `"spreadsheet_id"`), resulting in NO MATCH and no reordering.

When we tried converting `depends_on` to field names, it broke the API calls because `dependentValues` needs parameter names as keys:

```javascript
// API expects:
{ "spreadsheet_id": "abc123" }

// But with converted depends_on, we were sending:
{ "google_sheet_id": "abc123" }
```

## Solution

Keep `depends_on` as parameter names (for API calls), but provide a mapping from parameter names to field names for sorting and value lookup.

### Changes Made

#### 1. CalibrationSetup.tsx (lines 1111-1165)

Enhanced `getConfigDynamicOptions` to return both `depends_on` (parameter names) and `paramToFieldMap` (mapping):

```typescript
const getConfigDynamicOptions = (fieldName: string): {
  plugin: string
  action: string
  parameter: string
  depends_on?: string[]
  paramToFieldMap?: Record<string, string>  // NEW
} | null => {
  const field = configSchema.find((f: any) => f.name === fieldName)
  if (field && field.plugin && field.action && field.parameter) {
    let depends_on: string[] | undefined
    let paramToFieldMap: Record<string, string> | undefined

    if (schemaMetadata) {
      const paramMetadata = schemaMetadata[field.parameter]
      if (paramMetadata && paramMetadata.length > 0) {
        const rawDependsOn = paramMetadata[0]?.depends_on

        if (rawDependsOn && rawDependsOn.length > 0) {
          // Keep depends_on as parameter names
          depends_on = rawDependsOn

          // Create mapping from parameter names to field names
          paramToFieldMap = {}
          rawDependsOn.forEach((paramName: string) => {
            const dependentField = configSchema.find((f: any) => f.parameter === paramName)
            if (dependentField) {
              paramToFieldMap![paramName] = dependentField.name
            }
          })
        }
      }
    }

    return {
      plugin: field.plugin,
      action: field.action,
      parameter: field.parameter,
      depends_on,        // ["spreadsheet_id"]
      paramToFieldMap    // {"spreadsheet_id": "google_sheet_id"}
    }
  }
  return null
}
```

#### 2. AgentInputFields.tsx - Type Update (line 28-34)

Updated `getDynamicOptions` type to include `paramToFieldMap`:

```typescript
getDynamicOptions?: (fieldName: string) => {
  plugin: string
  action: string
  parameter: string
  depends_on?: string[]
  paramToFieldMap?: Record<string, string>  // NEW
} | null
```

#### 3. AgentInputFields.tsx - dependentValues Building (lines 64-82)

Updated to use parameter names as keys (for API) but field names for value lookup:

```typescript
if (dynamicOptions.depends_on && Array.isArray(dynamicOptions.depends_on)) {
  const stepPrefixMatch = field.name.match(/^(step\d+_)/)
  const stepPrefix = stepPrefixMatch ? stepPrefixMatch[1] : ''

  dynamicOptions.depends_on.forEach((paramName: string) => {
    // Map parameter name to field name using paramToFieldMap
    const fieldName = dynamicOptions.paramToFieldMap?.[paramName] || paramName

    // Try both the base field name and the prefixed version
    const prefixedFieldName = stepPrefix + fieldName
    const depValue = values[prefixedFieldName] || values[fieldName]

    if (depValue) {
      // Use parameter name as key (for API), but lookup value using field name
      dependentValues[paramName] = depValue
    }
  })
}
```

**Result**: API receives `{"spreadsheet_id": "abc123"}` ✅

#### 4. AgentInputFields.tsx - Sorting Logic (lines 186-217)

Updated to map parameter names to field names before comparing:

```typescript
fields.sort((a, b) => {
  const aDynamicOptions = getDynamicOptions?.(a.name)
  const bDynamicOptions = getDynamicOptions?.(b.name)

  const baseNameA = a.name.replace(/^step\d+_/, '')
  const baseNameB = b.name.replace(/^step\d+_/, '')

  // If a depends on b, b should come first
  if (aDynamicOptions?.depends_on && aDynamicOptions?.paramToFieldMap) {
    // Map parameter names to field names
    const dependentFieldNames = aDynamicOptions.depends_on.map(
      (paramName: string) => aDynamicOptions.paramToFieldMap![paramName] || paramName
    )
    // depends_on: ["spreadsheet_id"] → dependentFieldNames: ["google_sheet_id"]

    if (dependentFieldNames.includes(baseNameB)) {
      return 1 // a comes after b
    }
  }

  // If b depends on a, a should come first
  if (bDynamicOptions?.depends_on && bDynamicOptions?.paramToFieldMap) {
    const dependentFieldNames = bDynamicOptions.depends_on.map(
      (paramName: string) => bDynamicOptions.paramToFieldMap![paramName] || paramName
    )
    if (dependentFieldNames.includes(baseNameA)) {
      return -1 // a comes before b
    }
  }

  return 0
})
```

**Result**: Fields now sort correctly - `google_sheet_id` appears before `sheet_tab_name` ✅

## How It Works

### Example: sheet_tab_name depends on google_sheet_id

1. **Schema metadata** (from plugin):
   ```json
   {
     "range": {  // parameter name
       "depends_on": ["spreadsheet_id"]
     }
   }
   ```

2. **Config scanning** finds:
   ```json
   {
     "key": "sheet_tab_name",
     "parameter": "range"
   }
   {
     "key": "google_sheet_id",
     "parameter": "spreadsheet_id"
   }
   ```

3. **getConfigDynamicOptions("sheet_tab_name")** returns:
   ```javascript
   {
     plugin: "google-sheets",
     action: "list_sheet_names",
     parameter: "range",
     depends_on: ["spreadsheet_id"],  // parameter names (for API)
     paramToFieldMap: {
       "spreadsheet_id": "google_sheet_id"  // parameter → field mapping
     }
   }
   ```

4. **Sorting**:
   - Maps `["spreadsheet_id"]` → `["google_sheet_id"]` using `paramToFieldMap`
   - Checks if `"google_sheet_id"` matches other field names
   - Finds match → puts `google_sheet_id` before `sheet_tab_name`

5. **dependentValues**:
   - Maps `"spreadsheet_id"` → `"google_sheet_id"` using `paramToFieldMap`
   - Gets value: `values["google_sheet_id"]` = `"abc123"`
   - Builds: `{ "spreadsheet_id": "abc123" }` (parameter name as key)
   - API receives correct format ✅

## Files Modified

1. **components/v2/calibration/CalibrationSetup.tsx**
   - Enhanced `getConfigDynamicOptions` to return `paramToFieldMap` (lines 1111-1165)

2. **components/v2/AgentInputFields.tsx**
   - Updated type signature (lines 28-34)
   - Fixed `dependentValues` building (lines 64-82)
   - Fixed sorting logic (lines 186-217)

## Testing

### Expected Behavior

1. Load invoice extraction agent in sandbox
2. Click "Start Test"
3. Config form should show fields in this order:
   - **google_sheet_id** (dropdown) ← First
   - **sheet_tab_name** (dropdown/text) ← After, because it depends on spreadsheet_id
   - **drive_folder_name** (text input)
   - **user_email** (text input)
   - **amount_threshold_usd** (number input)

4. Select a spreadsheet from `google_sheet_id` dropdown
5. `sheet_tab_name` dropdown should fetch tabs from that spreadsheet

### Console Logs

```
[CalibrationSetup] Mapping param spreadsheet_id to field: google_sheet_id
[CalibrationSetup] paramToFieldMap: { spreadsheet_id: "google_sheet_id" }
[DynamicSelectField] Fetching options with: {
  plugin: "google-sheets",
  action: "list_sheet_names",
  parameter: "range",
  dependentValues: { spreadsheet_id: "abc123" }  ← Correct format!
}
```

### Server Logs

Should NOT see:
```
{"level":40,"msg":"list_sheet_names called without spreadsheet_id"}
```

Should see successful API calls.

## Status

✅ **COMPLETE** - Field ordering now correctly respects dependencies, and dependent fields receive the correct parameter values for API calls.
