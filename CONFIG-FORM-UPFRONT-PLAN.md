# Configuration Form - Upfront Approach (Simplified UX)

## Problem

Current implementation shows configuration_missing as a "critical issue" after the workflow fails. This is too technical for non-technical users.

## Better UX: Configuration as Pre-Requisite

Show configuration form BEFORE calibration runs, similar to how we handle input parameters.

## Implementation Plan

###  1. Extract Config Schema

When loading agent in sandbox page (around line 184):

```typescript
// Extract config schema from IntentContract
let configSchema: Array<{key: string, type: string, description: string, default?: any}> = []
if (data.enhanced_prompt) {
  try {
    const enhancedPrompt = typeof data.enhanced_prompt === 'string'
      ? JSON.parse(data.enhanced_prompt)
      : data.enhanced_prompt

    // IntentContract has config array
    if (enhancedPrompt?.config && Array.isArray(enhancedPrompt.config)) {
      configSchema = enhancedPrompt.config
    }
  } catch (e) {
    // Parsing failed
  }
}
```

### 2. Check Missing Config Values

```typescript
// Check which config keys are missing from agent.workflow_config
const missingConfigKeys = configSchema.filter(configItem => {
  const currentValue = data.workflow_config?.[configItem.key]
  return currentValue === undefined || currentValue === null || currentValue === ''
})
```

### 3. Show Config Form BEFORE Calibration

If `missingConfigKeys.length > 0`:

**Show a friendly setup form:**

```
┌─────────────────────────────────────────────────────┐
│  Workflow Configuration                             │
│                                                      │
│  This workflow needs a few settings before          │
│  it can run. Please provide the following:          │
│                                                      │
│  📧 user email                                      │
│  [input field] (Description: Email to send summary) │
│                                                      │
│  📊 google sheet id                                 │
│  [input field] (Description: Spreadsheet ID)        │
│                                                      │
│  📁 drive folder name                               │
│  [input field] (Description: Folder for files)      │
│                                                      │
│  [Save Configuration] button                         │
└─────────────────────────────────────────────────────┘
```

**Key points:**
- Use existing `AgentInputFields` component (reuse code!)
- Convert config schema to input field schema format
- Show descriptions from IntentContract
- Pre-fill with default values if available

### 4. Save Configuration to Database

When user clicks "Save Configuration":

```typescript
const handleSaveConfiguration = async () => {
  // Merge user-provided values with existing workflow_config
  const updatedConfig = {
    ...(agent.workflow_config || {}),
    ...configValues  // Values from form
  }

  // Update agent in database
  const { error } = await supabase
    .from('agents')
    .update({ workflow_config: updatedConfig })
    .eq('id', agent.id)

  if (!error) {
    setAgent({ ...agent, workflow_config: updatedConfig })
    setConfigurationComplete(true)
    // Now user can start calibration
  }
}
```

### 5. Disable Calibration Until Config Complete

```typescript
const canStartCalibration = configurationComplete || missingConfigKeys.length === 0

<button
  disabled={!canStartCalibration}
  onClick={handleRunCalibration}
>
  {canStartCalibration ? 'Start Calibration' : 'Complete Configuration First'}
</button>
```

## Implementation Location

**File:** `/app/v2/sandbox/[agentId]/page.tsx`

**Changes needed:**
1. Add state: `const [configSchema, setConfigSchema] = useState<any[]>([])`
2. Add state: `const [missingConfigKeys, setMissingConfigKeys] = useState<any[]>([])`
3. Add state: `const [configurationComplete, setConfigurationComplete] = useState(false)`
4. In `loadAgent()`: Extract config schema and check missing keys
5. In render: Show config form if `missingConfigKeys.length > 0`
6. Add handler: `handleSaveConfiguration()`

**Reuse existing components:**
- Use `<AgentInputFields>` for rendering form fields
- Convert config schema to input field schema format:
  ```typescript
  const configAsInputFields = configSchema.map(item => ({
    name: item.key,
    type: item.type,
    label: item.key.replace(/_/g, ' '),
    description: item.description,
    required: item.default === undefined,
    default_value: item.default
  }))
  ```

## User Flow

1. User opens agent sandbox
2. Page checks if workflow_config has all required keys
3. **If missing:**
   - Show friendly "Workflow Configuration" form
   - User fills in missing values
   - Click "Save Configuration"
   - Form disappears, calibration button enabled
4. **If complete:**
   - Show normal calibration UI
   - User can start calibration immediately

## Benefits

- ✅ No technical "issues" or error messages
- ✅ Configuration feels like normal setup, not a bug fix
- ✅ Reuses existing form components (AgentInputFields)
- ✅ Validates before execution (fail fast)
- ✅ Saves permanently in database
- ✅ Non-technical users understand what's needed

## Fallback: If Config Missing During Execution

Keep the existing `configuration_missing` detection as a fallback for:
- Workflows created before this feature
- Manual workflow edits that add new config references
- Edge cases where database update failed

But for new workflows from V6 pipeline, the upfront form should catch all missing config.

## Example: Invoice Extraction

When user first opens the invoice extraction agent, they see:

```
Workflow Configuration

Your workflow needs these settings to run:

📧 User Email
[offir.omer@gmail.com          ]
Where to send the summary email

📊 Google Sheet ID
[1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc]
Spreadsheet for logging transactions

📁 Drive Folder Name
[                               ]  ← User must fill this
Folder name for storing attachments

💰 Amount Threshold (USD)
[50                             ]
Minimum amount to log

📄 Sheet Tab Name
[Expenses                       ]
Tab name in the spreadsheet

[Save Configuration]
```

Once saved → form disappears and calibration is ready to run.
