# AgentKit Trigger Condition Integration

## Overview
AgentKit now respects the `trigger_condintion` field from the `agents` table to determine how to deliver results to users.

## Trigger Condition Format

```json
{
  "error_handling": {
    "on_failure": "email",  // or "alert" or "dashboard"
    "retry_on_fail": true
  }
}
```

## Delivery Methods

### 1. Email Delivery (`on_failure: "email"`)

When set to email, OpenAI AgentKit will:
- Complete the requested task (e.g., search emails, process data)
- **Automatically send results via email** using the `google-mail.send_email` function
- Include a clear summary of what was accomplished
- Send to the user's email address

**Example Flow:**
1. User: "Summarize my last 10 emails"
2. AgentKit searches Gmail → finds 10 emails
3. AgentKit generates summary
4. **AgentKit sends email with summary** ✅
5. Returns confirmation that email was sent

### 2. Dashboard/Alert Delivery (`on_failure: "alert"` or `"dashboard"`)

When set to alert/dashboard, OpenAI AgentKit will:
- Complete the requested task
- **Return results directly** without sending emails
- Results are displayed in the dashboard UI

**Example Flow:**
1. User: "Summarize my last 10 emails"
2. AgentKit searches Gmail → finds 10 emails
3. AgentKit generates summary
4. **Returns summary to dashboard** ✅
5. User sees results in UI immediately

## How It Works

### System Prompt Instructions

AgentKit dynamically adjusts the system prompt based on `trigger_condintion`:

**For Email Delivery:**
```
## IMPORTANT: Result Delivery
- After completing the task, you MUST send the results via email using the google-mail send_email function
- Send the email to the user with a clear summary of what was accomplished
- Include all relevant details, results, and next steps in the email body
- The email subject should clearly describe the task completed
```

**For Dashboard Delivery:**
```
## IMPORTANT: Result Delivery
- Complete the task and return a clear summary
- Do NOT send emails unless explicitly requested in the task
- Return results directly for dashboard display
```

## Implementation Details

### Files Modified

1. **`/lib/agentkit/runAgentKit.ts`**
   - Added `trigger_condintion` to agent parameter
   - Reads `trigger_condintion?.error_handling?.on_failure`
   - Dynamically builds system prompt based on delivery method
   - Logs delivery method: `📬 AgentKit: Delivery method set to "email"`

2. **`/app/api/run-agent/route.ts`**
   - Passes `trigger_condintion` to `runAgentKit()`
   - Checks delivery preference after execution
   - Logs email notification preference

3. **`/app/api/cron/process-queue/route.ts`**
   - Passes `trigger_condintion` to `runAgentKit()` for queued executions

## Usage Examples

### Example 1: Email Summary Agent

**Agent Configuration:**
```json
{
  "agent_name": "Email Summary Agent",
  "user_prompt": "Summarize my last 10 emails",
  "plugins_required": ["google-mail"],
  "trigger_condintion": {
    "error_handling": {
      "on_failure": "email"
    }
  }
}
```

**Behavior:**
- Searches Gmail for 10 emails ✅
- Generates summary ✅
- Sends email with summary ✅
- User receives email in inbox 📧

### Example 2: Dashboard Analytics Agent

**Agent Configuration:**
```json
{
  "agent_name": "Sales Analytics",
  "user_prompt": "Analyze last month's sales data",
  "plugins_required": ["google-sheets"],
  "trigger_condintion": {
    "error_handling": {
      "on_failure": "alert"
    }
  }
}
```

**Behavior:**
- Fetches Google Sheets data ✅
- Performs analysis ✅
- Returns results to dashboard ✅
- User sees results in UI immediately 📊

## Benefits

1. **Flexible Delivery** - Same agent can deliver results via email or dashboard
2. **Smart Execution** - OpenAI understands delivery context and acts accordingly
3. **No Code Changes** - Change delivery method by updating `trigger_condintion` only
4. **Consistent Behavior** - Works for both manual and scheduled executions

## Migration Notes

- **Default behavior**: If `trigger_condintion` is missing or `on_failure` is not set, defaults to **"alert"** (dashboard delivery)
- **Backward compatible**: Existing agents without `trigger_condintion` continue to work normally
- **Email requirement**: For email delivery, `google-mail` plugin must be connected

## Monitoring

Check execution logs for delivery method confirmation:
```
📬 AgentKit: Delivery method set to "email"
📧 AgentKit: Sending result via email as per trigger_condintion
```

Or for dashboard:
```
📬 AgentKit: Delivery method set to "alert"
```

## Future Enhancements

Potential additions:
- SMS delivery option
- Slack/Teams notifications
- Webhook callbacks
- Multi-channel delivery (email + dashboard)
