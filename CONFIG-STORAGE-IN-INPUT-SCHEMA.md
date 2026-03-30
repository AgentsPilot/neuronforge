# Config Storage in input_schema - Implementation

## Problem

When trying to save workflow configuration values (for `{{config.X}}` patterns), we got the error:
```
Failed to save configuration: Could not find the 'workflow_config' column of 'agents' in the schema cache
```

The `workflow_config` column doesn't exist in the `agents` table.

## Solution

Instead of creating a new column, store config values in the existing `input_schema` field as `default_value` for each config field.

### Why This Works

1. **input_schema already exists** - No migration needed
2. **Semantic fit** - Config fields ARE input parameters with default values
3. **WorkflowPilot already reads it** - Can access input_schema during execution
4. **UI consistency** - Config fields can be displayed alongside other input fields

## Changes Made

### 1. Sandbox Page - Save config to input_schema (app/v2/sandbox/[agentId]/page.tsx)

**Old approach** (lines 326-369):
- Tried to save to `workflow_config` column (doesn't exist)
- Would have created separate storage for config

**New approach** (lines 326-385):
```typescript
// Update input_schema with config values as default_value
const updatedInputSchema = currentInputSchema.map((field: any) => {
  if (configValues.hasOwnProperty(field.name)) {
    return {
      ...field,
      default_value: configValues[field.name]
    }
  }
  return field
})

// Add any config fields that don't exist in input_schema yet
Object.entries(configValues).forEach(([key, value]) => {
  const existsInSchema = currentInputSchema.some((f: any) => f.name === key)
  if (!existsInSchema) {
    updatedInputSchema.push({
      name: key,
      type: 'string',
      required: false,
      default_value: value,
      description: `Configuration value for {{config.${key}}}`
    })
  }
})

await supabase
  .from('agents')
  .update({ input_schema: updatedInputSchema })
  .eq('id', agent.id)
```

### 2. WorkflowPilot - Read config from input_schema (lib/pilot/WorkflowPilot.ts)

**Old approach** (lines 169-194):
- Only looked for `workflow_config` field
- Would return empty object if field didn't exist

**New approach** (lines 169-207):
```typescript
private extractWorkflowConfig(agent: Agent): Record<string, any> {
  const config: Record<string, any> = {};

  // Extract config from input_schema (default_value fields)
  if (agent.input_schema && Array.isArray(agent.input_schema)) {
    for (const field of agent.input_schema) {
      if (field.default_value !== undefined && field.default_value !== null && field.default_value !== '') {
        config[field.name] = field.default_value;
      }
    }
  }

  // Fallback: Check if agent has legacy workflow_config field
  if ((agent as any).workflow_config) {
    const wfConfig = (agent as any).workflow_config;
    // ... merge legacy config
  }

  return config;
}
```

### 3. TypeScript Interface Update

Removed `workflow_config` from Agent interface since we're not using it:

```typescript
interface Agent {
  id: string
  agent_name: string
  description?: string
  pilot_steps?: any[]
  workflow_steps?: any[]
  input_parameters?: any[]
  input_schema?: any[]
  user_id: string
  enhanced_prompt?: string | any
}
```

## How It Works

### 1. User fills config form with values:
```javascript
{
  "google_sheet_id": "abc123",
  "drive_folder_name": "Invoices",
  "user_email": "user@example.com",
  "amount_threshold_usd": "50",
  "sheet_tab_name": "Sheet1"
}
```

### 2. Saved to agent.input_schema:
```json
[
  {
    "name": "google_sheet_id",
    "type": "string",
    "required": false,
    "default_value": "abc123",
    "description": "Configuration value for {{config.google_sheet_id}}"
  },
  {
    "name": "drive_folder_name",
    "type": "string",
    "required": false,
    "default_value": "Invoices",
    "description": "Configuration value for {{config.drive_folder_name}}"
  },
  ...
]
```

### 3. WorkflowPilot reads agent.input_schema:
```javascript
extractWorkflowConfig(agent)
// Returns: { google_sheet_id: "abc123", drive_folder_name: "Invoices", ... }
```

### 4. Workflow execution replaces {{config.X}}:
```javascript
// Step config: { folder_name: "{{config.drive_folder_name}}" }
// After substitution: { folder_name: "Invoices" }
```

## Benefits

1. **No migration needed** - Uses existing column
2. **Backward compatible** - Still checks legacy `workflow_config` if it exists
3. **Type safe** - input_schema is already typed as `any[]` in Agent interface
4. **Logging added** - Can see config extraction in console/server logs

## Testing

1. Fill config form in calibration setup
2. Click "Save & Continue"
3. Check console logs:
   - `[Sandbox] Saving config values to input_schema:`
   - `[Sandbox] Updated input_schema:`
   - `[Sandbox] Supabase update result: { success: true }`
4. Calibration runs
5. Check server logs:
   - `[WorkflowPilot] Extracting config from input_schema:`
   - `[WorkflowPilot] Found config value: google_sheet_id = abc123`
   - `[WorkflowPilot] Final extracted config:`

## Files Modified

1. **app/v2/sandbox/[agentId]/page.tsx**
   - Save config to `input_schema` instead of `workflow_config` (lines 326-385)
   - Removed `workflow_config` from Agent interface (lines 33-43)

2. **lib/pilot/WorkflowPilot.ts**
   - Read config from `input_schema.default_value` (lines 169-207)
   - Added logging for debugging

## Status

✅ **COMPLETE** - Config values now stored in input_schema and accessible during workflow execution.
