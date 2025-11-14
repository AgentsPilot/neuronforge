# Phase 1 Testing Guide: Pilot Renaming & Foundation Fixes

## Overview

This guide provides comprehensive testing procedures for Phase 1 of the Pilot implementation, which includes:
1. Complete renaming from Orchestrator → Pilot
2. Critical bug fix for workflow_step_executions logging
3. Backward compatibility for existing deployments
4. Admin UI updates

---

## Pre-Testing Setup

### 1. Database Verification

Ensure the following tables exist:
```sql
-- Check workflow tables
SELECT EXISTS (
  SELECT FROM information_schema.tables
  WHERE table_name = 'workflow_executions'
);

SELECT EXISTS (
  SELECT FROM information_schema.tables
  WHERE table_name = 'workflow_step_executions'
);

-- Check system settings
SELECT * FROM system_settings_config
WHERE key LIKE 'pilot_%' OR key LIKE 'workflow_orchestrator_%';
```

### 2. Test Agent Setup

Create a test agent with workflow_steps:
```json
{
  "agent_name": "Test Pilot Agent",
  "workflow_steps": [
    {
      "id": "step1",
      "name": "Fetch Data",
      "type": "action",
      "plugin": "gmail",
      "action": "list_emails",
      "params": {
        "max_results": 5
      }
    },
    {
      "id": "step2",
      "name": "Process Results",
      "type": "transform",
      "operation": "map",
      "input": "{{step1.data}}",
      "config": {
        "mapping": {
          "subject": "{{item.subject}}",
          "from": "{{item.from}}"
        }
      }
    }
  ]
}
```

---

## Test Suite

### Test 1: Basic Pilot Execution ✓

**Objective**: Verify pilot executes workflow_steps successfully

**Steps**:
1. Enable pilot in admin config:
   - Navigate to `/admin/system-config`
   - Expand "Workflow Pilot" section
   - Toggle "Enable Workflow Pilot" to ON
   - Click "Save Pilot Config"

2. Execute test agent:
   ```bash
   curl -X POST http://localhost:3000/api/run-agent \
     -H "Content-Type: application/json" \
     -d '{
       "agent_id": "YOUR_TEST_AGENT_ID",
       "input_variables": {},
       "execution_type": "test"
     }'
   ```

3. Verify response:
   ```json
   {
     "success": true,
     "data": {
       "execution_type": "workflow_pilot",
       "steps_completed": 2,
       "steps_failed": 0,
       "total_steps": 2
     }
   }
   ```

**Expected Results**:
- ✓ API returns `execution_type: "workflow_pilot"`
- ✓ Console logs show `[WorkflowPilot]` messages
- ✓ All workflow steps complete successfully

---

### Test 2: workflow_step_executions Logging ✓

**Objective**: Verify step-level logging to database

**Steps**:
1. Execute test agent (from Test 1)

2. Check workflow_step_executions table:
   ```sql
   SELECT
     wse.step_id,
     wse.step_name,
     wse.status,
     wse.execution_metadata,
     wse.started_at,
     wse.completed_at
   FROM workflow_step_executions wse
   JOIN workflow_executions we ON wse.workflow_execution_id = we.id
   WHERE we.agent_id = 'YOUR_TEST_AGENT_ID'
   ORDER BY wse.created_at DESC;
   ```

**Expected Results**:
- ✓ One record per workflow step (2 records for test agent)
- ✓ `status = 'completed'` for successful steps
- ✓ `execution_metadata` contains:
  - `success: true`
  - `execution_time: <number>`
  - `tokens_used: <number>` (if applicable)
  - `item_count: <number>` (if applicable)
- ✓ `started_at` and `completed_at` timestamps present

---

### Test 3: Backward Compatibility ✓

**Objective**: Verify old `workflow_orchestrator_enabled` key still works

**Steps**:
1. Update system config to use old key:
   ```sql
   INSERT INTO system_settings_config (key, value, category)
   VALUES ('workflow_orchestrator_enabled', true, 'orchestrator')
   ON CONFLICT (key) DO UPDATE SET value = true;

   -- Remove new key if exists
   DELETE FROM system_settings_config WHERE key = 'pilot_enabled';
   ```

2. Execute test agent (from Test 1)

3. Verify pilot still executes:
   ```sql
   SELECT status, total_steps, completed_steps_count
   FROM workflow_executions
   ORDER BY created_at DESC LIMIT 1;
   ```

**Expected Results**:
- ✓ Pilot executes successfully with old config key
- ✓ Console logs show backward compatibility message (check logs)
- ✓ All steps complete normally

---

### Test 4: Pilot Disabled Fallback ✓

**Objective**: Verify fallback to AgentKit when pilot is disabled

**Steps**:
1. Disable pilot:
   ```sql
   UPDATE system_settings_config
   SET value = false
   WHERE key IN ('pilot_enabled', 'workflow_orchestrator_enabled');
   ```

2. Execute test agent

3. Verify AgentKit execution:
   ```json
   {
     "success": true,
     "data": {
       "execution_type": "agentkit",
       "iterations": 1,
       "tool_calls_count": 5
     }
   }
   ```

**Expected Results**:
- ✓ API returns `execution_type: "agentkit"`
- ✓ Console logs show `[AgentKit]` messages
- ✓ Agent executes successfully via AgentKit
- ✓ No workflow_step_executions records created

---

### Test 5: Audit Trail Events ✓

**Objective**: Verify new PILOT_* audit events are logged

**Steps**:
1. Enable pilot and execute test agent

2. Check audit trail:
   ```sql
   SELECT
     event,
     entity_type,
     entity_id,
     details,
     created_at
   FROM audit_trail
   WHERE event LIKE 'PILOT_%'
   ORDER BY created_at DESC
   LIMIT 20;
   ```

**Expected Results**:
- ✓ `PILOT_EXECUTION_STARTED` event logged
- ✓ `PILOT_EXECUTION_COMPLETED` event logged (or FAILED)
- ✓ `PILOT_STEP_EXECUTED` events for each step
- ✓ Event details contain relevant metadata

---

### Test 6: Admin UI Configuration ✓

**Objective**: Verify admin panel works with new pilot config

**Steps**:
1. Navigate to `/admin/system-config`

2. Test Pilot Configuration section:
   - Expand "Workflow Pilot" section
   - Verify all settings display correctly
   - Change `Max Steps` from 50 to 100
   - Change `Max Execution Time` from 300000 to 600000
   - Toggle `Enable Retry` OFF
   - Click "Save Pilot Config"

3. Verify database update:
   ```sql
   SELECT key, value
   FROM system_settings_config
   WHERE key LIKE 'pilot_%'
   ORDER BY key;
   ```

**Expected Results**:
- ✓ Success message: "Pilot configuration saved successfully!"
- ✓ Database shows new `pilot_*` keys (not `workflow_orchestrator_*`)
- ✓ Values match UI changes:
  - `pilot_max_steps = 100`
  - `pilot_max_execution_time_ms = 600000`
  - `pilot_retry_enabled = false`

---

### Test 7: Pause/Resume Functionality ✓

**Objective**: Verify pause/resume still works after renaming

**Prerequisites**:
- Agent with long-running workflow
- Or manually pause via database

**Steps**:
1. Start workflow execution

2. Pause execution:
   ```sql
   UPDATE workflow_executions
   SET status = 'paused', paused_at = NOW()
   WHERE id = 'YOUR_EXECUTION_ID';
   ```

3. Resume via API:
   ```typescript
   const pilot = new WorkflowPilot(supabase);
   await pilot.resumeExecution('YOUR_EXECUTION_ID');
   ```

**Expected Results**:
- ✓ Execution resumes from paused state
- ✓ Remaining steps execute successfully
- ✓ `resumed_at` timestamp updated in database
- ✓ Audit event `PILOT_EXECUTION_RESUMED` logged

---

### Test 8: Error Handling & Step Failure ✓

**Objective**: Verify failed steps are logged correctly

**Steps**:
1. Create agent with failing step:
   ```json
   {
     "id": "failing_step",
     "type": "action",
     "plugin": "gmail",
     "action": "invalid_action",
     "params": {}
   }
   ```

2. Execute agent

3. Check workflow_step_executions:
   ```sql
   SELECT
     step_id,
     status,
     error_message,
     execution_metadata,
     failed_at
   FROM workflow_step_executions
   WHERE status = 'failed'
   ORDER BY created_at DESC
   LIMIT 1;
   ```

**Expected Results**:
- ✓ `status = 'failed'`
- ✓ `error_message` contains failure reason
- ✓ `execution_metadata.success = false`
- ✓ `failed_at` timestamp present
- ✓ Audit event `PILOT_STEP_FAILED` logged

---

### Test 9: Performance & Metrics ✓

**Objective**: Verify execution metrics are accurate

**Steps**:
1. Execute test agent

2. Check execution record:
   ```sql
   SELECT
     total_execution_time_ms,
     total_tokens_used,
     total_steps,
     completed_steps_count,
     failed_steps_count,
     skipped_steps_count
   FROM workflow_executions
   ORDER BY created_at DESC
   LIMIT 1;
   ```

3. Compare with step-level metrics:
   ```sql
   SELECT
     SUM((execution_metadata->>'execution_time')::int) as total_step_time,
     SUM((execution_metadata->>'tokens_used')::int) as total_step_tokens
   FROM workflow_step_executions
   WHERE workflow_execution_id = 'YOUR_EXECUTION_ID';
   ```

**Expected Results**:
- ✓ Total execution time is sum of step times + overhead
- ✓ Total tokens match sum of step tokens
- ✓ Step counts are accurate
- ✓ Metrics displayed correctly in admin analytics

---

### Test 10: Migration Path ✓

**Objective**: Verify seamless migration from old to new config

**Steps**:
1. Start with old config:
   ```sql
   INSERT INTO system_settings_config (key, value, category)
   VALUES
     ('workflow_orchestrator_enabled', true, 'orchestrator'),
     ('workflow_orchestrator_max_steps', 50, 'orchestrator');
   ```

2. Execute agent (should work with old keys)

3. Update via admin UI:
   - Save configuration via admin panel
   - This creates new `pilot_*` keys

4. Verify both old and new keys work:
   ```sql
   SELECT key, value FROM system_settings_config
   WHERE key LIKE '%enabled%'
   AND (key LIKE 'pilot_%' OR key LIKE 'workflow_orchestrator_%');
   ```

**Expected Results**:
- ✓ Agent works with old keys initially
- ✓ Admin UI save creates new `pilot_*` keys
- ✓ Both key sets can coexist
- ✓ New keys take precedence when both exist
- ✓ No downtime during migration

---

## Regression Testing

### Pre-existing Functionality

Verify these existing features still work:

1. **AgentKit Execution** (when pilot disabled)
   - ✓ Standard agent execution
   - ✓ Tool/plugin calls
   - ✓ Multi-iteration flows

2. **Analytics Dashboard**
   - ✓ Pilot executions show in analytics
   - ✓ Token usage tracked correctly
   - ✓ Execution time metrics accurate

3. **Memory System**
   - ✓ Memory injection works with pilot
   - ✓ Execution summaries generated
   - ✓ Memory context available in steps

4. **AIS (Agent Intensity System)**
   - ✓ Intensity scores calculated for pilot executions
   - ✓ Metrics include workflow complexity

---

## Monitoring & Debugging

### Console Logs to Watch

**Successful Pilot Execution**:
```
🚀 [WorkflowPilot] Starting execution for agent <id>: <name>
✅ [WorkflowPilot] Pilot is enabled, proceeding with execution
📋 [WorkflowPilot] Execution plan:
  Level 0: 1 step(s)
  Level 1: 1 step(s)
[StepExecutor] Executing step step1: Fetch Data (type: action)
[StepExecutor] Step step1 completed successfully in 234ms
[StepExecutor] Executing step step2: Process Results (type: transform)
[StepExecutor] Step step2 completed successfully in 45ms
✅ [WorkflowPilot] Execution completed successfully: <execution_id>
```

**Pilot Disabled Fallback**:
```
🔍 Agent has 2 workflow steps - checking pilot status...
⚠️  Agent has workflow_steps but pilot is disabled - falling back to AgentKit
🤖 Using AgentKit execution for agent "<name>"
```

### Database Queries for Debugging

**Check Latest Executions**:
```sql
SELECT
  we.id,
  we.status,
  we.total_steps,
  we.completed_steps_count,
  we.failed_steps_count,
  we.total_execution_time_ms,
  we.created_at
FROM workflow_executions we
ORDER BY we.created_at DESC
LIMIT 10;
```

**Check Step Details**:
```sql
SELECT
  wse.step_id,
  wse.step_name,
  wse.status,
  wse.execution_metadata,
  EXTRACT(EPOCH FROM (wse.completed_at - wse.started_at)) * 1000 as duration_ms
FROM workflow_step_executions wse
WHERE wse.workflow_execution_id = 'YOUR_EXECUTION_ID'
ORDER BY wse.created_at;
```

**Check Audit Trail**:
```sql
SELECT
  event,
  user_id,
  details->'agent_id' as agent_id,
  details->'total_steps' as total_steps,
  created_at
FROM audit_trail
WHERE event LIKE 'PILOT_%'
ORDER BY created_at DESC
LIMIT 20;
```

---

## Success Criteria

Phase 1 is considered successful when:

- ✅ All 10 test cases pass
- ✅ workflow_step_executions table populates correctly
- ✅ Backward compatibility with old config keys confirmed
- ✅ Admin UI saves and loads pilot configuration
- ✅ Audit trail shows new PILOT_* events
- ✅ No regression in existing AgentKit functionality
- ✅ Console logs use new [WorkflowPilot] prefix
- ✅ Pause/resume functionality works
- ✅ Error handling and step failures logged correctly
- ✅ Migration path from old to new config verified

---

## Known Issues & Pre-existing Errors

### TypeScript Compilation Errors

The following TypeScript errors are **pre-existing** and NOT related to Phase 1 changes:

1. **components/wizard/systemOutputs.ts** - Syntax errors (unrelated)
2. **lib/pilot/ConditionalEvaluator.ts** - Missing ExecutionContext methods (pre-existing)
3. **lib/pilot/ErrorRecovery.ts** - Module import issues (pre-existing)
4. **lib/pilot/ExecutionContext.ts** - Iterator downlevel issues (pre-existing)

These should be addressed separately and do not affect Phase 1 functionality.

---

## Next Steps: Phase 2

Once all tests pass, proceed to **Phase 2: Enhanced Conditionals** which includes:
- Complex boolean expressions
- Nested conditions
- Dynamic condition evaluation
- Enhanced conditional branching

Refer to `PILOT_IMPLEMENTATION_PLAN.md` for Phase 2 details.
