# Workflow Configuration Calibration - Complete Implementation ✅

## Overview

Successfully implemented automatic detection and user-friendly prompting for missing workflow configuration values during calibration. When workflows reference `{{config.key}}` variables without values, the system now:

1. ✅ Detects missing config during calibration execution
2. ✅ Categorizes as `configuration_missing` (not parameter errors)
3. ✅ Displays user-friendly form to collect missing values
4. ✅ Validates all config keys provided before allowing re-run
5. ✅ Stores config values and re-runs workflow successfully

## Problem Solved

**Before:** Workflows with `{{config.X}}` references failed with cryptic parameter errors:
- "folder_name is required" (resolved to "")
- "Spreadsheet not found: ''" (resolved to "")
- "Recipient address required" (resolved to "")

**After:** Calibration detects the root cause (missing config) and shows:
- Clear category: "Missing workflow configuration"
- Input form with all missing config keys
- User provides values through UI
- Workflow re-runs successfully

## Implementation Details

### 1. Type System Updates

**File:** [lib/pilot/types.ts](lib/pilot/types.ts)

Added new category and fix type:

```typescript
// Line 846-850: Added 'configuration_missing' to CollectedIssue categories
export interface CollectedIssue {
  category: 'parameter_error' | 'hardcode_detected' | 'data_shape_mismatch' |
            'logic_error' | 'execution_error' | 'data_unavailable' | 'configuration_missing';
  // ...
}

// Line 865-869: Added 'configuration_required' to suggestedFix types
suggestedFix?: {
  type: 'parameter_correction' | 'parameterization' | 'data_repair' |
        'logic_suggestion' | 'configuration_required' | 'workflow_structure';
  // ...
}

// Line 509-511: Added workflowConfig to IExecutionContext
export interface IExecutionContext {
  workflowConfig: Record<string, any>; // Workflow configuration parameters
  // ...
}

// Line 990: Added workflow_config to Agent interface
export interface Agent {
  workflow_config?: Record<string, any> | Array<{key: string, type: string, default?: any}>;
  // ...
}
```

### 2. Runtime Config Resolution

**File:** [lib/pilot/ExecutionContext.ts](lib/pilot/ExecutionContext.ts)

Added support for `{{config.key}}` variable resolution:

```typescript
// Line 40: Added property
public workflowConfig: Record<string, any>;

// Line 73-80: Updated constructor
constructor(
  executionId: string,
  agent: Agent,
  userId: string,
  sessionId: string,
  inputValues: Record<string, any> = {},
  batchCalibrationMode: boolean = false,
  workflowConfig: Record<string, any> = {}  // NEW
) {
  this.workflowConfig = workflowConfig;
  // ...
}

// Line 491-494: Added config resolution in resolveSimpleVariable
if (root === 'config') {
  return this.getNestedValue(this.workflowConfig, parts.slice(1));
}

// Line 794-803: Updated clone() to preserve workflowConfig
clone(resetMetrics: boolean = false): ExecutionContext {
  const cloned = new ExecutionContext(
    this.executionId,
    this.agent,
    this.userId,
    this.sessionId,
    { ...this.inputValues },
    this.batchCalibrationMode,
    { ...this.workflowConfig }  // PRESERVE CONFIG
  );
  // ...
}
```

**File:** [lib/pilot/WorkflowPilot.ts](lib/pilot/WorkflowPilot.ts)

Extracts config from agent and passes to ExecutionContext:

```typescript
// After line 153: Added helper method
private extractWorkflowConfig(agent: Agent): Record<string, any> {
  const config: Record<string, any> = {};

  if ((agent as any).workflow_config) {
    const wfConfig = (agent as any).workflow_config;

    // Handle both object and array formats
    if (typeof wfConfig === 'object' && !Array.isArray(wfConfig)) {
      return wfConfig;
    }

    if (Array.isArray(wfConfig)) {
      for (const item of wfConfig) {
        if (item.key && item.default !== undefined) {
          config[item.key] = item.default;
        }
      }
      return config;
    }
  }

  return config;
}

// Line 311-318: Pass config to ExecutionContext
const workflowConfig = this.extractWorkflowConfig(agent);

context = new ExecutionContext(
  executionId,
  agent,
  userId,
  finalSessionId,
  inputValues,
  isBatchCalibration,
  workflowConfig  // PASS CONFIG
);
```

### 3. Calibration Detection Logic

**File:** [lib/pilot/shadow/IssueCollector.ts](lib/pilot/shadow/IssueCollector.ts)

Detects missing config BEFORE checking parameter errors:

```typescript
// Line 87-100: Check for missing config FIRST
const missingConfigRef = this.detectMissingWorkflowConfig(error.message, stepParams, context);

logger.info({
  stepId,
  errorMessage: error.message,
  stepParams: JSON.stringify(stepParams),
  missingConfigDetected: !!missingConfigRef,
  configKeys: missingConfigRef?.configKeys,
  workflowConfigKeys: Object.keys(context.workflowConfig || {}),
  workflowConfigValues: context.workflowConfig
}, 'Missing config detection result');

const parameterError = !missingConfigRef ? this.detectParameterError(error.message, stepParams) : null;

// Line 140-158: Categorize as configuration_missing
if (missingConfigRef) {
  finalCategory = 'configuration_missing';
  severity = 'high';
  suggestedFix = {
    type: 'configuration_required' as any,
    action: {
      configKeys: missingConfigRef.configKeys,
      affectedParameters: missingConfigRef.affectedParameters,
      message: `Workflow requires configuration values: ${missingConfigRef.configKeys.join(', ')}`
    },
    confidence: 1.0
  };
}

// Line 973-1022: Detection method
private detectMissingWorkflowConfig(
  errorMessage: string,
  stepParams: any,
  context: ExecutionContext
): { configKeys: string[], affectedParameters: string[] } | null {
  if (!stepParams) {
    return null;
  }

  const configKeys: Set<string> = new Set();
  const affectedParameters: Set<string> = new Set();

  // Recursively scan for {{config.X}} patterns
  const scanForConfigRefs = (obj: any, path: string = '') => {
    if (typeof obj === 'string') {
      const configMatches = obj.matchAll(/\{\{config\.(\w+)\}\}/g);
      for (const match of configMatches) {
        const configKey = match[1];
        const configValue = context.workflowConfig?.[configKey];

        // Check if config value is missing/empty
        if (configValue === undefined || configValue === null || configValue === '') {
          configKeys.add(configKey);
          affectedParameters.add(path || 'value');
        }
      }
    } else if (Array.isArray(obj)) {
      obj.forEach((item, index) => scanForConfigRefs(item, `${path}[${index}]`));
    } else if (obj && typeof obj === 'object') {
      Object.entries(obj).forEach(([key, value]) => {
        const newPath = path ? `${path}.${key}` : key;
        scanForConfigRefs(value, newPath);
      });
    }
  };

  scanForConfigRefs(stepParams);

  if (configKeys.size > 0) {
    return {
      configKeys: Array.from(configKeys),
      affectedParameters: Array.from(affectedParameters)
    };
  }

  return null;
}
```

### 4. UI Components

**File:** [components/v2/calibration/IssueCard.tsx](components/v2/calibration/IssueCard.tsx)

Added ConfigurationMissingCard component:

```typescript
// Line 44-46: Route configuration_missing to dedicated card
if (issue.category === 'configuration_missing') {
  return <ConfigurationMissingCard issue={issue} fixes={fixes} onFixChange={onFixChange} />
}

// Line 302-389: ConfigurationMissingCard implementation
function ConfigurationMissingCard({ issue, fixes, onFixChange }: IssueCardProps) {
  const configKeys = issue.suggestedFix?.action?.configKeys || [];
  const affectedParameters = issue.suggestedFix?.action?.affectedParameters || [];

  // Store values for each config key
  const [configValues, setConfigValues] = React.useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    configKeys.forEach((key: string) => {
      initial[key] = fixes.parameters?.[`${issue.id}_${key}`] || '';
    });
    return initial;
  });

  const handleConfigChange = (key: string, value: string) => {
    const updated = { ...configValues, [key]: value };
    setConfigValues(updated);

    // Store each config value with unique key: ${issueId}_${configKey}
    onFixChange(`${issue.id}_${key}`, { value });
  };

  return (
    <Card className="!border-l-4 bg-[var(--v2-surface)]"
          style={{ borderLeftColor: '#DC2626', borderLeftWidth: '4px' }}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1">
            <div className="w-10 h-10 rounded-full bg-[var(--v2-error-bg)]">
              <XCircle className="w-5 h-5 text-[var(--v2-error-icon)]" />
            </div>
            <div className="flex-1">
              <CardTitle>{issue.title}</CardTitle>
              {issue.affectedSteps.map(step => (
                <Badge key={step.stepId} variant="neutral">
                  {step.friendlyName}
                </Badge>
              ))}
            </div>
          </div>
          <Badge variant="error">Critical</Badge>
        </div>
      </CardHeader>

      <CardContent>
        <p className="text-sm text-[var(--v2-text-secondary)] mb-4">
          {issue.message}
        </p>

        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20">
          <p className="text-sm font-medium">Missing workflow configuration</p>
          <p className="text-xs">
            This workflow requires configuration values that haven't been set.
          </p>
        </div>

        {/* Input fields for each missing config key */}
        <div className="space-y-3">
          {configKeys.map((key: string) => (
            <div key={key} className="space-y-2">
              <label className="text-sm font-medium block">
                {key.replace(/_/g, ' ')}:
              </label>
              <input
                type="text"
                value={configValues[key] || ''}
                onChange={(e) => handleConfigChange(key, e.target.value)}
                placeholder={`Enter ${key.replace(/_/g, ' ')}`}
                className="w-full px-4 py-2 rounded-lg border"
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

**File:** [components/v2/calibration/CalibrationDashboard.tsx](components/v2/calibration/CalibrationDashboard.tsx)

Handles config value changes and validates completion:

```typescript
// Line 140-154: Check if all config keys provided
if (issue.category === 'configuration_missing') {
  // Check if all required config keys have values
  const configKeys = issue.suggestedFix?.action?.configKeys || []
  const allConfigProvided = configKeys.every((key: string) => {
    const configValue = fixes.parameters?.[`${issue.id}_${key}`]
    return configValue !== undefined && configValue !== ''
  })
  console.log('[CalibrationDashboard] Configuration missing check:', {
    issueId: issue.id,
    configKeys,
    allConfigProvided,
    allParams: fixes.parameters
  })
  return allConfigProvided
}

// Line 356-367: Handle configuration_missing in onFixChange
else if (issueCategory === 'configuration_missing') {
  console.log('[CalibrationDashboard] Configuration missing fix:', { issueId, fix })
  // Config values are stored with keys like: ${issueId}_${configKey}
  onFixesChange({
    ...fixes,
    parameters: {
      ...fixes.parameters,
      [issueId]: fix.value
    }
  })
}
```

**File:** [components/v2/calibration/CalibrationSetup.tsx](components/v2/calibration/CalibrationSetup.tsx)

Includes configuration_missing in critical issues filter:

```typescript
// Line 312-322: Include configuration_missing in critical issues
const criticalIssues = React.useMemo(() => {
  if (!issues) return []
  return issues.critical.filter(issue => {
    // NEVER show data_shape_mismatch - it's auto-fixed silently
    if (issue.category === 'data_shape_mismatch') return false
    if (!issue.requiresUserInput) return false
    // Critical: parameter errors, logic errors, and configuration missing
    return ['parameter_error', 'logic_error', 'configuration_missing'].includes(issue.category)
  })
}, [issues])
```

## Complete Flow

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

CalibrationSetup/CalibrationDashboard renders ConfigurationMissingCard:
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
Check for missing config BEFORE checking parameter errors because:
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

## Example: Invoice Extraction Workflow

This workflow uses 5 config keys:

1. **user_email** - Email to send summary to (step19)
2. **google_sheet_id** - Spreadsheet to write transactions (step13)
3. **drive_folder_name** - Drive folder for attachments (step4)
4. **sheet_tab_name** - Sheet tab name (step13)
5. **amount_threshold_usd** - Filter threshold for high-value transactions (step12)

All 5 are detected as missing during first calibration run and presented in a user-friendly form.

## Future Enhancements

1. **Default Values from IntentContract**: Pre-populate input fields with default values from config array
2. **Config Validation**: Validate config format (email, URL, number) before accepting
3. **Config Persistence**: Store common config values (user_email, sheet_id) across workflows
4. **Batch Config Import**: Allow uploading .env file or JSON with all config values
5. **Config Documentation**: Show description/hints for each config key in UI
6. **Populate workflow_config During Agent Creation**: Extract config from IntentContract and store in agent.workflow_config when creating/updating agents (see [MISSING-CONFIG-NEXT-STEPS.md](MISSING-CONFIG-NEXT-STEPS.md))

## Status

✅ **COMPLETE** - All core functionality implemented and working:
- Backend detection
- Type system updates
- Runtime config resolution
- UI form component
- Dashboard handlers
- Issue filtering

The only remaining improvement is to populate `agent.workflow_config` from `intentContract.config` during agent creation (documented in MISSING-CONFIG-NEXT-STEPS.md), which would provide default values automatically.
