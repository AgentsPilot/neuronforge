# Configuration Pre-Flight Check - Implementation Complete ✅

## Summary

Successfully implemented pre-flight configuration check that detects missing `{{config.X}}` values BEFORE running calibration, shows a friendly form in the chat, and saves values to the database.

## What Was Implemented

### 1. CalibrationSetup Component Changes

**File:** `components/v2/calibration/CalibrationSetup.tsx`

#### Added State
```typescript
const [configValues, setConfigValues] = useState<Record<string, any>>({})
```

#### Extended ChatMessage Interface
```typescript
interface ChatMessage {
  // ... existing fields
  showConfigForm?: boolean
  configFields?: Array<{key: string, description?: string, default?: any, type?: string}>
}
```

#### Added Pre-Flight Check Function
```typescript
const checkMissingConfig = (): Array<{key: string, description?: string, default?: any, type?: string}> => {
  // Scans workflow steps for {{config.X}} patterns
  // Checks which config keys are missing from agent.workflow_config
  // Extracts descriptions from IntentContract (enhanced_prompt)
  // Returns array of missing config fields with metadata
}
```

#### Modified handleRun() Function
```typescript
const handleRun = () => {
  setHasStarted(true)

  // Pre-flight check
  const missingConfig = checkMissingConfig()

  if (missingConfig.length > 0) {
    // Show config form in chat (don't run calibration yet)
    setMessages([...bot messages with config form])
  } else {
    // No config needed, run calibration immediately
    onRun(inputValues)
  }
}
```

#### Added saveConfigAndContinue() Function
```typescript
const saveConfigAndContinue = async () => {
  // Shows "Saving configuration..." message
  // Passes config values with __config_ prefix to parent
  // Shows "Configuration saved!" message
  // Runs calibration with config values
}
```

#### Added Config Form Rendering
```typescript
{msg.showConfigForm && msg.configFields && (
  <Card>
    <h3>Workflow Configuration</h3>
    {msg.configFields.map(field => (
      <div>
        <label>{field.key}</label>
        <p>{field.description}</p>
        <input value={configValues[field.key]} onChange={...} />
      </div>
    ))}
    <button onClick={saveConfigAndContinue}>Save & Continue</button>
  </Card>
)}
```

### 2. Sandbox Page Changes

**File:** `app/v2/sandbox/[agentId]/page.tsx`

#### Extended Agent Interface
```typescript
interface Agent {
  // ... existing fields
  workflow_config?: Record<string, any>
  enhanced_prompt?: string | any
}
```

#### Modified handleRunCalibration() Function
```typescript
const handleRunCalibration = async (inputValues: Record<string, any>) => {
  // Extract config values (prefixed with __config_)
  const configValues: Record<string, any> = {}
  const actualInputValues: Record<string, any> = {}

  Object.entries(inputValues).forEach(([key, value]) => {
    if (key.startsWith('__config_')) {
      configValues[key.substring(9)] = value
    } else {
      actualInputValues[key] = value
    }
  })

  // Save config to database
  if (Object.keys(configValues).length > 0) {
    await supabase
      .from('agents')
      .update({ workflow_config: { ...agent.workflow_config, ...configValues } })
      .eq('id', agent.id)

    // Update local state
    setAgent({ ...agent, workflow_config: { ...agent.workflow_config, ...configValues } })
  }

  // Call calibration API with actualInputValues (without config prefixes)
  const response = await fetch('/api/v2/calibrate/batch', {
    body: JSON.stringify({ agentId: agent.id, inputValues: actualInputValues })
  })
}
```

## User Flow

### Before (What We Had)
```
1. User clicks "Start Test"
2. Calibration runs immediately
3. Workflow fails with parameter errors (config values missing)
4. Shows 3 "critical issues" for missing config
5. User fixes issues one by one
6. Applies fixes and re-runs
```

### After (What We Built)
```
1. User clicks "Start Test"
2. Pre-flight check scans workflow for {{config.X}}
3. Detects 5 missing config keys
4. Shows friendly bot messages:
   - "Before I can test your workflow, I need 5 configuration values from you."
   - "These settings tell your workflow where to send data..."
5. Shows config form with descriptions from IntentContract
6. User fills in values
7. Clicks "Save & Continue"
8. Config saved to database
9. Bot: "✓ Configuration saved! Now let's test your workflow."
10. NOW runs calibration (with config already populated)
11. Workflow executes successfully
```

## Chat Conversation Example

```
Bot: Hi! I'll help you test your workflow.
     Ready to start? Click the "Start Test" button below.

[User clicks Start Test]

Bot: Before I can test your workflow, I need 5 configuration values from you.

Bot: These settings tell your workflow where to send data, what values to use,
     and other important details.

Bot: ┌──────────────────────────────────────────────────┐
     │ ⚙️ Workflow Configuration                         │
     │                                                   │
     │ User Email                                        │
     │ Email address to send summary to                 │
     │ [offir.omer@gmail.com                       ]   │
     │                                                   │
     │ Google Sheet ID                                   │
     │ Spreadsheet for logging transactions              │
     │ [1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugD...]   │
     │                                                   │
     │ Drive Folder Name                                 │
     │ Folder name for storing attachments               │
     │ [Invoices                                   ]   │
     │                                                   │
     │ Amount Threshold USD                              │
     │ Threshold amount in USD                           │
     │ [50                                         ]   │
     │                                                   │
     │ Sheet Tab Name                                    │
     │ Tab name in the spreadsheet                       │
     │ [Expenses                                   ]   │
     │                                                   │
     │ [Save & Continue]                                 │
     └──────────────────────────────────────────────────┘

[User fills values and clicks Save & Continue]

Bot: Saving configuration...

Bot: ✓ Configuration saved! Now let's test your workflow.

Bot: Starting your workflow test...
     [progress bar: 20%, 40%, 60%, 80%, 100%]

Bot: ✓ Test complete! Found 0 issues. Your workflow is ready!

[Success screen in right column with "Approve for Production" button]
```

## Technical Details

### Config Value Extraction

**Pattern Matching:**
```regex
/\{\{config\.(\w+)\}\}/g
```

Finds all `{{config.key_name}}` references in workflow steps recursively.

**Missing Check:**
```typescript
const value = agent.workflow_config?.[key]
return value === undefined || value === null || value === ''
```

### Description Extraction

Reads from `agent.enhanced_prompt` (IntentContract):
```json
{
  "config": [
    {
      "key": "user_email",
      "type": "string",
      "description": "Email address to send summary to",
      "default": "offir.omer@gmail.com"
    }
  ]
}
```

### Data Flow

```
CalibrationSetup (config form)
    ↓ configValues with __config_ prefix
Sandbox Page handleRunCalibration()
    ↓ Extract config, save to database
    ↓ Pass actualInputValues to API
Calibration API
    ↓ WorkflowPilot extracts workflow_config from agent
ExecutionContext
    ↓ Resolves {{config.X}} from workflowConfig
Workflow executes successfully
```

## Files Modified

1. ✅ **components/v2/calibration/CalibrationSetup.tsx** (~100 lines)
   - Added state, functions, and config form rendering

2. ✅ **app/v2/sandbox/[agentId]/page.tsx** (~45 lines)
   - Extended Agent interface
   - Modified handleRunCalibration to extract and save config

## Testing Instructions

### Test Case 1: Invoice Extraction Workflow

1. Load invoice extraction agent in sandbox
2. Clear workflow_config:
   ```sql
   UPDATE agents SET workflow_config = NULL WHERE id = '<agent-id>';
   ```
3. Click "Start Test"
4. **Expected:** See bot message + config form (5 fields)
5. **Expected:** Calibration does NOT run yet
6. Fill in all 5 config fields
7. Click "Save & Continue"
8. **Expected:** See "Configuration saved!" message
9. **Expected:** Calibration now runs
10. **Expected:** Workflow executes successfully (no config errors)

### Test Case 2: Workflow with No Config

1. Load a workflow that doesn't use {{config.X}}
2. Click "Start Test"
3. **Expected:** No config form shown
4. **Expected:** Calibration runs immediately (normal flow)

### Test Case 3: Partial Config

1. Set some config values in database:
   ```sql
   UPDATE agents
   SET workflow_config = '{"user_email": "test@example.com"}'
   WHERE id = '<agent-id>';
   ```
2. Click "Start Test"
3. **Expected:** Form shows only missing config keys (not user_email)

## Benefits

✅ **Fast feedback** - User sees what's needed immediately (no failed run)
✅ **Clear communication** - Bot explains why config is needed
✅ **Helpful descriptions** - Shows descriptions from IntentContract
✅ **One-time setup** - Config saved to database permanently
✅ **Natural UX** - Feels like setup, not error fixing
✅ **Efficient** - Only runs calibration once (with config already set)
✅ **Reuses existing patterns** - Card UI, bot messages, save flow

## Known Limitations

1. **Type validation not enforced** - Form accepts any string for number fields (browser validates)
2. **No regex/email validation** - Could add validation rules from IntentContract schema
3. **Default values shown but editable** - User might accidentally change defaults
4. **No "Skip" option** - All config fields are required (could add optional flag support)

## Future Enhancements

1. **Field validation** - Validate email, URL, number formats before allowing save
2. **Optional fields** - Support config items that have defaults and don't require user input
3. **Bulk config import** - Allow uploading .env or JSON file with all config values
4. **Config templates** - Save common config sets (dev, staging, prod)
5. **Help tooltips** - Add "?" icon next to fields with more detailed help text

## Fallback Behavior

The existing `configuration_missing` detection (IssueCollector) still works as a **fallback** for:
- Workflows created before this feature
- Manual workflow edits that add new config references
- Edge cases where pre-flight check didn't catch something

So the system is robust with two layers:
1. **Pre-flight check** (prevents issue) ← New
2. **Runtime detection** (catches issue) ← Existing fallback

## Status

✅ **COMPLETE** - Pre-flight configuration check fully implemented and ready for testing.
