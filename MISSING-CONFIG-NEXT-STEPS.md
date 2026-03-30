# Missing Config Detection - Next Steps

## Current Status

✅ **Completed:**
1. Type system updated (configuration_missing category added)
2. Runtime config resolution ({{config.key}} support in ExecutionContext)
3. Calibration detection (detectMissingWorkflowConfig() in IssueCollector)
4. UI form component (ConfigurationMissingCard in IssueCard.tsx)

## Issue: Config Not Populated in Database

### Root Cause
When the V6 pipeline generates workflows, the IntentContract contains a `config` array with default values:

```json
{
  "config": [
    {"key": "user_email", "type": "string", "default": "offir.omer@gmail.com"},
    {"key": "google_sheet_id", "type": "string", "default": "1pM8W..."},
    {"key": "drive_folder_name", "type": "string", "default": "Invoices"},
    ...
  ]
}
```

But this config is **NOT being stored** in the agent's `workflow_config` field when the agent is created/updated.

### Current Flow
1. V6 pipeline generates IntentContract with config array ✅
2. Pipeline compiles to PILOT DSL with {{config.X}} references ✅
3. Agent created/updated in database... **but workflow_config is NULL** ❌
4. Execution runs with empty workflowConfig ❌
5. {{config.X}} resolves to empty string ❌
6. Plugin fails with "parameter is required" ❌

### Expected Flow
1. V6 pipeline generates IntentContract with config array ✅
2. Pipeline compiles to PILOT DSL with {{config.X}} references ✅
3. **Agent created/updated with workflow_config populated from IntentContract** ⏳
4. Execution runs with workflowConfig = {user_email: "...", google_sheet_id: "...", ...} ✅
5. {{config.X}} resolves to default values ✅
6. Calibration runs, detects **which config keys still need user values** ✅
7. UI shows ConfigurationMissingCard for keys without values ✅
8. User provides missing values through form ✅
9. Re-run succeeds ✅

## What Needs to be Done

### Option 1: Populate workflow_config During Agent Creation (Recommended)

**Where:** The code that creates/updates agents after V6 pipeline completes

**What to change:**
```typescript
// When creating/updating agent from V6 pipeline output
const workflowConfig = extractConfigFromIntentContract(intentContract);

await supabase
  .from('agents')
  .update({
    pilot_steps: compiledPilotSteps,
    workflow_config: workflowConfig  // ← ADD THIS
  })
  .eq('id', agentId);
```

**Helper function needed:**
```typescript
function extractConfigFromIntentContract(intentContract: any): Record<string, any> {
  const config: Record<string, any> = {};

  if (intentContract.config && Array.isArray(intentContract.config)) {
    for (const item of intentContract.config) {
      if (item.key && item.default !== undefined) {
        config[item.key] = item.default;
      }
    }
  }

  return config;
}
```

**Files to check:**
- API routes that create/update agents from V6 pipeline
- Smart Agent Builder completion handlers
- Any code that saves intentContract → agent

### Option 2: Extract Config During Calibration Initialization

**Where:** Batch calibration API route ([app/api/v2/calibrate/batch/route.ts](app/api/v2/calibrate/batch/route.ts))

**What to change:**
```typescript
// Before running calibration
if (!agent.workflow_config && agent.enhanced_prompt) {
  // Try to extract config from enhanced_prompt (which contains IntentContract)
  try {
    const intentContract = JSON.parse(agent.enhanced_prompt);
    agent.workflow_config = extractConfigFromIntentContract(intentContract);
  } catch (e) {
    // IntentContract not available
  }
}
```

This is a fallback for existing agents that don't have workflow_config populated.

### Option 3: Manual Workflow Config Entry (Not Ideal)

Users could manually add config to the database:
```sql
UPDATE agents
SET workflow_config = '{
  "user_email": "offir.omer@gmail.com",
  "google_sheet_id": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc",
  "drive_folder_name": "Invoices",
  "sheet_tab_name": "Expenses",
  "amount_threshold_usd": 50
}'::jsonb
WHERE id = '<agent-id>';
```

**Why this is not ideal:**
- Defeats the purpose of automation
- Doesn't demonstrate real-life scenario
- Not scalable

## Testing the Complete Flow

### Step 1: Ensure workflow_config is Populated

After implementing Option 1 or 2, verify:
```sql
SELECT id, agent_name, workflow_config
FROM agents
WHERE id = '<your-test-agent-id>';
```

Should show:
```json
{
  "user_email": "offir.omer@gmail.com",
  "google_sheet_id": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc",
  "drive_folder_name": "Invoices",
  "sheet_tab_name": "Expenses",
  "amount_threshold_usd": 50
}
```

### Step 2: Run Batch Calibration

Navigate to agent sandbox → Click "Start Calibration"

This will:
1. Run workflow in batch_calibration mode
2. workflowConfig extracted from agent.workflow_config
3. {{config.X}} references resolve to default values
4. If any config keys are missing/empty, detectMissingWorkflowConfig() catches them
5. UI shows ConfigurationMissingCard with input fields

### Step 3: Test Missing Config Detection

To test the detection works, you can:

**A. Clear one config value:**
```sql
UPDATE agents
SET workflow_config = workflow_config || '{"user_email": ""}'::jsonb
WHERE id = '<agent-id>';
```

Then run calibration - should detect `user_email` as missing.

**B. Remove entire workflow_config:**
```sql
UPDATE agents
SET workflow_config = NULL
WHERE id = '<agent-id>';
```

Then run calibration - should detect ALL config keys as missing.

### Step 4: Provide Config Values Through UI

1. Calibration shows ConfigurationMissingCard
2. User enters values in input fields
3. Click "Apply Fixes & Re-run"
4. Config values stored in agent.workflow_config
5. Workflow re-runs successfully ✅

## Summary

The implementation is **95% complete**. The only missing piece is:

**Populate `agent.workflow_config` from `intentContract.config` when creating/updating agents.**

This is a small addition to whichever code path creates/updates agents after the V6 pipeline runs.

Once this is done, the complete flow will work:
1. V6 pipeline generates workflow with config
2. Config stored in agent.workflow_config with defaults
3. Calibration detects which keys still need user values
4. UI prompts user for missing values
5. User provides values through form
6. Workflow executes successfully

**Recommended approach:** Option 1 (populate during agent creation)
**Quick workaround for testing:** Option 3 (manual SQL update)
**Fallback for existing agents:** Option 2 (extract during calibration init)
