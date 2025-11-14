# Phase 6: Human-in-the-Loop - Example Workflow

**Date**: November 2, 2025
**Phase**: 6 of 9
**Status**: ✅ Complete

---

## Example Workflow: Purchase Order Approval

This example demonstrates a workflow that requires manager approval for purchase orders over $1,000.

### Workflow Definition

```typescript
const purchaseOrderWorkflow = {
  name: "Purchase Order Processing",
  description: "Process purchase orders with automatic approval for small amounts, manager approval for large amounts",
  workflow_steps: [
    // Step 1: Validate purchase order
    {
      id: "validate_po",
      name: "Validate Purchase Order",
      type: "transform",
      operation: "extract",
      input: "{{user_input}}",
      fields: ["vendor", "amount", "description", "department"],
      outputVariable: "po_data"
    },

    // Step 2: Check if amount requires approval
    {
      id: "check_amount",
      name: "Check If Approval Needed",
      type: "conditional",
      condition: "{{po_data.amount}} > 1000",
      onTrue: ["request_approval"],
      onFalse: ["auto_approve"]
    },

    // Step 3a: Request manager approval (for amounts > $1,000)
    {
      id: "request_approval",
      name: "Request Manager Approval",
      type: "human_approval",
      approvers: ["manager_user_id_1", "manager_user_id_2"], // Replace with actual user IDs
      approvalType: "any", // Any one manager can approve
      title: "Purchase Order Approval Required",
      message: "Please review and approve this purchase order:\n\n" +
               "Vendor: {{po_data.vendor}}\n" +
               "Amount: ${{po_data.amount}}\n" +
               "Description: {{po_data.description}}\n" +
               "Department: {{po_data.department}}",
      context: {
        vendor: "{{po_data.vendor}}",
        amount: "{{po_data.amount}}",
        description: "{{po_data.description}}",
        department: "{{po_data.department}}"
      },
      timeout: 3600000, // 1 hour (in milliseconds)
      onTimeout: "escalate",
      escalateTo: ["senior_manager_user_id"], // Replace with actual user ID
      notificationChannels: [
        {
          type: "email",
          config: {
            to: ["manager1@company.com", "manager2@company.com"],
            subject: "URGENT: Purchase Order Approval Required"
          }
        },
        {
          type: "slack",
          config: {
            channel: "#approvals",
            webhook_url: "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
          }
        }
      ],
      requireComment: false,
      allowDelegate: true,
      dependencies: ["check_amount"]
    },

    // Step 3b: Auto-approve (for amounts <= $1,000)
    {
      id: "auto_approve",
      name: "Auto Approve Small Purchase",
      type: "transform",
      operation: "set",
      input: "approved",
      outputVariable: "approval_status",
      dependencies: ["check_amount"]
    },

    // Step 4: Process approved purchase order
    {
      id: "process_po",
      name: "Process Purchase Order",
      type: "action",
      plugin: "erp_system",
      action: "create_purchase_order",
      parameters: {
        vendor: "{{po_data.vendor}}",
        amount: "{{po_data.amount}}",
        description: "{{po_data.description}}",
        department: "{{po_data.department}}",
        approved_by: "{{request_approval.approver || 'auto'}}",
        approved_at: "{{request_approval.approved_at || 'now'}}"
      },
      dependencies: ["request_approval", "auto_approve"]
    },

    // Step 5: Send confirmation
    {
      id: "send_confirmation",
      name: "Send Confirmation Email",
      type: "action",
      plugin: "email",
      action: "send",
      parameters: {
        to: "{{po_data.requester_email}}",
        subject: "Purchase Order Processed",
        body: "Your purchase order for ${{po_data.amount}} has been processed.\n\n" +
              "PO Number: {{process_po.po_number}}\n" +
              "Status: Approved\n" +
              "Approved by: {{request_approval.approver || 'Auto-approved'}}"
      },
      dependencies: ["process_po"]
    }
  ]
};
```

---

## Example Workflow: Multi-Level Approval

This example shows a workflow with multiple approval levels based on amount thresholds.

```typescript
const multiLevelApprovalWorkflow = {
  name: "Expense Report Approval",
  description: "Multi-level approval workflow for expense reports",
  workflow_steps: [
    // Step 1: Parse expense report
    {
      id: "parse_expenses",
      name: "Parse Expense Report",
      type: "transform",
      operation: "extract",
      input: "{{user_input}}",
      fields: ["employee", "total_amount", "expense_items", "purpose"],
      outputVariable: "expense_data"
    },

    // Step 2: Determine approval path using switch
    {
      id: "determine_approval_level",
      name: "Determine Approval Level",
      type: "switch",
      evaluate: "{{expense_data.total_amount}}",
      cases: {
        "< 500": ["auto_approve_small"],
        ">= 500 && < 5000": ["manager_approval"],
        ">= 5000 && < 25000": ["director_approval"],
        ">= 25000": ["executive_approval"]
      }
    },

    // Level 1: Auto-approve (< $500)
    {
      id: "auto_approve_small",
      name: "Auto Approve Small Expense",
      type: "transform",
      operation: "set",
      input: { approved: true, level: "auto" },
      outputVariable: "approval_result",
      dependencies: ["determine_approval_level"]
    },

    // Level 2: Manager approval ($500 - $5,000)
    {
      id: "manager_approval",
      name: "Manager Approval Required",
      type: "human_approval",
      approvers: ["{{expense_data.employee.manager_id}}"],
      approvalType: "all",
      title: "Expense Report: {{expense_data.employee}} - ${{expense_data.total_amount}}",
      message: "Please review this expense report.",
      timeout: 86400000, // 24 hours
      onTimeout: "reject",
      dependencies: ["determine_approval_level"]
    },

    // Level 3: Director approval ($5,000 - $25,000)
    {
      id: "director_approval",
      name: "Director Approval Required",
      type: "human_approval",
      approvers: ["director_user_id_1", "director_user_id_2"],
      approvalType: "majority",
      title: "High-Value Expense: ${{expense_data.total_amount}}",
      message: "Large expense requires director approval.",
      timeout: 172800000, // 48 hours
      onTimeout: "escalate",
      escalateTo: ["cfo_user_id"],
      requireComment: true,
      dependencies: ["determine_approval_level"]
    },

    // Level 4: Executive approval (>= $25,000)
    {
      id: "executive_approval",
      name: "Executive Approval Required",
      type: "human_approval",
      approvers: ["cfo_user_id", "ceo_user_id"],
      approvalType: "all",
      title: "URGENT: Executive Approval - ${{expense_data.total_amount}}",
      message: "Critical expense requiring executive sign-off.",
      timeout: 259200000, // 72 hours
      onTimeout: "reject",
      requireComment: true,
      notificationChannels: [
        {
          type: "email",
          config: {
            to: ["cfo@company.com", "ceo@company.com"],
            priority: "high"
          }
        }
      ],
      dependencies: ["determine_approval_level"]
    },

    // Final: Process expense
    {
      id: "process_expense",
      name: "Process Approved Expense",
      type: "action",
      plugin: "accounting",
      action: "process_expense_report",
      parameters: {
        expense_data: "{{expense_data}}",
        approval_chain: "{{approval_result}}"
      },
      dependencies: ["auto_approve_small", "manager_approval", "director_approval", "executive_approval"]
    }
  ]
};
```

---

## User Experience Flow

### 1. Workflow Execution Starts

When a workflow with `human_approval` steps executes:

1. **Workflow runs normally** until it hits the approval step
2. **Workflow pauses** with status `'paused'`
3. **Approval request created** in database (`workflow_approval_requests` table)
4. **Notifications sent** via configured channels (email, Slack, etc.)
5. **Dashboard shows alert** - User sees pending approval card on dashboard

### 2. Approver Receives Notification

The approver receives notifications through multiple channels:

**Email Example:**
```
Subject: URGENT: Purchase Order Approval Required

You have a pending approval request:

Title: Purchase Order Approval Required
Message: Please review and approve this purchase order:

Vendor: Acme Supplies Inc.
Amount: $5,500
Description: Office furniture for new department
Department: Operations

Click here to review and approve:
https://app.neuronforge.com/approvals/approval_123abc

This request will expire in 1 hour.
```

**Slack Message:**
```
🖐 Approval Required

Purchase Order Approval Required

Please review and approve this purchase order:
Vendor: Acme Supplies Inc.
Amount: $5,500
Description: Office furniture for new department

[Approve ✅]  [Reject ❌]

View Details: https://app.neuronforge.com/approvals/approval_123abc
```

### 3. Dashboard Alert

When the user logs into NeuronForge, they see:

```
┌─────────────────────────────────────────────────────────┐
│ 🖐 Approval Required                                     │
│ 1 workflow waiting for your approval                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Purchase Order Approval Required           [PENDING]   │
│ Please review and approve this purchase order...       │
│                                                         │
│ Created: Nov 2, 2025 at 2:30 PM                       │
│ Expires: 3:30 PM                                       │
│                                                         │
│ Requires: any                                          │
│                                                         │
│           [Review & Approve]                           │
└─────────────────────────────────────────────────────────┘
```

### 4. Approval Page

Clicking "Review & Approve" takes the user to `/approvals/{id}`:

```
┌─────────────────────────────────────────────────────────┐
│ ✋ Approval Required                                     │
│ Status: PENDING                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Purchase Order Approval Required                       │
│                                                         │
│ Please review and approve this purchase order:         │
│                                                         │
│ Vendor: Acme Supplies Inc.                             │
│ Amount: $5,500                                         │
│ Description: Office furniture for new department        │
│ Department: Operations                                  │
│                                                         │
│ Approval Type: any                                     │
│ Approvers: 2 user(s)                                   │
│ Created: Nov 2, 2025, 2:30:45 PM                      │
│ Expires: Nov 2, 2025, 3:30:45 PM                      │
│                                                         │
│ ┌────────────────────────────────────────────────┐    │
│ │ Comment (optional):                            │    │
│ │ ┌────────────────────────────────────────────┐ │    │
│ │ │ Add a comment about your decision...        │ │    │
│ │ └────────────────────────────────────────────┘ │    │
│ └────────────────────────────────────────────────┘    │
│                                                         │
│ [✅ Approve]               [❌ Reject]                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 5. After Approval

Once approved:

1. **Response recorded** in `workflow_approval_responses` table
2. **Approval status updated** to `'approved'` or `'rejected'`
3. **Polling loop detects change** (checks every 5 seconds)
4. **Workflow resumes** with status back to `'running'`
5. **Next steps execute** with approval result in context
6. **Dashboard updated** - Approval card disappears

---

## Testing the Approval Flow

### Step 1: Create Test Users

```sql
-- Get your user ID
SELECT id FROM auth.users WHERE email = 'your-email@example.com';

-- You can use your own user ID as an approver for testing
```

### Step 2: Create a Simple Test Workflow

Create an agent with this workflow in the Smart Agent Builder:

```typescript
{
  workflow_steps: [
    {
      id: "step1",
      name: "Request Test Approval",
      type: "human_approval",
      approvers: ["YOUR_USER_ID"], // Replace with your actual user ID
      approvalType: "any",
      title: "Test Approval Request",
      message: "This is a test approval. Please approve or reject.",
      context: {
        test: "This is a test"
      },
      timeout: 3600000, // 1 hour
      onTimeout: "reject"
    },
    {
      id: "step2",
      name: "Show Result",
      type: "transform",
      operation: "set",
      input: "Approval completed!",
      outputVariable: "final_result",
      dependencies: ["step1"]
    }
  ]
}
```

### Step 3: Execute the Workflow

1. Navigate to your agent page
2. Click "Test" to expand the test playground
3. Fill in any required inputs
4. Click "Run"

### Step 4: Observe the Pause

You'll see:
- Workflow status changes to "paused"
- Execution logs show "Waiting for approval..."
- Dashboard shows pending approval alert

### Step 5: Approve the Request

1. Go to Dashboard (or click notification)
2. See pending approval card
3. Click "Review & Approve"
4. On approval page, click "✅ Approve"

### Step 6: Workflow Resumes

- Workflow status changes back to "running"
- Remaining steps execute
- Final result shown

---

## API Usage Examples

### Check Approval Status

```typescript
// GET /api/approvals/{approval_id}/respond
const response = await fetch('/api/approvals/approval_123/respond');
const { approval } = await response.json();

console.log('Status:', approval.status); // 'pending', 'approved', 'rejected', 'timeout'
console.log('Responses:', approval.responses);
```

### Submit Approval Response

```typescript
// POST /api/approvals/{approval_id}/respond
const response = await fetch('/api/approvals/approval_123/respond', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'user_123',
    decision: 'approve', // or 'reject'
    comment: 'Looks good, approved!'
  })
});

const { success, approval } = await response.json();
```

---

## Database Queries

### Find All Pending Approvals for a User

```sql
SELECT
  ar.id,
  ar.title,
  ar.message,
  ar.created_at,
  ar.expires_at,
  ar.status,
  we.agent_id,
  a.agent_name
FROM workflow_approval_requests ar
JOIN workflow_executions we ON ar.execution_id = we.id
JOIN agents a ON we.agent_id = a.id
WHERE
  'YOUR_USER_ID' = ANY(ar.approvers)
  AND ar.status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM workflow_approval_responses resp
    WHERE resp.approval_id = ar.id
    AND resp.approver_id = 'YOUR_USER_ID'
  )
ORDER BY ar.created_at DESC;
```

### Check If User Has Responded

```sql
SELECT COUNT(*) as response_count
FROM workflow_approval_responses
WHERE approval_id = 'approval_123'
AND approver_id = 'user_123';
```

### Get Approval Statistics

```sql
SELECT
  COUNT(*) FILTER (WHERE status = 'approved') as approved_count,
  COUNT(*) FILTER (WHERE status = 'rejected') as rejected_count,
  COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
  COUNT(*) FILTER (WHERE status = 'timeout') as timeout_count,
  AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) as avg_response_time_seconds
FROM workflow_approval_requests
WHERE created_at >= NOW() - INTERVAL '30 days';
```

---

## Best Practices

### 1. Timeout Configuration

- **Short timeouts** (1-4 hours): Urgent approvals like purchase orders
- **Medium timeouts** (24-48 hours): Regular approvals like expense reports
- **Long timeouts** (72+ hours): Strategic decisions requiring deliberation

### 2. Approval Type Selection

- **`any`**: Quick decisions, backup approvers
- **`all`**: Critical decisions requiring consensus
- **`majority`**: Balanced approach for team decisions

### 3. Escalation Strategy

- Always set `escalateTo` when using `onTimeout: 'escalate'`
- Escalate to higher authority level
- Limit escalation chains to prevent infinite loops

### 4. Notification Channels

- **Email**: Always include for audit trail
- **Slack/Teams**: For real-time urgent approvals
- **Webhooks**: For custom integrations

### 5. Context Data

- Include all relevant decision-making information
- Keep context concise but complete
- Avoid sensitive data in message field (use context instead)

---

## Troubleshooting

### Workflow Not Pausing

**Problem**: Workflow completes without waiting for approval

**Solutions**:
1. Check that `pilot_enabled` system config is `true`
2. Verify approval step has correct `type: 'human_approval'`
3. Check console logs for approval creation errors

### Approval Not Showing in Dashboard

**Problem**: Pending approval doesn't appear

**Solutions**:
1. Verify user ID is in `approvers` array
2. Check approval was created: `SELECT * FROM workflow_approval_requests WHERE id = 'approval_id'`
3. Ensure user hasn't already responded
4. Refresh dashboard (polls every 5 seconds)

### Workflow Not Resuming After Approval

**Problem**: Workflow stays paused after approval

**Solutions**:
1. Check approval status: should be `'approved'` or `'rejected'`
2. Verify workflow execution status: should change from `'paused'` to `'running'`
3. Check for errors in step execution logs
4. Polling interval is 5 seconds - wait briefly after approval

### Timeout Not Working

**Problem**: Approval doesn't timeout as expected

**Solutions**:
1. Verify `timeout` is in milliseconds (not seconds)
2. Check `expiresAt` field is set correctly
3. Timeout checking happens during polling - may take up to 5 seconds after expiry
4. Ensure `timeoutAction` is set

---

## Summary

Phase 6 Human-in-the-Loop provides:

✅ **Approval Requests** - Pause workflows for human input
✅ **Multiple Approvers** - Support for `any`, `all`, `majority` logic
✅ **Timeout Handling** - Auto-approve, reject, or escalate
✅ **Multi-Channel Notifications** - Email, Slack, Teams, webhooks
✅ **Dashboard Integration** - Real-time approval alerts
✅ **Approval UI** - Dedicated pages for reviewing and responding
✅ **Database Tracking** - Full audit trail of all approvals
✅ **Workflow Integration** - Seamless pause/resume with context

**Next Phase**: Phase 7 - SmartAgentBuilder Integration (workflow UI)
