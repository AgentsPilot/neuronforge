# Workflow Configuration Calibration Solution

## Problem
When workflows reference `{{config.key}}` variables that don't have values, execution fails with parameter errors like:
- "folder_name is required" (resolved to "")
- "Spreadsheet not found: ''" (resolved to "")
- "Recipient address required" (resolved to "")

These aren't workflow bugs - they're missing configuration values that users need to provide.

## Solution: Detect Missing Config During Calibration

### 1. Type System Updates

**File: [lib/pilot/types.ts](lib/pilot/types.ts)**

Added `'configuration_missing'` to CollectedIssue categories:
```typescript
category: 'parameter_error' | 'hardcode_detected' | 'data_shape_mismatch' |
          'logic_error' | 'execution_error' | 'data_unavailable' | 'configuration_missing';
```

Added `'configuration_required'` to suggestedFix types:
```typescript
type: 'parameter_correction' | 'parameterization' | 'data_repair' |
      'logic_suggestion' | 'configuration_required' | 'workflow_structure';
```

Added `workflowConfig` to IExecutionContext interface:
```typescript
export interface IExecutionContext {
  // ...
  workflowConfig: Record<string, any>; // Workflow configuration parameters
  // ...
}
```

### 2. Runtime Config Resolution Support

**File: [lib/pilot/ExecutionContext.ts](lib/pilot/ExecutionContext.ts)**

- Added `workflowConfig` property to store configuration values
- Updated `resolveSimpleVariable()` to handle `{{config.key}}` references
- Updated constructor to accept and store workflowConfig
- Updated `clone()` to preserve workflowConfig in cloned contexts

**File: [lib/pilot/WorkflowPilot.ts](lib/pilot/WorkflowPilot.ts)**

- Added `extractWorkflowConfig()` method to extract config from Agent
- Updated ExecutionContext initialization to pass workflowConfig
- Supports both object and array config formats from IntentContract

### 3. Calibration Detection Logic

**File: [lib/pilot/shadow/IssueCollector.ts](lib/pilot/shadow/IssueCollector.ts)**

Added `detectMissingWorkflowConfig()` method that:
1. Scans step parameters recursively for `{{config.X}}` patterns
2. Checks if those config keys exist in `context.workflowConfig`
3. Returns list of missing config keys and affected parameters

Updated `collectFromError()` to:
1. Check for missing config BEFORE checking parameter errors
2. Categorize as `'configuration_missing'` with high severity
3. Create suggestedFix with type `'configuration_required'`

```typescript
private detectMissingWorkflowConfig(
  errorMessage: string,
  stepParams: any,
  context: ExecutionContext
): { configKeys: string[], affectedParameters: string[] } | null {
  // Recursively scan for {{config.X}} patterns
  // Check if config values are undefined/null/empty
  // Return missing keys
}
```

### 4. UI Form for Config Values

**File: [components/v2/calibration/IssueCard.tsx](components/v2/calibration/IssueCard.tsx)**

Added `ConfigurationMissingCard` component that:
- Displays explanation: "Missing workflow configuration"
- Shows input fields for each missing config key
- Stores values using `onFixChange` callback (similar to parameter errors)
- Uses unique keys: `${issue.id}_${configKey}` for each config value

Example UI:
```
┌─────────────────────────────────────────────┐
│ ⚠️ Missing Workflow Configuration           │
│                                             │
│ This workflow requires configuration        │
│ values that haven't been set.              │
│                                             │
│ user_email:                                │
│ [input field]                              │
│                                             │
│ google_sheet_id:                           │
│ [input field]                              │
│                                             │
│ drive_folder_name:                         │
│ [input field]                              │
└─────────────────────────────────────────────┘
```

## How It Works: Complete Flow

### Step 1: Workflow Generated with Config References
IntentContract contains config array:
```json
{
  "config": [
    {"key": "user_email", "type": "string", "default": "user@example.com"},
    {"key": "google_sheet_id", "type": "string"},
    {"key": "drive_folder_name", "type": "string"}
  ]
}
```

PILOT DSL steps reference config:
```json
{
  "step_id": "step4",
  "config": {
    "folder_name": "{{config.drive_folder_name}}"
  }
}
```

### Step 2: Calibration Runs Without Config
- User hasn't provided config values yet
- `agent.workflow_config` is empty or missing keys
- ExecutionContext created with empty workflowConfig

### Step 3: Missing Config Detected
When step executes:
1. `{{config.drive_folder_name}}` resolves to empty string
2. Plugin action fails: "folder_name is required"
3. IssueCollector intercepts error
4. `detectMissingWorkflowConfig()` scans step params
5. Finds `{{config.drive_folder_name}}` reference
6. Checks `context.workflowConfig['drive_folder_name']` → empty
7. Returns: `{configKeys: ['drive_folder_name'], affectedParameters: ['folder_name']}`

### Step 4: Issue Categorized
IssueCollector creates CollectedIssue:
```typescript
{
  category: 'configuration_missing',
  severity: 'high',
  title: 'Missing workflow configuration',
  message: 'Workflow requires configuration values: drive_folder_name',
  suggestedFix: {
    type: 'configuration_required',
    action: {
      configKeys: ['drive_folder_name'],
      affectedParameters: ['folder_name']
    }
  }
}
```

### Step 5: UI Shows Config Form
CalibrationDashboard renders ConfigurationMissingCard:
- Displays input field for "drive_folder_name"
- User enters value: "Invoice Receipts"
- Value stored in fixes: `{[issueId + '_drive_folder_name']: {value: 'Invoice Receipts'}}`

### Step 6: Fix Applied
When user clicks "Apply Fixes & Re-run":
1. Frontend extracts config values from fixes
2. Updates `agent.workflow_config` with provided values
3. Re-runs calibration with populated config
4. `{{config.drive_folder_name}}` now resolves to "Invoice Receipts"
5. Step executes successfully ✓

## Key Design Principles

### 1. Early Detection (Before Parameter Errors)
Check for missing config BEFORE checking parameter errors, because:
- Missing config causes parameter errors downstream
- We want to categorize root cause, not symptom
- User should provide config, not try to fix parameter errors

### 2. Configuration vs Parameter Distinction
- **Configuration Missing**: `{{config.X}}` references that need values
- **Parameter Error**: Wrong/invalid values in step parameters
- Configuration is about missing setup, not wrong workflow logic

### 3. Similar UX to Parameter Errors
- Both show input forms (familiar pattern)
- Both are "Critical" severity
- Both block execution until fixed
- Both use same fix storage mechanism

### 4. No Manual Database Updates
- User provides config through UI form
- System stores in agent.workflow_config
- Real-life scenario: user configures workflow during calibration

## Files Modified

1. **[lib/pilot/types.ts](lib/pilot/types.ts:846-870)** - Added 'configuration_missing' category and 'configuration_required' fix type, added workflowConfig to IExecutionContext
2. **[lib/pilot/ExecutionContext.ts](lib/pilot/ExecutionContext.ts:30-90)** - Added workflowConfig support
3. **[lib/pilot/WorkflowPilot.ts](lib/pilot/WorkflowPilot.ts)** - Added extractWorkflowConfig() and config passing
4. **[lib/pilot/shadow/IssueCollector.ts](lib/pilot/shadow/IssueCollector.ts:76-156)** - Added detectMissingWorkflowConfig() and early detection logic
5. **[components/v2/calibration/IssueCard.tsx](components/v2/calibration/IssueCard.tsx:40-100)** - Added ConfigurationMissingCard component

## Testing

To test the complete flow:

1. Run calibration on invoice extraction workflow:
```bash
npm run test:script scripts/test-complete-pipeline-with-vocabulary.ts
```

2. Execute the workflow (will fail with missing config):
```bash
# In UI: Navigate to agent sandbox and click "Start Calibration"
```

3. Verify config detection:
- Should see "Missing workflow configuration" card
- Input fields for: user_email, google_sheet_id, drive_folder_name, sheet_tab_name, amount_threshold_usd
- NOT categorized as parameter_error

4. Fill in config values and re-run:
- Enter values in form
- Click "Apply Fixes & Re-run"
- Workflow should execute successfully

## Future Enhancements

1. **Default Values from IntentContract**: Pre-populate input fields with default values from config array
2. **Config Validation**: Validate config format (email, URL, number) before accepting
3. **Config Persistence**: Store common config values (user_email, sheet_id) across workflows
4. **Batch Config Import**: Allow uploading .env file or JSON with all config values
5. **Config Documentation**: Show description/hints for each config key in UI
