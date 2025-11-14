# Pilot Workflow Engine - Comprehensive Test

**Date**: November 2, 2025
**Status**: Ready for Testing

---

## Overview

This document describes the comprehensive test workflow that validates ALL Pilot workflow engine features in a single end-to-end test scenario.

**Test File**: `scripts/test-full-pilot-workflow.ts`

---

## Test Scenario: Budget Increase Approval Workflow

The test simulates a real-world enterprise workflow for approving a department budget increase. This scenario was chosen because it naturally requires all the features that Pilot supports.

### Business Flow

```
1. Employee submits budget increase request
2. System validates and assesses risk (parallel analysis)
3. Finance department approves (if amount > $25k)
4. Department manager approves (always required)
5. System generates approval summary
6. Notifications sent to all stakeholders (parallel)
7. Workflow complete
```

---

## Features Tested

### ✅ 1. Sequential Execution
**Steps**: 1, 2, 6, 7, 10, 13
**What it tests**: Steps execute in dependency order

```typescript
{
  id: "validate_request",
  dependencies: ["init_request"], // Runs AFTER init_request
  // ...
}
```

### ✅ 2. Parallel Execution
**Steps**: 3-5 (Risk Assessment), 11-12 (Notifications)
**What it tests**: Multiple steps execute simultaneously when dependencies are met

```typescript
// These 3 steps run in PARALLEL after validate_request completes
{
  id: "check_budget_limits",
  dependencies: ["validate_request"]
},
{
  id: "assess_department_capacity",
  dependencies: ["validate_request"]
},
{
  id: "calculate_roi",
  dependencies: ["validate_request"]
}
```

### ✅ 3. Variable Interpolation
**All steps**
**What it tests**: Dynamic variable substitution using `{{variable.path}}` syntax

```typescript
{
  input: {
    totalBudget: "{{request.currentBudget + request.requestedIncrease}}",
    increasePercentage: "{{(request.requestedIncrease / request.currentBudget) * 100}}"
  }
}
```

### ✅ 4. Conditional Execution
**Step**: 8 (Finance Approval)
**What it tests**: Steps only execute when condition is true

```typescript
{
  id: "finance_approval",
  condition: "{{financeReviewCheck.requiresFinanceReview === true}}",
  // Only runs if amount > $25,000
}
```

### ✅ 5. Human Approvals (Phase 6)
**Steps**: 8, 9
**What it tests**: Workflow pauses for human approval, resumes after approval

```typescript
{
  type: "human_approval",
  approvers: ["user-id"],
  approvalType: "any",
  title: "Finance Review Required",
  timeout: 1800000, // 30 minutes
  onTimeout: "escalate",
  // Workflow PAUSES here until approved
}
```

### ✅ 6. Approval Escalation
**Step**: 8
**What it tests**: Approval escalates to higher authority on timeout

```typescript
{
  onTimeout: "escalate",
  escalateTo: ["manager-id"],
  // If no response in 30min, escalate to manager
}
```

### ✅ 7. Retry Policies
**Step**: 2
**What it tests**: Automatic retry on step failure with exponential backoff

```typescript
{
  retryPolicy: {
    maxRetries: 3,
    retryDelayMs: 1000,
    backoffMultiplier: 2  // 1s, 2s, 4s
  }
}
```

### ✅ 8. Error Handling
**All steps**
**What it tests**: Graceful error handling with execution state preservation

### ✅ 9. State Management
**All steps**
**What it tests**: State snapshots saved at each step for debugging and recovery

### ✅ 10. Audit Logging
**Steps**: 8, 9 (approvals)
**What it tests**: All approval actions logged to audit trail

---

## Workflow Visualization

```
┌─────────────────────┐
│  Initialize Request │
│     (Step 1)        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Validate Request    │
│     (Step 2)        │
└──────────┬──────────┘
           │
           ├──────────────────┬──────────────────┐
           ▼                  ▼                  ▼
    ┌──────────┐      ┌──────────┐      ┌──────────┐
    │  Budget  │      │ Capacity │      │   ROI    │
    │  Check   │      │  Check   │      │ Analysis │
    │ (Step 3) │      │ (Step 4) │      │ (Step 5) │
    └────┬─────┘      └────┬─────┘      └────┬─────┘
         │                 │                  │
         └────────┬────────┴──────────────────┘
                  ▼
        ┌─────────────────┐
        │ Combine Risk    │
        │   Assessment    │
        │    (Step 6)     │
        └────────┬────────┘
                 ▼
        ┌─────────────────┐
        │ Check Finance   │
        │  Review Needed  │
        │    (Step 7)     │
        └────────┬────────┘
                 │
                 ▼
        ┌─────────────────┐
        │ ✋ Finance      │   ← HUMAN APPROVAL
        │   Approval      │     (if > $25k)
        │   (Step 8)      │     [CONDITIONAL]
        └────────┬────────┘
                 │
                 ▼
        ┌─────────────────┐
        │ ✋ Manager      │   ← HUMAN APPROVAL
        │   Approval      │     (always)
        │   (Step 9)      │     [REQUIRED]
        └────────┬────────┘
                 │
                 ▼
        ┌─────────────────┐
        │ Generate        │
        │   Summary       │
        │   (Step 10)     │
        └────────┬────────┘
                 │
                 ├──────────────┬──────────────┐
                 ▼              ▼              ▼
          ┌──────────┐  ┌──────────┐  ┌──────────┐
          │  Notify  │  │  Notify  │  │  Notify  │
          │ Finance  │  │    HR    │  │Submitter │
          │(Step 11) │  │(Step 12) │  │(Step 12) │
          └────┬─────┘  └────┬─────┘  └────┬─────┘
               │             │             │
               └──────┬──────┴─────────────┘
                      ▼
              ┌──────────────┐
              │   Workflow   │
              │   Complete   │
              │   (Step 13)  │
              └──────────────┘
```

---

## Running the Test

### Prerequisites

1. **Authenticated User**
   ```bash
   # Ensure you're logged in to the app
   # The script will use your current session
   ```

2. **Local Server Running**
   ```bash
   npm run dev
   # Server must be running on http://localhost:3000
   ```

3. **Database Access**
   ```bash
   # Ensure Supabase credentials are in .env.local
   NEXT_PUBLIC_SUPABASE_URL=your_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key
   ```

### Execute Test

```bash
npx ts-node scripts/test-full-pilot-workflow.ts
```

### Expected Output

```
╔════════════════════════════════════════════════════════════╗
║       COMPREHENSIVE PILOT WORKFLOW TEST                   ║
║       Testing ALL Pilot Features                          ║
╚════════════════════════════════════════════════════════════╝

═══════════════════════════════════════════════════════
  STEP 1: Authentication & Setup
═══════════════════════════════════════════════════════
✅ Authenticated as: you@example.com
   User ID: abc-123-def-456

═══════════════════════════════════════════════════════
  STEP 2: Create Workflow Agent
═══════════════════════════════════════════════════════
✅ Workflow agent created successfully
   Agent ID: agent_xyz_789
   Agent Name: Comprehensive Test Workflow
   Total Steps: 13
   Step Types: {"transform":10,"human_approval":2}

═══════════════════════════════════════════════════════
  STEP 3: Execute Workflow
═══════════════════════════════════════════════════════
✅ Workflow execution started
   Execution ID: exec_123_456
   Time to start: 234ms

═══════════════════════════════════════════════════════
  STEP 4: Monitor Execution Progress
═══════════════════════════════════════════════════════
📊 Status: RUNNING
   Current Step: validate_request
📊 Status: RUNNING
   Current Step: check_budget_limits

═══════════════════════════════════════════════════════
  ⏸️  WORKFLOW PAUSED - APPROVAL REQUIRED
═══════════════════════════════════════════════════════
📋 Approval: Finance Review Required: Budget Increase Request
   Approval ID: approval_exec_123_finance_approval_1730000000000
   Approval Type: any
   Approvers: 1
   Timeout: escalate on timeout

   🔗 Approval URL:
   http://localhost:3000/approvals/approval_exec_123_finance_approval_1730000000000

   💡 To approve via API:
   curl -X POST http://localhost:3000/api/approvals/approval_exec_123_finance_approval_1730000000000/respond \
     -H "Content-Type: application/json" \
     -d '{"userId": "abc-123", "decision": "approve", "comment": "Approved via test script"}'

⏳ Waiting for approvals...
💡 Please approve in the UI or use the curl command above
```

### Interactive Approval

The test will PAUSE and wait for you to approve the requests. You have 3 options:

**Option 1: Use the UI**
```
1. Open http://localhost:3000/dashboard
2. You'll see pending approval notifications
3. Click "Review & Approve"
4. Approve the request
```

**Option 2: Use the curl command**
```bash
# Copy the curl command from the test output
curl -X POST http://localhost:3000/api/approvals/[approval-id]/respond \
  -H "Content-Type: application/json" \
  -d '{"userId": "[your-user-id]", "decision": "approve", "comment": "Test approval"}'
```

**Option 3: Wait for timeout**
```
# Finance approval: Escalates after 30 minutes
# Manager approval: Auto-rejects after 1 hour
```

### After Approval

Once approved, the workflow continues:

```
📊 Status: RUNNING
   Current Step: manager_approval

... (waiting for manager approval) ...

📊 Status: RUNNING
   Current Step: generate_summary
�� Status: RUNNING
   Current Step: notify_finance
📊 Status: COMPLETED

═══════════════════════════════════════════════════════
  EXECUTION COMPLETE
═══════════════════════════════════════════════════════
✅ Final Status: COMPLETED
   Final Result: {...}

═══════════════════════════════════════════════════════
  STEP 5: Execution Summary
═══════════════════════════════════════════════════════
📊 Execution Statistics
   Status: completed
   Started At: 2025-11-02T10:00:00Z
   Completed At: 2025-11-02T10:15:23Z
   Duration: 923.45s

📝 State History (25 snapshots)
   Steps Executed: 13
   Final Variables: 15

✋ Approval Requests (2)
   Approval: Finance Review Required
   Status: approved
   Created: 2025-11-02T10:05:00Z
   Responses: 1
      - approve by abc-123 at 2025-11-02T10:06:15Z

   Approval: Manager Approval Required
   Status: approved
   Created: 2025-11-02T10:06:30Z
   Responses: 1
      - approve by abc-123 at 2025-11-02T10:07:45Z

📜 Audit Trail (6 events)
   2025-11-02T10:05:00Z - APPROVAL_REQUESTED by system
   2025-11-02T10:06:15Z - APPROVAL_APPROVED by abc-123
   2025-11-02T10:06:30Z - APPROVAL_REQUESTED by system
   2025-11-02T10:07:45Z - APPROVAL_APPROVED by abc-123
   2025-11-02T10:15:20Z - EXECUTION_COMPLETED by system

═══════════════════════════════════════════════════════
  ✅ TEST COMPLETE
═══════════════════════════════════════════════════════

📚 Features Tested:
   ✅ Sequential step execution
   ✅ Parallel step execution
   ✅ Variable interpolation
   ✅ Conditional steps
   ✅ Human approvals (Phase 6)
   ✅ Retry policies
   ✅ Error handling
   ✅ State management
   ✅ Audit logging

🎉 All Pilot features are working!
```

---

## Database Verification

After the test completes, you can verify the data in the database:

### Check Execution Record

```sql
SELECT
  id,
  agent_id,
  status,
  current_step,
  started_at,
  completed_at,
  result
FROM workflow_executions
WHERE id = 'your-execution-id';
```

### Check State Snapshots

```sql
SELECT
  id,
  execution_id,
  current_step,
  completed_steps,
  created_at
FROM workflow_execution_state
WHERE execution_id = 'your-execution-id'
ORDER BY created_at ASC;
```

### Check Approval Requests

```sql
SELECT
  id,
  execution_id,
  step_id,
  title,
  status,
  approvers,
  approval_type,
  created_at
FROM workflow_approval_requests
WHERE execution_id = 'your-execution-id';
```

### Check Approval Responses

```sql
SELECT
  r.id,
  r.approval_id,
  r.approver_id,
  r.decision,
  r.comment,
  r.responded_at,
  a.title as approval_title
FROM workflow_approval_responses r
JOIN workflow_approval_requests a ON r.approval_id = a.id
WHERE a.execution_id = 'your-execution-id';
```

### Check Audit Trail

```sql
SELECT
  action,
  user_id,
  entity_id,
  resource_name,
  details,
  created_at
FROM audit_trail
WHERE details->>'executionId' = 'your-execution-id'
ORDER BY created_at ASC;
```

---

## Troubleshooting

### Test Hangs at Approval

**Problem**: Script waits indefinitely for approval
**Solution**:
1. Check browser console for errors
2. Verify approval card shows on dashboard
3. Use curl command to approve manually
4. Check approval request was created in database

### Workflow Fails Immediately

**Problem**: Execution status shows "failed"
**Solution**:
1. Check execution error field
2. Review step definitions for syntax errors
3. Verify all dependencies are valid
4. Check variable interpolation syntax

### Approvals Not Showing

**Problem**: UserPendingApprovals component doesn't show
**Solution**:
1. Check browser console logs
2. Verify user ID matches approvers array
3. Check approval status is "pending"
4. Verify database query in UserPendingApprovals.tsx

### Timeout Not Working

**Problem**: Approval doesn't escalate/reject on timeout
**Solution**:
1. Verify timeout value in milliseconds
2. Check ApprovalTracker.checkTimeout() is being called
3. Review timeout action configuration
4. Check escalation targets exist

---

## Success Criteria

The test is successful when:

- ✅ All 13 steps execute
- ✅ Parallel steps run simultaneously
- ✅ Variables interpolate correctly
- ✅ Conditional step executes based on condition
- ✅ Workflow pauses for approvals
- ✅ Approvals appear in dashboard
- ✅ Workflow resumes after approval
- ✅ Final status is "completed"
- ✅ All audit events logged
- ✅ State snapshots saved

---

## Next Steps

After successful test completion:

1. **Review Audit Trail** - Verify all events logged correctly
2. **Test Error Scenarios** - Modify workflow to trigger errors
3. **Test Timeout Scenarios** - Wait for timeouts to verify escalation
4. **Test Rejection** - Reject approvals to test rejection path
5. **Performance Testing** - Create workflows with many steps

---

## Related Documentation

- [Phase 6: Human-in-the-Loop](PHASE_6_HUMAN_IN_THE_LOOP.md)
- [Phase 6: Audit Logging](PHASE_6_AUDIT_LOGGING.md)
- [Pilot Design](PILOT_DESIGN.md)
- [Pilot Implementation Plan](PILOT_IMPLEMENTATION_PLAN.md)

---

*Document Last Updated: November 2, 2025*
