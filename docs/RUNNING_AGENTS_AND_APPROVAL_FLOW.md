# Running Agents and Approval Flow Documentation

## Overview

The system now includes real-time tracking of running agent executions with full support for human-in-the-loop approval workflows. Users can see all active agents on their dashboard, track progress through workflow steps, and handle approval requests seamlessly.

## Components

### 1. RunningExecutionsCard Component

**Location**: `/components/dashboard/RunningExecutionsCard.tsx`

**Purpose**: Displays all currently running agent executions with real-time updates

**Features**:
- Real-time polling (updates every 5 seconds)
- Shows execution progress with visual progress bars
- Displays current step and completion percentage
- Highlights agents waiting for approval
- Click-to-navigate to approval page when approval needed
- Supports both manual and scheduled agent executions

**Visual Elements**:
- **Status Icons**:
  - `Loader2` (spinning) - Agent actively running
  - `HandMetal` (pulsing) - Waiting for approval
  - `Clock` - Paused execution
  - `CheckCircle` - All completed

- **Progress Bar**:
  - Blue/purple gradient for running agents
  - Orange gradient for approval-pending agents
  - Shows step X of Y with percentage

- **Status Colors**:
  - Blue for running
  - Orange for waiting approval
  - Yellow for paused

### 2. Dashboard Integration

**Location**: `/app/(protected)/dashboard/page.tsx`

The RunningExecutionsCard is displayed after the "Quick Overview" statistics cards, providing immediate visibility into active workflows.

```tsx
{/* Running Agents Card */}
{user && <RunningExecutionsCard userId={user.id} />}
```

### 3. Approval Page Enhancement

**Location**: `/app/(protected)/approvals/[id]/page.tsx`

**Enhancement**: After approving or rejecting an approval request, users are automatically redirected back to the dashboard after 1 second, where they can see the workflow continue or stop.

## Workflow Execution Tracking

### Database Schema

The system tracks executions using:

1. **workflow_executions** table:
   - `execution_id`: Unique identifier
   - `agent_id`: Reference to the agent
   - `status`: 'running', 'waiting_approval', 'paused', 'completed', 'failed'
   - `execution_state`: JSON containing:
     - `currentStep`: ID of current step
     - `completedSteps`: Array of completed step IDs
     - Other execution metadata

2. **approval_requests** table:
   - Links to execution via `execution_id`
   - Tracks `status`: 'pending', 'approved', 'rejected', 'timeout'
   - Contains approver list and responses

3. **agents** table:
   - `pilot_steps`: Array of workflow steps
   - `mode`: 'manual' or 'scheduled'

### Step Progress Calculation

```typescript
const stepOrder = currentStepId
  ? pilotSteps.findIndex((s: any) => s.id === currentStepId) + 1
  : completedSteps.length + 1

const progressPercentage = (completedSteps.length / totalSteps) * 100
```

## Approval Flow

### User Journey

1. **Agent Starts Execution**
   - Agent begins executing through workflow steps
   - Execution appears in "Running Agents" card on dashboard
   - Real-time progress updates every 5 seconds

2. **Approval Step Reached**
   - Execution status changes to 'waiting_approval'
   - Approval request created in database
   - Card updates to show "Approval Needed" badge (orange)
   - Card becomes clickable

3. **User Clicks Approval Card**
   - Redirected to `/approvals/{approval_id}`
   - Shows approval details with context
   - Displays all workflow step information
   - Shows what needs approval and why

4. **User Approves**
   - Response recorded with decision: 'approve'
   - Approval status calculated based on approval type:
     - **any**: First approval passes
     - **all**: All approvers must approve
     - **majority**: More than half must approve
   - If approved: execution continues to next step
   - User redirected to dashboard
   - Card shows agent continuing execution

5. **User Rejects**
   - Response recorded with decision: 'reject'
   - Approval status calculation:
     - **any**: Only fails if all reject
     - **all**: Single rejection fails immediately
     - **majority**: Fails if majority can't be reached
   - If rejected: execution marked as 'failed'
   - User redirected to dashboard
   - Card disappears (no longer in 'running' status)

### Rejection Handling

When a rejection occurs:

```typescript
// In ApprovalTracker.ts
case 'all':
  // All must approve
  if (approvals === totalApprovers) return 'approved';
  // Any single rejection fails it
  if (rejections > 0) return 'rejected';
  return 'pending';
```

**Outcomes**:
- Execution status changes from 'waiting_approval' to 'failed'
- Workflow does not continue past approval step
- Execution removed from "Running Agents" card
- User can view failure in agent logs/history

## Real-Time Updates

The RunningExecutionsCard polls every 5 seconds to fetch:

1. Current workflow executions with status in ['running', 'waiting_approval', 'paused']
2. Agent details including name and pilot_steps
3. Pending approval requests linked to executions
4. Execution state to calculate progress

This ensures users always see up-to-date information about:
- Which agents are running
- Current step and progress
- Which agents need approval
- Real-time status changes

## User Experience Flow

### Scenario 1: Agent with Approval (Approved)
```
1. Dashboard → See agent running (Step 2 of 5, 40%)
2. Agent reaches approval step → Card turns orange "Approval Needed"
3. Click card → Approval page
4. Review context and approve → Redirected to dashboard
5. Dashboard → See agent continuing (Step 4 of 5, 80%)
6. Agent completes → Card disappears, appears in "Recent Activity"
```

### Scenario 2: Agent with Approval (Rejected)
```
1. Dashboard → See agent running (Step 2 of 5, 40%)
2. Agent reaches approval step → Card turns orange "Approval Needed"
3. Click card → Approval page
4. Review context and reject → Redirected to dashboard
5. Dashboard → Agent card disappears (execution failed)
6. View failure details in alerts/logs
```

### Scenario 3: Scheduled Agent
```
1. Agent triggers on schedule (e.g., every hour)
2. Dashboard → See agent running with schedule badge
3. Tracks progress same as manual execution
4. Completes automatically if no approval needed
5. If approval needed, follows approval flow
```

## Technical Implementation

### Component Props
```typescript
interface RunningExecution {
  execution_id: string
  agent_id: string
  agent_name: string
  status: string
  current_step: string | null
  step_title: string
  step_order: number
  total_steps: number
  completed_steps: string[]
  created_at: string
  has_pending_approval: boolean
  approval_id?: string
}
```

### Key Functions

**fetchRunningExecutions()**
- Queries workflow_executions for running agents
- Joins with agents table for pilot_steps
- Checks approval_requests for pending approvals
- Calculates step progress and current position

**handleExecutionClick()**
- If has pending approval → Navigate to approval page
- Otherwise → No action (could extend to show execution details)

**getStatusIcon() / getStatusColor()**
- Returns appropriate icons and colors based on status
- Special handling for approval-pending state

## Configuration

### Polling Interval
```typescript
// Update every 5 seconds
const interval = setInterval(fetchRunningExecutions, 5000)
```

To adjust frequency, modify the interval value (in milliseconds).

### Execution Limit
```typescript
.limit(20) // Show up to 20 running executions
```

Adjust based on expected concurrent execution volume.

## Future Enhancements

Potential improvements:
1. WebSocket integration for instant updates instead of polling
2. Click execution card to see detailed step-by-step view
3. Pause/resume execution from dashboard
4. Bulk approval for multiple pending approvals
5. Execution time estimates and ETA
6. Filter/sort running executions
7. Execution history timeline view
8. Desktop notifications for approval requests

## Error Handling

The component gracefully handles:
- Network errors during fetch (logs to console, shows last successful state)
- Missing agent data (shows "Unknown Agent")
- No pilot_steps (defaults to basic progress tracking)
- Invalid execution state (uses safe defaults)

## Testing

To test the approval flow:

1. Create an agent with an approval step in pilot_steps
2. Run the agent from agent page
3. Check dashboard - should appear in Running Agents
4. Wait for approval step - card should turn orange
5. Click card to go to approval page
6. Test both approve and reject paths
7. Verify dashboard updates correctly
8. Check execution logs for final status

## Summary

The Running Agents card provides real-time visibility into active workflows with seamless approval handling. Users can track progress, respond to approvals, and see results immediately - all from their dashboard. The system handles both approvals and rejections appropriately, ensuring workflows complete successfully or fail gracefully based on human decisions.
