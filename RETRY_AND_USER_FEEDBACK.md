# 🔄 QStash Retry Mechanism & User Feedback Guide

## Table of Contents
1. [How QStash Retries Work](#how-qstash-retries-work)
2. [Retry Tracking Implementation](#retry-tracking-implementation)
3. [Displaying Results to Users](#displaying-results-to-users)
4. [Real-time Updates](#real-time-updates)
5. [Error States & User Communication](#error-states--user-communication)

---

## 🔁 How QStash Retries Work

### **Automatic Retry Policy**

When an agent execution fails, QStash automatically retries with **exponential backoff**:

```typescript
// lib/queues/qstashQueue.ts
await client.publishJSON({
  url: `${baseUrl}/api/cron/process-queue`,
  body: jobData,
  retries: 3,  // Up to 3 retry attempts
});
```

### **Retry Timeline**

| Attempt | Timing | Status | Action |
|---------|--------|--------|--------|
| **1** (Initial) | Immediate | Fails (HTTP 500) | QStash waits ~30 seconds |
| **2** (Retry 1) | +30 seconds | Fails (HTTP 500) | QStash waits ~90 seconds |
| **3** (Retry 2) | +2 minutes | Fails (HTTP 500) | QStash waits ~4.5 minutes |
| **4** (Retry 3) | +6.5 minutes | Fails (HTTP 500) | **Permanently failed** |

**Total Time**: ~7 minutes before final failure

**Exponential Backoff Formula**:
```
Delay = base_delay * (2 ^ retry_count)
30s → 90s → 270s
```

---

## 📊 Retry Tracking Implementation

### **1. QStash Headers**

QStash sends retry information in HTTP headers:

```typescript
// Headers sent by QStash
"upstash-retried": "0"  // Initial attempt
"upstash-retried": "1"  // First retry
"upstash-retried": "2"  // Second retry
"upstash-retried": "3"  // Third retry (final)
```

### **2. Enhanced Worker Endpoint**

The `/api/cron/process-queue` endpoint now tracks retries:

```typescript
// app/api/cron/process-queue/route.ts
async function handler(req: NextRequest) {
  // Extract retry count from QStash headers
  const retryCount = parseInt(req.headers.get('upstash-retried') || '0');
  const isRetry = retryCount > 0;

  console.log('📨 Received job from QStash:', {
    agent_id: body.agent_id,
    execution_id: body.execution_id,
    retry_count: retryCount,
    is_retry: isRetry,
  });

  // Update execution record with retry count
  if (isRetry) {
    await updateExecution(execution_id, {
      retry_count: retryCount,
      status: 'running',
    });

    // Log the retry attempt
    await insertExecutionLog(
      execution_id,
      agent_id,
      user_id,
      'warning',
      `Retry attempt ${retryCount}/3 after previous failure`,
      'retry'
    );
  }

  // Process the job...
}
```

### **3. Database Schema**

The `agent_executions` table tracks retry information:

```sql
CREATE TABLE agent_executions (
  id UUID PRIMARY KEY,
  agent_id UUID REFERENCES agents(id),
  user_id UUID,
  status TEXT CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  retry_count INTEGER DEFAULT 0,  -- ⭐ Tracks retry attempts
  error_message TEXT,
  result JSONB,
  execution_duration_ms INTEGER,
  progress INTEGER,
  created_at TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);
```

---

## 🎨 Displaying Results to Users

### **Scenario 1: User Dashboard - Personal View**

Create a user-facing endpoint to fetch their executions:

```typescript
// app/api/my-executions/route.ts (NEW FILE TO CREATE)
import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });

  // Get authenticated user
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch user's executions with agent details
  const { data: executions, error } = await supabase
    .from('agent_executions')
    .select(`
      id,
      status,
      execution_type,
      retry_count,
      progress,
      error_message,
      result,
      execution_duration_ms,
      scheduled_at,
      started_at,
      completed_at,
      created_at,
      agents!inner (
        id,
        agent_name,
        mode
      )
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ executions });
}
```

### **Scenario 2: Real-time Execution Viewer Component**

```typescript
// components/executions/ExecutionViewer.tsx (NEW FILE TO CREATE)
'use client';

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react';

interface Execution {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  retry_count: number;
  progress: number;
  error_message?: string;
  result?: any;
  execution_duration_ms?: number;
  agents: {
    agent_name: string;
  };
}

export function ExecutionViewer() {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch executions
  const fetchExecutions = async () => {
    const res = await fetch('/api/my-executions');
    const data = await res.json();
    setExecutions(data.executions || []);
    setLoading(false);
  };

  // Poll for updates every 3 seconds
  useEffect(() => {
    fetchExecutions();
    const interval = setInterval(fetchExecutions, 3000);
    return () => clearInterval(interval);
  }, []);

  const getStatusIcon = (execution: Execution) => {
    switch (execution.status) {
      case 'pending':
        return <Clock className="w-5 h-5 text-yellow-500" />;
      case 'running':
        return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />;
    }
  };

  const getStatusBadge = (execution: Execution) => {
    const baseClasses = "px-2.5 py-0.5 rounded-full text-xs font-medium";

    // Show retry count if retrying
    if (execution.retry_count > 0 && execution.status !== 'completed') {
      return (
        <span className={`${baseClasses} bg-orange-500/20 text-orange-300`}>
          Retrying ({execution.retry_count}/3)
        </span>
      );
    }

    switch (execution.status) {
      case 'pending':
        return <span className={`${baseClasses} bg-yellow-500/20 text-yellow-300`}>Queued</span>;
      case 'running':
        return <span className={`${baseClasses} bg-blue-500/20 text-blue-300`}>Running</span>;
      case 'completed':
        return <span className={`${baseClasses} bg-green-500/20 text-green-300`}>Completed</span>;
      case 'failed':
        const retryText = execution.retry_count > 0
          ? ` (Failed after ${execution.retry_count} retries)`
          : '';
        return <span className={`${baseClasses} bg-red-500/20 text-red-300`}>Failed{retryText}</span>;
    }
  };

  if (loading) {
    return <div className="flex justify-center p-8"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">My Agent Executions</h2>

      <div className="space-y-2">
        {executions.map((execution) => (
          <div
            key={execution.id}
            className="bg-slate-800 rounded-lg p-4 border border-slate-700"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {getStatusIcon(execution)}
                <div>
                  <p className="font-medium text-white">{execution.agents.agent_name}</p>
                  <p className="text-sm text-slate-400">
                    {new Date(execution.created_at).toLocaleString()}
                  </p>
                </div>
              </div>

              {getStatusBadge(execution)}
            </div>

            {/* Progress Bar */}
            {execution.status === 'running' && (
              <div className="mt-3">
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Progress</span>
                  <span>{execution.progress}%</span>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${execution.progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Error Message */}
            {execution.status === 'failed' && execution.error_message && (
              <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-red-300">Error</p>
                    <p className="text-sm text-red-200">{execution.error_message}</p>
                    {execution.retry_count === 3 && (
                      <p className="text-xs text-red-300 mt-1">
                        Execution failed after 3 automatic retry attempts
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Success Result */}
            {execution.status === 'completed' && execution.result && (
              <div className="mt-3 p-3 bg-green-500/10 border border-green-500/20 rounded">
                <p className="text-sm font-medium text-green-300">Result</p>
                <p className="text-sm text-green-200 mt-1">
                  {execution.result.send_status || 'Execution completed successfully'}
                </p>
                {execution.execution_duration_ms && (
                  <p className="text-xs text-slate-400 mt-1">
                    Completed in {(execution.execution_duration_ms / 1000).toFixed(2)}s
                  </p>
                )}
              </div>
            )}
          </div>
        ))}

        {executions.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <p>No executions yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## 🔔 Real-time Updates

### **Option 1: Polling (Current Implementation)**

Simple and works everywhere:

```typescript
// Poll every 3 seconds
useEffect(() => {
  const interval = setInterval(fetchExecutions, 3000);
  return () => clearInterval(interval);
}, []);
```

**Pros**: Easy to implement, works on Vercel
**Cons**: Higher database load, 3-second delay

### **Option 2: Supabase Realtime (Recommended)**

Get instant updates when execution status changes:

```typescript
// components/executions/ExecutionViewer.tsx
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

useEffect(() => {
  // Subscribe to changes
  const channel = supabase
    .channel('execution-changes')
    .on(
      'postgres_changes',
      {
        event: '*', // Listen to INSERT, UPDATE, DELETE
        schema: 'public',
        table: 'agent_executions',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        console.log('Execution updated:', payload);
        // Update local state
        setExecutions((prev) => {
          const index = prev.findIndex(e => e.id === payload.new.id);
          if (index >= 0) {
            // Update existing
            const updated = [...prev];
            updated[index] = payload.new;
            return updated;
          } else {
            // Add new
            return [payload.new, ...prev];
          }
        });
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [userId]);
```

**Enable Realtime in Supabase Dashboard:**
1. Go to Database → Replication
2. Enable replication for `agent_executions` table
3. Grant permissions: `GRANT SELECT ON agent_executions TO authenticated;`

---

## 🚨 Error States & User Communication

### **User-Friendly Error Messages**

Map technical errors to user-friendly messages:

```typescript
// lib/utils/errorMessages.ts (NEW FILE TO CREATE)
export function getUserFriendlyErrorMessage(
  errorMessage: string,
  retryCount: number
): { title: string; description: string; canRetry: boolean } {

  // Timeout errors
  if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
    return {
      title: 'Execution Timeout',
      description: retryCount < 3
        ? 'Your agent is taking longer than expected. We\'ll automatically retry.'
        : 'Your agent execution timed out after 3 attempts. Try breaking it into smaller steps.',
      canRetry: retryCount < 3,
    };
  }

  // Authentication errors
  if (errorMessage.includes('auth') || errorMessage.includes('401') || errorMessage.includes('403')) {
    return {
      title: 'Authentication Error',
      description: 'Please reconnect your plugin in Settings → Integrations.',
      canRetry: false,
    };
  }

  // API rate limits
  if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
    return {
      title: 'Rate Limit Reached',
      description: retryCount < 3
        ? 'Too many requests. We\'ll retry automatically with a delay.'
        : 'API rate limit reached. Please try again in a few minutes.',
      canRetry: retryCount < 3,
    };
  }

  // Plugin errors
  if (errorMessage.includes('plugin') || errorMessage.includes('not found')) {
    return {
      title: 'Plugin Error',
      description: 'There was an issue with one of your connected services. Please check your integrations.',
      canRetry: false,
    };
  }

  // Generic error
  return {
    title: 'Execution Failed',
    description: retryCount < 3
      ? `We encountered an error and will retry automatically (${retryCount + 1}/3).`
      : 'Execution failed after 3 attempts. Please check your agent configuration and try again.',
    canRetry: retryCount < 3,
  };
}
```

### **Usage in UI**

```typescript
// In your component
const errorInfo = getUserFriendlyErrorMessage(
  execution.error_message,
  execution.retry_count
);

<div className="bg-red-500/10 border border-red-500/20 rounded p-4">
  <h4 className="font-medium text-red-300">{errorInfo.title}</h4>
  <p className="text-sm text-red-200 mt-1">{errorInfo.description}</p>

  {errorInfo.canRetry && (
    <div className="mt-2 flex items-center gap-2 text-xs text-orange-300">
      <Loader2 className="w-3 h-3 animate-spin" />
      <span>Automatic retry in progress...</span>
    </div>
  )}
</div>
```

---

## 📈 Summary: What Users See

### **Timeline Example**

```
10:00:00 AM - User clicks "Run Agent"
  ✅ Status: Queued
  → UI shows: "Your agent is queued for execution"

10:00:02 AM - QStash picks up job
  ✅ Status: Running (0%)
  → UI shows: "Executing agent..." with progress bar

10:00:15 AM - Execution fails (API error)
  ⚠️ Status: Running (Retry 1/3)
  → UI shows: "We encountered an error and will retry automatically (1/3)"

10:00:45 AM - Retry #1 fails
  ⚠️ Status: Running (Retry 2/3)
  → UI shows: "We encountered an error and will retry automatically (2/3)"

10:02:15 AM - Retry #2 succeeds
  ✅ Status: Completed (100%)
  → UI shows: "Execution completed successfully in 2m 15s"
  → Shows result data

Alternative: All retries fail
  ❌ Status: Failed (3 retries)
  → UI shows: "Execution failed after 3 attempts. [View Error Details]"
  → Shows user-friendly error message with actionable steps
```

### **Key Indicators to Show Users**

1. **Status Badge**: Queued → Running → Completed/Failed
2. **Retry Count**: "Retrying (2/3)" if in progress
3. **Progress Bar**: For running executions
4. **Error Details**: User-friendly message + technical details (expandable)
5. **Duration**: How long the execution took
6. **Result Preview**: Success message or error summary
7. **Timestamp**: When it was triggered

---

## 🎯 Recommendations

### **For User Dashboard**
- ✅ Show real-time status with auto-refresh (3-5 seconds)
- ✅ Display retry attempts prominently
- ✅ Provide clear "what's happening" messages
- ✅ Show estimated time remaining (based on average)
- ✅ Allow manual retry for failed executions

### **For Admin Dashboard**
- ✅ Already implemented at `/app/admin/queues`
- ✅ Shows all executions across all users
- ✅ Real-time metrics (success rate, avg duration)
- ✅ Filter by status, agent, user

### **Notifications**
Consider adding:
- Email notification when execution completes (optional setting)
- Push notification for failed executions after all retries
- Slack/Discord webhook integration for monitoring

---

## 🔗 Related Files

- **QStash Queue**: `/lib/queues/qstashQueue.ts`
- **Worker Endpoint**: `/app/api/cron/process-queue/route.ts`
- **Admin Dashboard**: `/app/admin/queues/page.tsx`
- **Stats API**: `/app/api/agent-executions/stats/route.ts`
- **Scheduler**: `/app/api/run-scheduled-agents/route.ts`

---

**Generated**: 2025-10-21
**Author**: AgentPilot System
**Version**: QStash Migration v2.0
