# Calibration Configuration Integration - Complete Flow

## Current Calibration Flow

The existing calibration chat follows this pattern:

1. **Welcome Message** - "Hi! I'll help you test your workflow..."
2. **Start Test Button** - User clicks "Start Test"
3. **Test Runs** - Progress updates in chat
4. **Issues Found** - Bot presents issues one-by-one in chat
5. **User Fixes Issues** - Interactive cards for each issue
6. **Apply Fixes** - Bot applies fixes to workflow
7. **Input Form** - Shows `AgentInputFields` for parameterized workflow
8. **Run Again** - User provides input values and re-runs test
9. **Success** - No issues found, workflow ready

## Problem with Current Config Handling

Configuration missing errors are shown as "Critical Issues" after step 4, which feels like a bug to non-technical users. Configuration should be treated like **input parameters** - something natural to provide, not an error to fix.

## Proposed Solution: Integrate Config into Step 7

**Key Insight:** Configuration values and input parameters serve the same purpose - they're values the user must provide before the workflow can run. They should be collected together in one unified form.

### Modified Flow

1. **Welcome Message** - "Hi! I'll help you test your workflow..."
2. **Start Test Button** - User clicks "Start Test"
3. **Test Runs** - Progress updates in chat
4. **Issues Found** - Bot presents issues one-by-one (EXCLUDING configuration_missing)
5. **User Fixes Issues** - Interactive cards for parameter_error, hardcode_detected, logic_error
6. **Apply Fixes** - Bot applies fixes to workflow
7. **Configuration + Input Form** - Shows BOTH config fields AND input_schema fields ← **MODIFIED**
8. **Run Again** - User provides config + input values, saved to database, workflow re-runs
9. **Success** - No issues found, workflow ready

## Implementation Details

### Step 1: Filter Out configuration_missing from Chat Issues

**File:** `components/v2/calibration/CalibrationSetup.tsx`

**Line 313-322:** Update `criticalIssues` filter to EXCLUDE configuration_missing

```typescript
const criticalIssues = React.useMemo(() => {
  if (!issues) return []
  return issues.critical.filter(issue => {
    // NEVER show data_shape_mismatch or configuration_missing in chat
    if (issue.category === 'data_shape_mismatch' || issue.category === 'configuration_missing') return false
    if (!issue.requiresUserInput) return false
    // Critical: parameter errors and logic errors (config handled separately)
    return ['parameter_error', 'logic_error'].includes(issue.category)
  })
}, [issues])
```

**Why:** configuration_missing shouldn't appear as a "critical issue" - it's just missing setup info.

### Step 2: Extract Config Schema from Issues

**File:** `components/v2/calibration/CalibrationSetup.tsx`

Add new memo to extract config requirements:

```typescript
// Extract configuration requirements from configuration_missing issues
const configRequirements = React.useMemo(() => {
  if (!issues) return []

  const configIssues = issues.critical.filter(issue =>
    issue.category === 'configuration_missing'
  )

  // Collect all unique config keys needed
  const configKeys = new Set<string>()
  configIssues.forEach(issue => {
    const keys = issue.suggestedFix?.action?.configKeys || []
    keys.forEach((key: string) => configKeys.add(key))
  })

  // Convert to input field schema format
  return Array.from(configKeys).map(key => ({
    name: `config_${key}`,  // Prefix with config_ to distinguish from input params
    type: 'string',
    label: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    description: `Configuration value for ${key}`,
    required: true,
    placeholder: `Enter ${key.replace(/_/g, ' ')}`
  }))
}, [issues])
```

### Step 3: Combine Config + Input Fields in Form

**File:** `components/v2/calibration/CalibrationSetup.tsx`

**Line 986-1030:** Modify the input form section to include config fields

```typescript
{msg.showInputForm && (() => {
  console.log('[CalibrationSetup] Form visibility check:', {
    showInputForm: msg.showInputForm,
    fixesHaveBeenApplied,
    hasInputSchema: !!agent.input_schema,
    schemaLength: agent.input_schema?.length,
    configRequirementsLength: configRequirements.length
  })
  return true
})() && fixesHaveBeenApplied && (
  <div className="flex items-start gap-3 mt-4">
    <div className="w-8 h-8 rounded-full bg-[var(--v2-primary)]/10 flex items-center justify-center flex-shrink-0">
      <Bot className="w-4 h-4 text-[var(--v2-primary)]" />
    </div>
    <div className="flex-1">
      <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-6">
        <div className="space-y-6">

          {/* Configuration Section */}
          {configRequirements.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-[var(--v2-border)]">
                <Settings className="w-4 h-4 text-[var(--v2-primary)]" />
                <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
                  Workflow Configuration
                </h3>
              </div>
              <p className="text-xs text-[var(--v2-text-secondary)] mb-3">
                These settings configure how your workflow runs:
              </p>
              <AgentInputFields
                schema={configRequirements}
                values={inputValues}
                onChange={(name, value) => {
                  setInputValues(prev => ({
                    ...prev,
                    [name]: value
                  }))
                }}
                getDynamicOptions={getDynamicOptions}
              />
            </div>
          )}

          {/* Input Parameters Section */}
          {agent.input_schema && agent.input_schema.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-[var(--v2-border)]">
                <Zap className="w-4 h-4 text-[var(--v2-primary)]" />
                <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
                  Test Data
                </h3>
              </div>
              <p className="text-xs text-[var(--v2-text-secondary)] mb-3">
                Provide values to test your workflow with:
              </p>
              <AgentInputFields
                schema={agent.input_schema || []}
                values={inputValues}
                onChange={(name, value) => {
                  setInputValues(prev => ({
                    ...prev,
                    [name]: value
                  }))
                }}
                getDynamicOptions={getDynamicOptions}
              />
            </div>
          )}

          {/* Run button - disabled until all required fields are filled */}
          <button
            onClick={() => {
              onRun(inputValues)
              setHasStarted(true)
            }}
            disabled={(() => {
              // Check config requirements
              const missingConfig = configRequirements.some((field: any) => {
                const value = inputValues[field.name]
                return field.required && (value === undefined || value === '' || value === null)
              })

              // Check input parameters
              const requiredParams = (agent.input_schema || []).filter((p: any) => p.required)
              const missingParams = requiredParams.some((p: any) => {
                const value = inputValues[p.name]
                return value === undefined || value === '' || value === null
              })

              return missingConfig || missingParams
            })()}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[var(--v2-primary)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity font-medium rounded-lg"
          >
            <Play className="w-4 h-4" />
            Run Test
          </button>
        </div>
      </Card>
    </div>
  </div>
)}
```

### Step 4: Save Config to Database Before Re-run

**File:** `app/v2/sandbox/[agentId]/page.tsx`

**In `handleRunCalibration` function:**

```typescript
const handleRunCalibration = async (inputValues: Record<string, any>) => {
  try {
    setError(null)

    // Extract config values (prefixed with config_)
    const configValues: Record<string, any> = {}
    const actualInputValues: Record<string, any> = {}

    Object.entries(inputValues).forEach(([key, value]) => {
      if (key.startsWith('config_')) {
        // Remove config_ prefix and store as config
        const configKey = key.substring(7)  // Remove 'config_'
        configValues[configKey] = value
      } else {
        // Regular input parameter
        actualInputValues[key] = value
      }
    })

    // If config values provided, save to agent.workflow_config
    if (Object.keys(configValues).length > 0) {
      console.log('[Sandbox] Saving workflow config:', configValues)

      const { error: updateError } = await supabase
        .from('agents')
        .update({
          workflow_config: {
            ...(agent.workflow_config || {}),
            ...configValues
          }
        })
        .eq('id', agent.id)

      if (updateError) {
        console.error('[Sandbox] Failed to save workflow config:', updateError)
        throw new Error('Failed to save configuration')
      }

      // Update local agent state
      setAgent({
        ...agent,
        workflow_config: {
          ...(agent.workflow_config || {}),
          ...configValues
        }
      })
    }

    // Call calibration API with input values (config already saved to DB)
    const response = await fetch('/api/v2/calibrate/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: agent.id,
        inputValues: actualInputValues
      })
    })

    // ... rest of calibration logic
  } catch (err: any) {
    console.error('Calibration failed:', err)
    setError(err.message || 'Calibration failed')
  }
}
```

## User Experience

### Before (Current):

```
Bot: "I found 3 critical issues to fix:"
Issue 1: Missing workflow configuration ❌ (feels like a bug)
User: [fills in drive_folder_name]
Issue 2: Missing workflow configuration ❌ (feels like a bug)
User: [fills in google_sheet_id]
Issue 3: Missing workflow configuration ❌ (feels like a bug)
User: [fills in user_email]
Bot: "Apply fixes and re-run"
```

### After (Proposed):

```
Bot: "All done! I've fixed 2 issues based on your input."
Bot: "Now let's test your workflow with the applied fixes."

┌─────────────────────────────────────┐
│ ⚙️ Workflow Configuration            │
│ These settings configure how your   │
│ workflow runs:                      │
│                                     │
│ User Email:                         │
│ [offir.omer@gmail.com          ]   │
│                                     │
│ Google Sheet ID:                    │
│ [1pM8WbXtPgaYqokHn_spgQAfR7SB...]  │
│                                     │
│ Drive Folder Name:                  │
│ [Invoices                      ]   │
│                                     │
│ Amount Threshold (USD):             │
│ [50                            ]   │
│                                     │
│ Sheet Tab Name:                     │
│ [Expenses                      ]   │
├─────────────────────────────────────┤
│ ⚡ Test Data                         │
│ Provide values to test with:       │
│                                     │
│ (input parameters appear here if    │
│  workflow has been parameterized)   │
│                                     │
│ [Run Test]                          │
└─────────────────────────────────────┘
```

## Benefits

✅ **Natural UX** - Configuration feels like normal setup, not error fixing
✅ **Unified Form** - Config + inputs collected together
✅ **No Duplicate UI** - Reuses existing `AgentInputFields` component
✅ **Persisted** - Config saved to database automatically
✅ **Fallback Works** - Existing configuration_missing detection still catches edge cases
✅ **Clear Sections** - Visual separation between "Configuration" and "Test Data"

## Edge Cases Handled

1. **No config needed:** Form shows only input parameters (current behavior)
2. **No inputs needed:** Form shows only config fields
3. **Both needed:** Form shows both sections with clear labels
4. **Neither needed:** Skip form entirely, run test immediately
5. **Partial config:** Only shows fields that are actually missing

## Files to Modify

1. **components/v2/calibration/CalibrationSetup.tsx** (3 changes)
   - Filter out configuration_missing from criticalIssues
   - Add configRequirements memo
   - Update input form to show config + input sections

2. **app/v2/sandbox/[agentId]/page.tsx** (1 change)
   - Extract and save config values before running calibration

Total: 2 files, ~100 lines of code

## Testing Plan

1. Load invoice extraction workflow (has 5 config keys)
2. Run calibration → detects 2 parameter errors
3. Fix parameter errors → Apply fixes
4. See unified form with:
   - Configuration section (5 fields)
   - Test Data section (0 fields - no input params)
5. Fill in config values
6. Click "Run Test"
7. Verify config saved to agent.workflow_config
8. Verify workflow runs successfully with config values

## Summary

This approach:
- **Feels natural** - Configuration is setup, not an error
- **Reuses code** - No duplicate form components
- **Integrates seamlessly** - Works with existing calibration flow
- **Saves automatically** - Config persisted to database
- **Scales well** - Handles any number of config + input fields

Configuration becomes part of the normal calibration flow, collected alongside input parameters in a clean, unified form.
