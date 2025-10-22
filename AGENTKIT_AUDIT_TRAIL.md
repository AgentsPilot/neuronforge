# AgentKit Audit Trail System

## Overview

AgentKit now integrates with the **Enterprise Audit Trail System** to automatically log all execution events, plugin calls, successes, and failures to the `audit_trail` table for compliance and monitoring.

## What Gets Audited

Every AgentKit execution generates multiple audit trail entries throughout its lifecycle:

### 1. Execution Start
**Event**: `AGENTKIT_EXECUTION_STARTED`
**Severity**: `info`
**Compliance**: SOC2

Logged when an agent begins execution via AgentKit.

**Details Captured**:
```json
{
  "sessionId": "session_1704123456789_a3b9c4d7e",
  "plugins_required": ["google-mail", "notion"],
  "execution_mode": "agentkit",
  "model": "gpt-4o",
  "user_input": "Summarize my last 10 emails...",
  "has_input_values": true,
  "trigger_condition": {...}
}
```

### 2. Plugin Execution Success
**Event**: `AGENTKIT_PLUGIN_SUCCESS`
**Severity**: `info`
**Compliance**: SOC2

Logged for each successful plugin action execution.

**Details Captured**:
```json
{
  "sessionId": "session_1704123456789_a3b9c4d7e",
  "agent_id": "agent-uuid",
  "agent_name": "Email Summarizer",
  "action": "search_emails",
  "iteration": 2,
  "parameters_count": 3,
  "result_message": "Found 10 emails"
}
```

### 3. Plugin Execution Failure
**Event**: `AGENTKIT_PLUGIN_FAILED`
**Severity**: `warning`
**Compliance**: SOC2

Logged when a plugin action fails (API error, validation error, etc.).

**Details Captured**:
```json
{
  "sessionId": "session_1704123456789_a3b9c4d7e",
  "agent_id": "agent-uuid",
  "agent_name": "Email Summarizer",
  "action": "send_email",
  "iteration": 3,
  "error": "Invalid recipient email address",
  "parameters_count": 4
}
```

### 4. Execution Completion
**Event**: `AGENTKIT_EXECUTION_COMPLETED`
**Severity**: `info`
**Compliance**: SOC2

Logged when agent successfully completes all tasks.

**Details Captured**:
```json
{
  "sessionId": "session_1704123456789_a3b9c4d7e",
  "iterations": 4,
  "total_tokens": 9575,
  "execution_time_ms": 28700,
  "tool_calls_count": 3,
  "plugins_used": ["google-mail", "notion"],
  "response_length": 450
}
```

### 5. Max Iterations Reached
**Event**: `AGENTKIT_MAX_ITERATIONS_REACHED`
**Severity**: `warning`
**Compliance**: SOC2

Logged when agent reaches the maximum iteration limit (10 by default).

**Details Captured**:
```json
{
  "sessionId": "session_1704123456789_a3b9c4d7e",
  "max_iterations": 10,
  "total_tokens": 15234,
  "execution_time_ms": 45000,
  "tool_calls_count": 15,
  "plugins_attempted": ["google-mail", "slack", "notion"]
}
```

### 6. Execution Failure
**Event**: `AGENTKIT_EXECUTION_FAILED`
**Severity**: `warning`
**Compliance**: SOC2

Logged when agent execution fails due to system errors.

**Details Captured**:
```json
{
  "sessionId": "session_1704123456789_a3b9c4d7e",
  "error_message": "OpenAI API rate limit exceeded",
  "error_stack": "Error: Rate limit exceeded at...",
  "execution_time_ms": 5000,
  "tool_calls_attempted": 2,
  "plugins_used": ["google-mail"]
}
```

## Audit Trail Schema

All events are stored in the `audit_trail` table with these fields:

```sql
- id (uuid, primary key)
- user_id (uuid, foreign key to auth.users)
- actor_id (uuid, who performed the action)
- action (text, e.g., 'AGENTKIT_EXECUTION_STARTED')
- entity_type (text, e.g., 'agent' or 'plugin')
- entity_id (text, agent ID or plugin key)
- resource_name (text, agent name or "plugin.action")
- changes (jsonb, for update operations)
- details (jsonb, event-specific data)
- ip_address (text, user's IP)
- user_agent (text, browser/client info)
- session_id (text, links all events in one execution)
- severity ('info', 'warning', 'critical')
- compliance_flags (text[], e.g., ['SOC2', 'GDPR'])
- hash (text, tamper detection)
- created_at (timestamp with time zone)
```

## Compliance Features

### SOC2 Compliance
All AgentKit events are flagged with `['SOC2']` for:
- Access logging (who ran what agent when)
- Change tracking (plugin actions performed)
- Error monitoring (failures and security issues)
- Audit trail integrity (immutable logs)

### GDPR Considerations
- User data accessed/modified by plugins is logged
- Audit logs can be exported via `AuditTrail.exportUserData(userId)`
- Audit logs can be anonymized via `AuditTrail.anonymizeUserData(userId)`
- Retention policies automatically delete old logs (365 days default)

### Data Retention
- **Default logs**: 365 days
- **Critical events**: 2555 days (7 years)
- **GDPR max**: 90 days for PII-related logs

## Query Examples

### 1. Get all events from a single agent execution

```sql
SELECT
  action,
  entity_type,
  resource_name,
  details,
  severity,
  created_at
FROM audit_trail
WHERE session_id = 'session_1704123456789_a3b9c4d7e'
ORDER BY created_at;
```

### 2. Track all plugin failures for an agent

```sql
SELECT
  details->>'agent_name' as agent,
  resource_name as plugin_action,
  details->>'error' as error,
  created_at
FROM audit_trail
WHERE action = 'AGENTKIT_PLUGIN_FAILED'
  AND entity_id = 'agent-uuid'
ORDER BY created_at DESC
LIMIT 50;
```

### 3. Get agent execution success rate

```sql
SELECT
  COUNT(CASE WHEN action = 'AGENTKIT_EXECUTION_COMPLETED' THEN 1 END) as successes,
  COUNT(CASE WHEN action = 'AGENTKIT_EXECUTION_FAILED' THEN 1 END) as failures,
  COUNT(CASE WHEN action = 'AGENTKIT_MAX_ITERATIONS_REACHED' THEN 1 END) as timeouts,
  ROUND(
    COUNT(CASE WHEN action = 'AGENTKIT_EXECUTION_COMPLETED' THEN 1 END)::numeric /
    NULLIF(COUNT(*), 0) * 100,
    2
  ) as success_rate_percent
FROM audit_trail
WHERE action IN (
  'AGENTKIT_EXECUTION_COMPLETED',
  'AGENTKIT_EXECUTION_FAILED',
  'AGENTKIT_MAX_ITERATIONS_REACHED'
)
  AND entity_id = 'agent-uuid'
  AND created_at >= NOW() - INTERVAL '30 days';
```

### 4. Find most frequently used plugins

```sql
SELECT
  entity_id as plugin_key,
  COUNT(*) as total_calls,
  COUNT(CASE WHEN action = 'AGENTKIT_PLUGIN_SUCCESS' THEN 1 END) as successes,
  COUNT(CASE WHEN action = 'AGENTKIT_PLUGIN_FAILED' THEN 1 END) as failures,
  ROUND(
    COUNT(CASE WHEN action = 'AGENTKIT_PLUGIN_SUCCESS' THEN 1 END)::numeric /
    NULLIF(COUNT(*), 0) * 100,
    2
  ) as success_rate_percent
FROM audit_trail
WHERE entity_type = 'plugin'
  AND action IN ('AGENTKIT_PLUGIN_SUCCESS', 'AGENTKIT_PLUGIN_FAILED')
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY entity_id
ORDER BY total_calls DESC;
```

### 5. User activity timeline

```sql
SELECT
  action,
  resource_name,
  severity,
  details->>'sessionId' as session,
  created_at
FROM audit_trail
WHERE user_id = 'user-uuid'
  AND action LIKE 'AGENTKIT_%'
ORDER BY created_at DESC
LIMIT 100;
```

### 6. Security audit - failed executions

```sql
SELECT
  user_id,
  resource_name as agent,
  details->>'error_message' as error,
  ip_address,
  user_agent,
  created_at
FROM audit_trail
WHERE action IN ('AGENTKIT_EXECUTION_FAILED', 'AGENTKIT_PLUGIN_FAILED')
  AND severity = 'warning'
  AND created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```

## Programmatic Access

### Using AuditTrailService

```typescript
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const auditTrail = AuditTrailService.getInstance();

// Query agent executions
const results = await auditTrail.query({
  userId: 'user-uuid',
  action: ['AGENTKIT_EXECUTION_STARTED', 'AGENTKIT_EXECUTION_COMPLETED'],
  dateFrom: new Date('2025-01-01'),
  dateTo: new Date(),
  page: 1,
  limit: 50,
  sortBy: 'created_at',
  sortOrder: 'desc'
});

console.log(`Found ${results.total} audit logs`);
console.log(`Page ${results.page} of ${Math.ceil(results.total / results.limit)}`);
results.logs.forEach(log => {
  console.log(`${log.created_at}: ${log.action} - ${log.resource_name}`);
});
```

### Export user data (GDPR)

```typescript
// Export all audit data for a user
const gdprExport = await auditTrail.exportUserData('user-uuid');

console.log(`Exported ${gdprExport.totalEvents} events`);
console.log(`Date range: ${gdprExport.dateRange.from} to ${gdprExport.dateRange.to}`);
console.log(`Actions performed:`, gdprExport.summary.actionsPerformed);
console.log(`Entities modified:`, gdprExport.summary.entitiesModified);

// Save to file
await fs.writeFile(
  `user-data-export-${gdprExport.userId}.json`,
  JSON.stringify(gdprExport, null, 2)
);
```

### Anonymize user data (GDPR Right to Erasure)

```typescript
// Anonymize all audit logs for a user
const recordsAnonymized = await auditTrail.anonymizeUserData('user-uuid');

console.log(`Anonymized ${recordsAnonymized} audit log records`);
// This creates a new audit log entry documenting the anonymization
```

## Event Flow Diagram

```
User triggers agent
    ↓
[AGENTKIT_EXECUTION_STARTED] logged
    ↓
For each iteration:
    ↓
  OpenAI determines actions
    ↓
  For each plugin call:
      ↓
    Plugin executes
      ↓
    [AGENTKIT_PLUGIN_SUCCESS] or [AGENTKIT_PLUGIN_FAILED] logged
    ↓
  Iteration complete
    ↓
If successful:
  [AGENTKIT_EXECUTION_COMPLETED] logged
    ↓
If max iterations:
  [AGENTKIT_MAX_ITERATIONS_REACHED] logged
    ↓
If error:
  [AGENTKIT_EXECUTION_FAILED] logged
```

## Batching and Performance

The audit trail service uses **intelligent batching**:

- **Batch size**: 100 logs
- **Flush interval**: 5 seconds
- **Auto-flush**: When batch is full
- **Graceful shutdown**: Flushes remaining logs on process exit

This ensures minimal performance impact while maintaining audit integrity.

## Console Output

When running an agent, you'll see audit trail confirmations:

```
✅ Flushed 6 audit log(s)
```

This indicates all events from the execution have been persisted to the database.

## Related Files

- [lib/agentkit/runAgentKit.ts](lib/agentkit/runAgentKit.ts) - AgentKit execution with audit logging
- [lib/services/AuditTrailService.ts](lib/services/AuditTrailService.ts) - Core audit trail service
- [lib/audit/events.ts](lib/audit/events.ts) - Event definitions and metadata
- [lib/audit/types.ts](lib/audit/types.ts) - TypeScript types for audit system

## Comparison: Token Usage vs Audit Trail

| Feature | Token Usage (analytics) | Audit Trail (compliance) |
|---------|------------------------|-------------------------|
| **Purpose** | Cost tracking, optimization | Compliance, security, debugging |
| **Table** | `token_usage` | `audit_trail` |
| **Granularity** | Per OpenAI API call | Per execution event |
| **Data Focus** | Tokens, cost, latency | Actions, entities, changes |
| **Compliance** | Optional | Required (SOC2/GDPR) |
| **Retention** | Analytics retention | 365 days / 7 years |
| **Batching** | No | Yes (100 logs/5s) |

Both systems work together to provide complete observability:
- **Token Usage**: Answers "How much did this cost?"
- **Audit Trail**: Answers "What happened and who did it?"

## Benefits

1. **Compliance Ready**: Automatic SOC2 and GDPR-compliant logging
2. **Security Monitoring**: Track all actions for anomaly detection
3. **Debugging**: Reconstruct execution flow from audit logs
4. **Accountability**: Know exactly who ran what and when
5. **Analytics**: Measure success rates, plugin usage, error patterns
6. **Tamper Detection**: Optional cryptographic hashing for integrity
7. **User Privacy**: Built-in GDPR export and anonymization

## Best Practices

1. **Regular Review**: Monitor failed executions and plugin errors
2. **Retention Policies**: Configure appropriate retention for your compliance needs
3. **Index Optimization**: Ensure proper indexes on frequently queried fields
4. **Privacy**: Use `anonymizeUserData()` when users request data deletion
5. **Performance**: Audit batching is automatic, but monitor flush intervals in high-volume scenarios
6. **Querying**: Use `session_id` to group related events from a single execution
