# Workflow Orchestrator Testing Guide

**Date**: 2025-11-02
**Status**: Ready for Testing

---

## 🎯 Overview

This guide provides step-by-step instructions for testing the Workflow Orchestrator system.

---

## 📋 Pre-Testing Checklist

Before testing, ensure:
- ✅ Database migrations applied (workflow_executions, workflow_step_executions tables exist)
- ✅ System config settings created (orchestrator category)
- ✅ Admin UI accessible at `/admin/system-config`
- ✅ At least one agent with `workflow_steps` exists (created via Smart Agent Builder)

---

## 🧪 Testing Phases

### **Phase 1: System Configuration Test**

#### 1.1 Check Orchestrator Status

Run the test script:
```bash
npx tsx scripts/test-orchestrator.ts
```

**Expected Output**:
```
🧪 Workflow Orchestrator Test Suite

📋 Step 1: Checking orchestrator configuration...
✅ Orchestrator configuration:
   - workflow_orchestrator_checkpoint_enabled: true
   - workflow_orchestrator_circuit_breaker_threshold: 5
   - workflow_orchestrator_default_retry_count: 3
   - workflow_orchestrator_enabled: false
   - workflow_orchestrator_max_execution_time_ms: 300000
   - workflow_orchestrator_max_parallel_steps: 3
   - workflow_orchestrator_max_steps: 50
   - workflow_orchestrator_retention_days: 90
   - workflow_orchestrator_retry_enabled: true
```

#### 1.2 Enable Orchestrator via Admin UI

1. Navigate to: `http://localhost:3000/admin/system-config`
2. Scroll to **"Workflow Orchestrator"** section
3. Click to expand the section
4. Toggle **"Enable Workflow Orchestrator"** → Should turn GREEN
5. Click **"Save Orchestrator Config"**
6. Wait for success message

**Verification**:
```bash
npx tsx scripts/test-orchestrator.ts
```

Should now show:
```
Orchestrator Enabled: ✅ YES
```

---

### **Phase 2: Agent Workflow Test**

#### 2.1 Check Existing Agents

**SQL Query**:
```sql
SELECT
  id,
  agent_name,
  jsonb_array_length(workflow_steps) as step_count,
  workflow_steps->0->>'type' as first_step_type
FROM agents
WHERE workflow_steps IS NOT NULL
  AND jsonb_array_length(workflow_steps) > 0
LIMIT 5;
```

**Expected**:
- One or more agents with workflow_steps
- step_count > 0
- first_step_type in ['action', 'conditional', 'transform', 'llm_decision', etc.]

#### 2.2 Create Test Agent (if none exist)

Use the **Smart Agent Builder** to create an agent:

1. Go to `/agents/create`
2. Use the AI builder to create an agent with a multi-step workflow
3. Example prompt: *"Create an agent that searches my emails for invoices, extracts totals, and sends a summary to Slack"*
4. The builder will generate `workflow_steps` automatically

**Minimal Test Agent (Manual Insert)**:

If needed, you can manually insert a test agent:
```sql
INSERT INTO agents (
  agent_name,
  user_id,
  description,
  system_prompt,
  user_prompt,
  plugins_required,
  workflow_steps,
  status
) VALUES (
  'Test Orchestrator Agent',
  '[YOUR_USER_ID]',
  'Test agent for orchestrator',
  'You are a test agent',
  'Execute the workflow',
  '["test-plugin"]',
  '[
    {
      "id": "step1",
      "type": "action",
      "name": "Test Step",
      "plugin": "test-plugin",
      "action": "test_action",
      "params": {}
    }
  ]'::jsonb,
  'active'
);
```

---

### **Phase 3: Execution Test**

#### 3.1 Monitor Logs

Start the dev server with logs visible:
```bash
npm run dev
```

#### 3.2 Execute Agent

**Option A: Via API** (Recommended for testing)
```bash
curl -X POST http://localhost:3000/api/run-agent \
  -H "Content-Type: application/json" \
  -H "Cookie: [YOUR_AUTH_COOKIE]" \
  -d '{
    "agent_id": "[AGENT_ID_WITH_WORKFLOW_STEPS]",
    "execution_type": "test",
    "input_variables": {}
  }'
```

**Option B: Via UI**
1. Navigate to agent dashboard
2. Select agent with workflow_steps
3. Click "Run Agent" or "Test"
4. Submit

#### 3.3 Expected Log Output

**Orchestrator Enabled - Agent with workflow_steps**:
```
🔍 Agent has 5 workflow steps - checking orchestrator status...
🎯 Using Workflow Orchestrator for agent "Email Invoice Processor"
📋 Orchestrator TEST MODE: Using 0 input values from UI
🚀 [WorkflowOrchestrator] Starting execution for agent abc-123: Email Invoice Processor
✅ [WorkflowOrchestrator] Orchestrator is enabled, proceeding with execution
📋 [WorkflowOrchestrator] Execution plan:
  Level 0: step1 (Search Emails)
  Level 1: step2 (Extract Totals), step3 (Format Data)
  Level 2: step4 (Send to Slack)
```

**Orchestrator Disabled - Fallback to AgentKit**:
```
🔍 Agent has 5 workflow steps - checking orchestrator status...
⚠️  Agent has workflow_steps but orchestrator is disabled - falling back to AgentKit
🤖 Using AgentKit execution for agent "Email Invoice Processor"
```

**Agent without workflow_steps**:
```
🤖 Using AgentKit execution for agent "Simple Agent"
```

---

### **Phase 4: Database Verification**

#### 4.1 Check Execution Record

**Query**:
```sql
SELECT
  id,
  agent_id,
  status,
  total_steps,
  completed_steps_count,
  failed_steps_count,
  total_execution_time_ms,
  started_at,
  completed_at
FROM workflow_executions
ORDER BY started_at DESC
LIMIT 1;
```

**Expected**:
- New record created
- `status` = 'completed' (if successful) or 'failed'
- `total_steps` matches workflow_steps count
- `completed_steps_count` > 0
- `total_execution_time_ms` > 0

#### 4.2 Check Execution Trace

**Query**:
```sql
SELECT
  execution_trace->'stepExecutions' as step_details,
  execution_trace->'completedSteps' as completed,
  execution_trace->'failedSteps' as failed
FROM workflow_executions
WHERE id = '[EXECUTION_ID]';
```

**Expected**:
- `stepExecutions` array with metadata (NO customer data)
- Each step shows: plugin, action, success, executionTime, itemCount
- NO email bodies, contact names, or sensitive data

#### 4.3 Check Step Executions

**Query**:
```sql
SELECT
  step_id,
  step_name,
  step_type,
  status,
  execution_metadata,
  created_at,
  completed_at
FROM workflow_step_executions
WHERE workflow_execution_id = '[EXECUTION_ID]'
ORDER BY created_at;
```

**Expected**:
- One record per executed step
- Metadata shows success/failure, timing, item counts
- NO customer data in metadata

---

### **Phase 5: API Response Test**

#### 5.1 Successful Execution Response

**Expected**:
```json
{
  "success": true,
  "message": "Workflow completed successfully",
  "data": {
    "agent_id": "abc-123",
    "agent_name": "Email Invoice Processor",
    "execution_type": "workflow_orchestrator",
    "execution_id": "def-456",
    "steps_completed": 4,
    "steps_failed": 0,
    "steps_skipped": 0,
    "total_steps": 4,
    "tokens_used": 2500,
    "execution_time_ms": 5432,
    "output": {
      "message": "Found 3 invoices totaling $1,234.56"
    }
  },
  "orchestrator": true
}
```

#### 5.2 Disabled Orchestrator Response

**Expected**: Falls back to AgentKit, returns AgentKit format:
```json
{
  "success": true,
  "message": "...",
  "data": {
    "execution_type": "agentkit",
    "tool_calls_count": 5,
    ...
  },
  "agentkit": true
}
```

#### 5.3 Orchestrator Error Response

**Expected**:
```json
{
  "success": false,
  "error": "Workflow orchestrator is disabled in system configuration",
  "orchestrator": true
}
```

---

### **Phase 6: Audit Trail Test**

#### 6.1 Check Orchestrator Events

**Query**:
```sql
SELECT
  id,
  action,
  entity_type,
  resource_name,
  severity,
  details,
  created_at
FROM audit_logs
WHERE action LIKE 'ORCHESTRATOR%'
ORDER BY created_at DESC
LIMIT 10;
```

**Expected Events**:
- `ORCHESTRATOR_EXECUTION_STARTED`
- `ORCHESTRATOR_EXECUTION_COMPLETED` (or FAILED)
- `ORCHESTRATOR_DISABLED` (if attempted while disabled)
- `ORCHESTRATOR_CONFIG_UPDATED` (when admin saves settings)

---

### **Phase 7: Error Handling Tests**

#### 7.1 Test Retry Logic

**Setup**: Create agent with flaky plugin that fails 2x then succeeds

**Expected**:
- Step retries 3 times (default)
- Eventually succeeds
- Execution trace shows retry attempts
- Audit log: `ORCHESTRATOR_STEP_RETRIED`

#### 7.2 Test Circuit Breaker

**Setup**: Create agent with plugin that always fails

**Expected**:
- After 5 failures (default threshold), circuit opens
- Subsequent steps fail fast
- Execution marked as failed
- Error message: "Circuit breaker open"

#### 7.3 Test Timeout

**Setup**: Create agent with max_execution_time_ms = 5000

**Expected**:
- Workflow cancelled after 5 seconds
- Status: 'failed'
- Error: "Execution timeout"

---

### **Phase 8: Parallel Execution Test**

#### 8.1 Create Parallel Workflow

**workflow_steps**:
```json
[
  {
    "id": "step1",
    "type": "action",
    "name": "Fetch Emails",
    "plugin": "google-mail",
    "action": "search_emails"
  },
  {
    "id": "step2",
    "type": "action",
    "name": "Enrich Contacts",
    "plugin": "hubspot",
    "action": "enrich_contacts",
    "dependencies": ["step1"]
  },
  {
    "id": "step3",
    "type": "action",
    "name": "Analyze Sentiment",
    "plugin": "openai",
    "action": "analyze_sentiment",
    "dependencies": ["step1"]
  }
]
```

**Expected**:
- Step 1 executes first
- Steps 2 and 3 execute **in parallel** (same level)
- Logs show: "Executing 2 steps in parallel (Level 1)"

---

### **Phase 9: Conditional Logic Test**

#### 9.1 Create Conditional Workflow

**workflow_steps**:
```json
[
  {
    "id": "step1",
    "type": "action",
    "name": "Check Balance",
    "plugin": "stripe",
    "action": "get_balance"
  },
  {
    "id": "step2",
    "type": "conditional",
    "name": "High Balance?",
    "condition": {
      "field": "step1.data.balance",
      "operator": ">",
      "value": 1000
    },
    "dependencies": ["step1"]
  },
  {
    "id": "step3",
    "type": "action",
    "name": "Send Alert",
    "plugin": "slack",
    "action": "send_message",
    "executeIf": {
      "field": "step2.data.result",
      "operator": "==",
      "value": true
    },
    "dependencies": ["step2"]
  }
]
```

**Expected**:
- If balance > 1000: step3 executes
- If balance <= 1000: step3 skipped
- Execution trace shows skipped steps

---

## 🐛 Troubleshooting

### Issue: "Orchestrator is disabled"

**Solution**:
1. Check `/admin/system-config`
2. Ensure toggle is GREEN
3. Run: `npx tsx scripts/test-orchestrator.ts`
4. Verify cache cleared (wait 5 minutes or restart server)

### Issue: Agent uses AgentKit instead of Orchestrator

**Causes**:
1. Agent has no `workflow_steps` field
2. `workflow_steps` is empty array
3. Orchestrator disabled in config
4. `use_agentkit` flag passed to API

**Solution**: Verify agent has workflow_steps:
```sql
SELECT workflow_steps FROM agents WHERE id = '[AGENT_ID]';
```

### Issue: "Workflow execution failed"

**Debug Steps**:
1. Check error in API response
2. Query workflow_executions for error_message
3. Check audit_logs for ORCHESTRATOR_EXECUTION_FAILED
4. Verify plugins are installed and connected
5. Check plugin credentials

### Issue: Steps not executing in parallel

**Causes**:
1. Steps have dependencies (can't parallelize)
2. `max_parallel_steps` = 1 in config
3. Steps in different levels of execution graph

**Solution**: Review execution plan in logs

---

## ✅ Success Criteria

The orchestrator is working correctly if:

- ✅ Admin UI shows "Active" status
- ✅ Test script confirms enabled
- ✅ Agents with workflow_steps use orchestrator
- ✅ workflow_executions records created
- ✅ Execution trace contains metadata (no customer data)
- ✅ Audit events logged
- ✅ Parallel steps execute concurrently
- ✅ Conditional steps skip when condition false
- ✅ Retry works on transient failures
- ✅ Fallback to AgentKit when disabled

---

## 📊 Performance Benchmarks

**Expected Performance**:
- Simple workflow (3 steps): 2-5 seconds
- Complex workflow (10 steps, parallel): 5-15 seconds
- Checkpoint overhead: ~50-100ms per step
- Memory context loading: ~200-500ms

**Performance Test Query**:
```sql
SELECT
  AVG(total_execution_time_ms) as avg_time,
  MIN(total_execution_time_ms) as min_time,
  MAX(total_execution_time_ms) as max_time,
  AVG(total_steps) as avg_steps
FROM workflow_executions
WHERE status = 'completed';
```

---

## 🎓 Next Steps

After successful testing:

1. **Enable for Production**: Set `workflow_orchestrator_enabled = true`
2. **Monitor Metrics**: Watch execution times, success rates
3. **Create Workflows**: Use Smart Agent Builder to create workflow agents
4. **Optimize**: Adjust max_parallel_steps, retry counts based on usage
5. **Scale**: Monitor database size, implement retention policy

---

## 📚 Related Documentation

- [ORCHESTRATOR_DESIGN.md](./ORCHESTRATOR_DESIGN.md) - Architecture
- [ORCHESTRATOR_PROGRESS.md](./ORCHESTRATOR_PROGRESS.md) - Implementation status
- [System Config Admin UI](../app/admin/system-config/page.tsx) - Admin interface
