# Configuration Pre-Flight Check - Implementation Plan

## Flow Overview

```
User clicks "Start Test"
    ↓
Pre-flight analysis (scan workflow for {{config.X}})
    ↓
Missing config detected?
    ├─ YES → Show config form in chat (DON'T run calibration yet)
    │         User fills values → Click "Save & Continue"
    │         Save to database → NOW run calibration
    │
    └─ NO → Run calibration immediately
```

## Detailed Flow

### Step 1: User Clicks "Start Test"

**Current:** Immediately calls `onRun(inputValues)` which triggers calibration API

**New:** Call pre-flight check first:
```typescript
handleStartTest() {
  // Check if workflow needs configuration
  const missingConfig = await checkMissingConfig(agent)

  if (missingConfig.length > 0) {
    // Show config form instead of running calibration
    showConfigForm(missingConfig)
  } else {
    // No config needed, run calibration immediately
    onRun(inputValues)
  }
}
```

### Step 2: Pre-Flight Config Analysis

**Goal:** Scan workflow steps WITHOUT running them to find missing config

**Implementation:**

```typescript
// In CalibrationSetup.tsx or sandbox page

const checkMissingConfig = (agent: Agent): Array<{key: string, description?: string, default?: any}> => {
  const workflowSteps = agent.pilot_steps || []
  const workflowConfig = agent.workflow_config || {}

  // Scan all steps for {{config.X}} patterns
  const configReferences = new Set<string>()

  const scanForConfigRefs = (obj: any) => {
    if (typeof obj === 'string') {
      const matches = obj.matchAll(/\{\{config\.(\w+)\}\}/g)
      for (const match of matches) {
        configReferences.add(match[1])
      }
    } else if (Array.isArray(obj)) {
      obj.forEach(item => scanForConfigRefs(item))
    } else if (obj && typeof obj === 'object') {
      Object.values(obj).forEach(value => scanForConfigRefs(value))
    }
  }

  workflowSteps.forEach(step => scanForConfigRefs(step))

  // Check which config keys are missing
  const missingKeys = Array.from(configReferences).filter(key => {
    const value = workflowConfig[key]
    return value === undefined || value === null || value === ''
  })

  // Try to get descriptions from IntentContract (enhanced_prompt)
  let configSchema: any[] = []
  if (agent.enhanced_prompt) {
    try {
      const intentContract = typeof agent.enhanced_prompt === 'string'
        ? JSON.parse(agent.enhanced_prompt)
        : agent.enhanced_prompt
      configSchema = intentContract?.config || []
    } catch (e) {
      // Parsing failed, continue without descriptions
    }
  }

  // Map to full config objects with descriptions
  return missingKeys.map(key => {
    const schemaItem = configSchema.find((item: any) => item.key === key)
    return {
      key,
      description: schemaItem?.description || `Configuration value for ${key}`,
      default: schemaItem?.default,
      type: schemaItem?.type || 'string'
    }
  })
}
```

### Step 3: Show Config Form in Chat

**Bot message sequence:**

```typescript
// In CalibrationSetup.tsx - modify handleRun()

const handleRun = async () => {
  setHasStarted(true)

  // Pre-flight check
  const missingConfig = checkMissingConfig(agent)

  if (missingConfig.length > 0) {
    // Show bot message about configuration
    setMessages([
      {
        id: 'config-needed',
        type: 'bot',
        content: `Before I can test your workflow, I need ${missingConfig.length} configuration ${missingConfig.length === 1 ? 'value' : 'values'} from you.`,
        timestamp: new Date()
      },
      {
        id: 'config-explanation',
        type: 'bot',
        content: 'These settings tell your workflow where to send data, what to search for, and other important details.',
        timestamp: new Date()
      },
      {
        id: 'config-form',
        type: 'bot',
        content: '', // Empty content, will render form
        timestamp: new Date(),
        showConfigForm: true,
        configFields: missingConfig
      }
    ])
  } else {
    // No config needed, proceed with normal calibration
    onRun(inputValues)
  }
}
```

### Step 4: Render Config Form

**In CalibrationSetup.tsx chat rendering:**

```typescript
{messages.map((msg) => (
  <div key={msg.id}>
    {/* Regular bot message */}
    {msg.type === 'bot' && msg.content && (
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-[var(--v2-primary)]/10">
          <Bot className="w-4 h-4 text-[var(--v2-primary)]" />
        </div>
        <div className="px-4 py-3 rounded-2xl bg-[var(--v2-surface)] border">
          <p className="text-sm">{msg.content}</p>
        </div>
      </div>
    )}

    {/* Config form */}
    {msg.showConfigForm && msg.configFields && (
      <div className="flex items-start gap-3 mt-4">
        <div className="w-8 h-8 rounded-full bg-[var(--v2-primary)]/10">
          <Bot className="w-4 h-4 text-[var(--v2-primary)]" />
        </div>
        <div className="flex-1">
          <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b">
                <Settings className="w-4 h-4 text-[var(--v2-primary)]" />
                <h3 className="text-sm font-semibold">Workflow Configuration</h3>
              </div>

              {/* Render config fields */}
              {msg.configFields.map((field: any) => (
                <div key={field.key} className="space-y-2">
                  <label className="text-sm font-medium block">
                    {field.key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </label>
                  {field.description && (
                    <p className="text-xs text-[var(--v2-text-secondary)]">
                      {field.description}
                    </p>
                  )}
                  <input
                    type={field.type === 'number' ? 'number' : 'text'}
                    value={configValues[field.key] || field.default || ''}
                    onChange={(e) => {
                      setConfigValues(prev => ({
                        ...prev,
                        [field.key]: e.target.value
                      }))
                    }}
                    placeholder={`Enter ${field.key.replace(/_/g, ' ')}`}
                    className="w-full px-4 py-2 rounded-lg border focus:ring-2"
                  />
                </div>
              ))}

              {/* Save & Continue button */}
              <button
                onClick={async () => {
                  await saveConfigAndContinue()
                }}
                disabled={(() => {
                  // Check if all config fields have values
                  return msg.configFields.some((field: any) => {
                    const value = configValues[field.key]
                    return !value || value === ''
                  })
                })()}
                className="w-full flex items-center justify-center gap-2 px-6 py-3
                          bg-[var(--v2-primary)] text-white hover:opacity-90
                          disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckCircle2 className="w-4 h-4" />
                Save & Continue
              </button>
            </div>
          </Card>
        </div>
      </div>
    )}
  </div>
))}
```

### Step 5: Save Config & Continue

```typescript
const saveConfigAndContinue = async () => {
  try {
    // Show saving message
    setMessages(prev => [
      ...prev,
      {
        id: 'saving-config',
        type: 'bot',
        content: 'Saving configuration...',
        timestamp: new Date()
      }
    ])

    // Save to database
    const { error } = await supabase
      .from('agents')
      .update({
        workflow_config: {
          ...(agent.workflow_config || {}),
          ...configValues
        }
      })
      .eq('id', agent.id)

    if (error) throw error

    // Update local agent state
    setAgent({
      ...agent,
      workflow_config: {
        ...(agent.workflow_config || {}),
        ...configValues
      }
    })

    // Show success message
    setMessages(prev => [
      ...prev.filter(m => m.id !== 'saving-config'),
      {
        id: 'config-saved',
        type: 'bot',
        content: '✓ Configuration saved! Now let\'s test your workflow.',
        timestamp: new Date()
      }
    ])

    // Wait a moment, then run calibration
    setTimeout(() => {
      onRun(inputValues)
    }, 800)

  } catch (error: any) {
    setMessages(prev => [
      ...prev.filter(m => m.id !== 'saving-config'),
      {
        id: 'config-error',
        type: 'bot',
        content: `✗ Failed to save configuration: ${error.message}`,
        timestamp: new Date()
      }
    ])
  }
}
```

### Step 6: Run Calibration with Config

After config is saved, the normal calibration flow continues:
- `onRun(inputValues)` is called
- WorkflowPilot extracts config from `agent.workflow_config`
- Execution runs with populated config values
- If other issues found (parameter errors, hardcoded values), show those
- Complete normal calibration flow

## Chat Conversation Example

```
Bot: Hi! I'll help you test your workflow. Here's what I'll check:
     ✓ All integrations are connected
     ✓ Data flows correctly
     ✓ Settings are configured correctly

Bot: Ready to start? Click the "Start Test" button below.

[User clicks Start Test]

Bot: Before I can test your workflow, I need 3 configuration values from you.

Bot: These settings tell your workflow where to send data, what to search for,
     and other important details.

Bot: ┌─────────────────────────────────────────┐
     │ ⚙️ Workflow Configuration                │
     │                                          │
     │ User Email                               │
     │ Email address to send summary to        │
     │ [offir.omer@gmail.com              ]   │
     │                                          │
     │ Google Sheet ID                          │
     │ Spreadsheet for logging transactions     │
     │ [1pM8WbXtPgaYqokHn_spgQAfR7SBuq...]   │
     │                                          │
     │ Drive Folder Name                        │
     │ Folder name for storing attachments      │
     │ [Invoices                          ]   │
     │                                          │
     │ [Save & Continue]                        │
     └─────────────────────────────────────────┘

[User fills in values and clicks Save & Continue]

Bot: ✓ Configuration saved! Now let's test your workflow.

Bot: Starting your workflow test...
     [progress bar]

Bot: ✓ Test complete! I found 2 issues to fix.

[Continue with normal calibration flow...]
```

## State Management

Add to CalibrationSetup state:

```typescript
const [configValues, setConfigValues] = useState<Record<string, any>>({})
const [configFormShown, setConfigFormShown] = useState(false)
```

Add to ChatMessage type:

```typescript
interface ChatMessage {
  id: string
  type: 'bot' | 'user' | 'system'
  content: string
  timestamp: Date
  progress?: number
  issue?: CollectedIssue
  isFixing?: boolean
  showInputForm?: boolean
  showConfigForm?: boolean  // NEW
  configFields?: Array<{key: string, description?: string, default?: any, type?: string}>  // NEW
}
```

## Files to Modify

1. **components/v2/calibration/CalibrationSetup.tsx**
   - Add `checkMissingConfig()` function
   - Modify `handleRun()` to do pre-flight check
   - Add config form rendering in chat
   - Add `saveConfigAndContinue()` function
   - Add state for configValues

2. **app/v2/sandbox/[agentId]/page.tsx** (minimal changes)
   - Agent state already tracks workflow_config
   - onRun already passes to calibration API
   - No changes needed if we handle everything in CalibrationSetup

## Benefits

✅ **Fast feedback** - User sees config form immediately (no failed calibration run)
✅ **Conversational** - Config form appears naturally in chat flow
✅ **Efficient** - Only runs calibration once (with config already populated)
✅ **Clear separation** - Config is setup (not an "issue")
✅ **Reuses existing chat UI** - Consistent with other bot messages
✅ **Descriptions included** - Extracts helpful text from IntentContract

## Edge Cases

1. **No config needed** → Skip form, run calibration immediately (current behavior)
2. **Partial config exists** → Only show form for missing keys
3. **Save fails** → Show error message, keep form open for retry
4. **Config + Input params both needed** → Show config first, then after calibration if workflow was parameterized, show input form

## Testing

1. Load invoice extraction agent (no workflow_config set)
2. Click "Start Test"
3. Should see bot message + config form (NOT run calibration yet)
4. Fill in 5 config fields
5. Click "Save & Continue"
6. Verify config saved to database
7. Verify calibration now runs with config values
8. Verify workflow executes successfully

This approach gives users a smooth, conversational experience where configuration feels like a natural part of the setup process, not an error to fix.
