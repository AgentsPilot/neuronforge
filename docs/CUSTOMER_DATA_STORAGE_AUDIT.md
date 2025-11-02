# Customer Data Storage Audit - AgentPilot Supabase Database

**Document Version**: 1.0
**Date**: November 1, 2025
**Focus**: Agent execution data and user-related storage
**Purpose**: Analyze what customer data we store, why, and impact of removal

---

## Executive Summary

This audit examines all customer data stored in our Supabase database, with primary focus on agent execution-related data. We identified **21 database tables** storing user data, categorized by purpose:

- **Essential (11 tables)**: Cannot remove without breaking core functionality
- **Removable with Impact (7 tables)**: Can remove but reduces features/UX
- **Optional/Configurable (3 tables)**: Can make opt-in or reduce retention

### Key Findings

**Storage Hot Spots** (Agent Execution Focus):
1. `agent_executions` - Execution queue and history (~500-1000 bytes/execution)
2. `token_usage` - Billing/analytics tracking (~200 bytes/execution)
3. `agent_logs` - Full execution outputs (~2-10 KB/execution)
4. `run_memories` - Memory system context (~1-5 KB/execution with memory)
5. `agent_execution_logs` - Granular debugging logs (~500 bytes/log entry)

**Estimated Storage Impact**:
- Heavy user (100 executions/day): ~1.5 MB/day = 45 MB/month
- Average user (10 executions/day): ~150 KB/day = 4.5 MB/month
- Enterprise user (1000 executions/day): ~15 MB/day = 450 MB/month

**Primary Recommendations**:
1. ✅ **Implement TTL policies** - Auto-delete data >90 days (60-80% storage reduction)
2. ✅ **Compress agent_logs** - Store summaries only (70-90% reduction)
3. ✅ **Archive old executions** - Move to cold storage after 30 days
4. ✅ **Limit memory retention** - Keep top N important memories only
5. ✅ **Make memory opt-in** - Free tier gets limited/no memory

---

## Database Tables Analysis

### 1. AGENT EXECUTION DATA (Core Focus)

#### Table: `agent_executions`
**Purpose**: Queue system for agent executions and execution history tracking

**Data Stored**:
```typescript
{
  id: string,
  agent_id: string,
  user_id: string,
  status: 'pending' | 'running' | 'completed' | 'failed',
  input: object,           // User's input parameters
  output: object,          // Agent's output results
  error_message: string,
  started_at: timestamp,
  completed_at: timestamp,
  execution_duration_ms: number,
  tokens_used: number,
  model_used: string,
  created_at: timestamp
}
```

**Written By**:
- `app/api/run-agent/route.ts:75-95` - Creates execution record on request
- `app/api/run-agent/route.ts:245-280` - Updates on completion
- `lib/agentkit/runAgentKit.ts:482-520` - Execution orchestration

**Dependencies**:
- Agent sandbox (`components/dashboard/AgentSandBox/AgentSandbox.tsx`)
- Execution history display
- Queue processing system
- Billing/analytics (indirect via `token_usage`)
- Audit trail (references `agent_executions.id`)

**Storage Impact**:
- Average size: ~800 bytes/execution
- High-volume user (100/day): 80 KB/day = 2.4 MB/month
- Enterprise (1000/day): 800 KB/day = 24 MB/month

**Removal Impact**: 🔴 **CRITICAL - CANNOT REMOVE**
- ❌ Breaks queue system (pending/running status tracking)
- ❌ Loses execution history (users cannot see past runs)
- ❌ Breaks billing (token usage tied to executions)
- ❌ Breaks audit compliance (GDPR requires execution logs)

**Minimization Options**:
- ✅ Add TTL: Auto-delete `completed` executions >90 days (keep `failed` longer for debugging)
- ✅ Compress `input`/`output`: Store compressed JSON (50-70% reduction)
- ✅ Archive to cold storage: Move old executions to cheaper storage tier
- ✅ Limit retention by tier: Free (30 days), Pro (90 days), Enterprise (1 year)

---

#### Table: `token_usage`
**Purpose**: Track token consumption for billing, quotas, and analytics

**Data Stored**:
```typescript
{
  id: string,
  user_id: string,
  agent_id: string,
  execution_id: string,
  input_tokens: number,
  output_tokens: number,
  total_tokens: number,
  model: string,
  cost_usd: number,
  timestamp: timestamp,
  billing_period: string,
  quota_type: 'free' | 'pro' | 'enterprise'
}
```

**Written By**:
- `app/api/run-agent/route.ts:258-275` - After each execution
- `lib/agentkit/runAgentKit.ts:510-520` - Token calculation
- `lib/utils/updateAgentIntensity.ts:95-110` - AIS token tracking

**Dependencies**:
- Billing system (`components/settings/UsageAnalytics.tsx`)
- Quota enforcement (`app/api/pricing/config/route.ts`)
- Analytics dashboard (`components/analytics/AnalyticsView.tsx`)
- AIS calculation (token complexity metrics)
- User invoices and payment processing

**Storage Impact**:
- Average size: ~200 bytes/record
- High-volume user (100/day): 20 KB/day = 600 KB/month
- Enterprise (1000/day): 200 KB/day = 6 MB/month

**Removal Impact**: 🔴 **CRITICAL - CANNOT REMOVE**
- ❌ Breaks billing (cannot charge customers accurately)
- ❌ Loses quota enforcement (users could exceed limits)
- ❌ No analytics/usage insights
- ❌ Cannot calculate AIS token complexity
- ❌ Legal/compliance issues (revenue tracking required)

**Minimization Options**:
- ✅ Aggregate old data: Roll up >90 days to daily summaries (90% reduction)
- ✅ Remove per-execution detail: Keep only billing period totals for free tier
- ⚠️ Keep granular data for Pro/Enterprise (needed for detailed invoicing)

---

#### Table: `agent_logs`
**Purpose**: Store full execution outputs, tool calls, and intermediate results

**Data Stored**:
```typescript
{
  id: string,
  agent_id: string,
  user_id: string,
  execution_id: string,
  log_type: 'info' | 'error' | 'debug' | 'tool_call',
  message: string,         // Can be very large (full LLM outputs)
  metadata: object,        // Tool call results, intermediate states
  timestamp: timestamp,
  created_at: timestamp
}
```

**Written By**:
- `lib/agentkit/runAgentKit.ts:150-180` - During execution (every step)
- `app/api/run-agent/route.ts:200-220` - Error logging
- Tool execution wrappers - Each tool call result

**Dependencies**:
- Debugging (developer troubleshooting)
- User-facing execution history (optional detailed view)
- Error reproduction and analysis
- Performance optimization (slow query identification)

**Storage Impact**: 🔴 **HIGHEST STORAGE CONSUMER**
- Average size: **~5 KB/execution** (multiple log entries per execution)
- High-volume user (100/day): 500 KB/day = 15 MB/month
- Enterprise (1000/day): 5 MB/day = 150 MB/month
- **Accounts for 40-60% of total user data storage**

**Removal Impact**: 🟡 **REMOVABLE WITH MODERATE IMPACT**
- ✅ Core functionality unaffected
- ⚠️ Loses detailed debugging capability
- ⚠️ Users cannot see intermediate steps (only final output)
- ⚠️ Harder to reproduce errors
- ✅ Can replace with lightweight summaries

**Minimization Options** (HIGH PRIORITY):
- ✅ **Store summaries only**: Keep final output + error logs, discard intermediate steps (70-90% reduction)
- ✅ **Compress logs**: Gzip compress `message` and `metadata` fields (50-70% reduction)
- ✅ **TTL policy**: Auto-delete debug logs >7 days, keep error logs 90 days
- ✅ **Sampling**: Store detailed logs for 10% of executions only (for analytics)
- ✅ **Tiered retention**: Free tier (no logs), Pro (7 days), Enterprise (30 days)

---

#### Table: `agent_execution_logs`
**Purpose**: Granular step-by-step execution tracking (separate from agent_logs)

**Data Stored**:
```typescript
{
  id: string,
  execution_id: string,
  step_number: number,
  step_type: 'workflow' | 'tool' | 'llm' | 'conditional',
  step_name: string,
  input: object,
  output: object,
  duration_ms: number,
  success: boolean,
  error: string,
  timestamp: timestamp
}
```

**Written By**:
- `lib/agentkit/runAgentKit.ts:250-280` - Each workflow step
- Workflow orchestration layer

**Dependencies**:
- Workflow debugging
- Performance profiling (which steps are slow)
- Conditional branch analysis
- AIS workflow complexity calculation

**Storage Impact**:
- Average size: ~500 bytes/step × 5 steps/execution = 2.5 KB/execution
- High-volume user (100/day): 250 KB/day = 7.5 MB/month
- Enterprise (1000/day): 2.5 MB/day = 75 MB/month

**Removal Impact**: 🟡 **REMOVABLE WITH IMPACT**
- ✅ Core execution still works
- ⚠️ Cannot debug workflow issues (which step failed?)
- ⚠️ Loses performance profiling data
- ⚠️ AIS workflow complexity less accurate (can estimate from agent design)

**Minimization Options**:
- ✅ TTL: Delete >30 days (keep recent for debugging)
- ✅ Store failed executions only (90% reduction)
- ✅ Aggregate: Store step count + total duration only, not per-step details
- ⚠️ Keep for Enterprise tier (debugging value)

---

#### Table: `agent_intensity_metrics`
**Purpose**: Agent Intensity System (AIS) - complexity scoring for routing and pricing

**Data Stored**:
```typescript
{
  id: string,
  agent_id: string,
  user_id: string,
  creation_score: number,
  execution_score: number,
  combined_score: number,
  // Component scores (9 fields)
  token_complexity_score: number,
  execution_complexity_score: number,
  plugin_complexity_score: number,
  workflow_complexity_score: number,
  memory_complexity_score: number,
  // Statistics (30+ fields)
  total_tokens_used: number,
  avg_tokens_per_run: number,
  total_executions: number,
  success_rate: number,
  // ... (see lib/types/intensity.ts for full schema)
  last_calculated_at: timestamp,
  created_at: timestamp,
  updated_at: timestamp
}
```

**Written By**:
- `lib/utils/updateAgentIntensity.ts:260-290` - After each execution
- `app/api/run-agent/route.ts:258-262` - Triggers AIS update

**Dependencies**:
- Intelligent model routing (critical for cost optimization)
- Dynamic pricing multipliers (1.0-2.0x based on complexity)
- Growth-based routing (prevents cost runaway)
- Analytics dashboard (agent complexity insights)
- Admin AIS configuration UI

**Storage Impact**:
- Average size: ~1.5 KB/agent (one row per agent, updated incrementally)
- 1000 agents = 1.5 MB total (minimal - not per-execution)

**Removal Impact**: 🔴 **CRITICAL - CANNOT REMOVE**
- ❌ Breaks intelligent routing (all agents use same model = cost explosion)
- ❌ Loses dynamic pricing (revenue loss or overcharging)
- ❌ No growth detection (runaway token costs)
- ❌ Cannot optimize agent performance
- ❌ Major competitive differentiator lost

**Minimization Options**:
- ✅ Already minimal (one row per agent, not per execution)
- ✅ Archive deleted agents after 90 days
- ⚠️ Cannot reduce further without losing AIS functionality

---

### 2. MEMORY SYSTEM DATA

#### Table: `run_memories`
**Purpose**: Store execution summaries for agent learning and context recall

**Data Stored**:
```typescript
{
  id: string,
  agent_id: string,
  user_id: string,
  execution_id: string,
  run_number: number,
  summary: string,              // LLM-generated summary (~200-500 words)
  input_summary: string,
  output_summary: string,
  key_decisions: string[],
  patterns_observed: string[],
  success: boolean,
  tokens_used: number,
  timestamp: timestamp,
  created_at: timestamp
}
```

**Written By**:
- `lib/memory/memoryService.ts:45-80` - After each execution (if memory enabled)
- `app/api/run-agent/route.ts:290-310` - Memory summarization

**Dependencies**:
- Memory injection system (`lib/memory/MemoryInjector.ts`)
- Agent learning across executions
- Context-aware responses
- Memory complexity scoring (AIS 5th component)

**Storage Impact**:
- Average size: ~2 KB/execution (with memory enabled)
- High-volume user (100/day): 200 KB/day = 6 MB/month
- Only applies to agents with memory enabled (~20-30% of agents)

**Removal Impact**: 🟡 **REMOVABLE - LOSES MEMORY FEATURE**
- ✅ Core execution still works (agents run without memory)
- ❌ Agents cannot learn from past runs (quality degradation)
- ❌ Loses context-aware capabilities
- ❌ Memory system becomes useless
- ⚠️ Users explicitly enable memory for value

**Minimization Options**:
- ✅ **Limit retention**: Keep top 20 most relevant memories per agent (90% reduction)
- ✅ **TTL by importance**: Delete low-importance memories after 30 days
- ✅ **Compress summaries**: Shorter summaries (100 words vs 300) (60% reduction)
- ✅ **Make opt-in for free tier**: Pro/Enterprise only
- ✅ **Sliding window**: Keep last 30 days + top 10 all-time

---

#### Table: `user_memory`
**Purpose**: Store cross-agent user preferences and behavioral patterns

**Data Stored**:
```typescript
{
  id: string,
  user_id: string,
  memory_type: 'preference' | 'pattern' | 'context',
  key: string,              // e.g., "preferred_tone", "typical_use_case"
  value: string,            // e.g., "professional", "customer_support"
  confidence_score: number, // How certain we are (0-1)
  source_executions: string[], // Which executions contributed
  last_observed: timestamp,
  created_at: timestamp,
  updated_at: timestamp
}
```

**Written By**:
- `lib/memory/userMemoryService.ts:60-90` - Pattern detection
- Runs periodically (background job analyzing execution history)

**Dependencies**:
- Personalized agent responses
- Default parameter suggestions
- User-specific optimizations
- Cross-agent learning

**Storage Impact**:
- Average size: ~500 bytes/memory × 20-50 memories/user = 10-25 KB/user
- 10,000 users = 100-250 MB total
- Grows slowly over time (not per-execution)

**Removal Impact**: 🟢 **REMOVABLE - MINOR IMPACT**
- ✅ Core functionality unaffected
- ⚠️ Loses personalization (minor UX degradation)
- ⚠️ Agents need to re-learn user preferences
- ✅ Can rebuild over time from new executions

**Minimization Options**:
- ✅ **Make opt-in**: Free tier disabled, Pro/Enterprise only
- ✅ **Limit count**: Max 50 memories per user
- ✅ **Confidence threshold**: Delete memories <0.3 confidence
- ✅ **TTL**: Delete if not observed in 180 days

---

### 3. AUDIT AND COMPLIANCE

#### Table: `audit_trail`
**Purpose**: Compliance logging for GDPR, SOC2, security audits

**Data Stored**:
```typescript
{
  id: string,
  user_id: string,
  event_type: string,        // e.g., 'agent_created', 'execution_started'
  event_category: string,    // e.g., 'agent_lifecycle', 'data_access'
  resource_type: string,
  resource_id: string,
  action: string,
  metadata: object,
  ip_address: string,
  user_agent: string,
  timestamp: timestamp,
  created_at: timestamp
}
```

**Written By**:
- `lib/audit/events.ts:25-50` - All user actions
- Every API route that modifies data
- Authentication/authorization events

**Dependencies**:
- GDPR compliance (required by law)
- SOC2 certification (required for enterprise customers)
- Security incident investigation
- Compliance reporting

**Storage Impact**:
- Average size: ~400 bytes/event
- Heavy user (500 events/day): 200 KB/day = 6 MB/month
- Retention requirement: **7 years** (legal compliance)

**Removal Impact**: 🔴 **CANNOT REMOVE - LEGAL REQUIREMENT**
- ❌ GDPR violation (€20M fine or 4% revenue)
- ❌ Loses SOC2 certification (enterprise customers churn)
- ❌ Cannot investigate security incidents
- ❌ No compliance reporting

**Minimization Options**:
- ✅ Archive to cold storage after 90 days (cost reduction only)
- ✅ Compress old records (50% reduction)
- ⚠️ Cannot delete (legal requirement)

---

### 4. USER MANAGEMENT AND BILLING

#### Table: `users`
**Purpose**: User accounts and authentication

**Data Stored**:
```typescript
{
  id: string,
  email: string,
  hashed_password: string,
  name: string,
  avatar_url: string,
  subscription_tier: 'free' | 'pro' | 'enterprise',
  created_at: timestamp,
  last_login: timestamp
}
```

**Removal Impact**: 🔴 **CANNOT REMOVE** - Core authentication

---

#### Table: `subscriptions`
**Purpose**: Billing and subscription management

**Data Stored**:
```typescript
{
  id: string,
  user_id: string,
  tier: 'free' | 'pro' | 'enterprise',
  status: 'active' | 'canceled' | 'past_due',
  stripe_subscription_id: string,
  current_period_start: timestamp,
  current_period_end: timestamp,
  cancel_at: timestamp
}
```

**Removal Impact**: 🔴 **CANNOT REMOVE** - Revenue tracking required

---

#### Table: `invoices`
**Purpose**: Invoice generation and payment history

**Data Stored**:
```typescript
{
  id: string,
  user_id: string,
  subscription_id: string,
  amount_usd: number,
  status: 'paid' | 'pending' | 'failed',
  stripe_invoice_id: string,
  billing_period_start: timestamp,
  billing_period_end: timestamp,
  created_at: timestamp
}
```

**Removal Impact**: 🔴 **CANNOT REMOVE** - Legal/tax requirement (7 years retention)

---

### 5. AGENT CONFIGURATION

#### Table: `agents`
**Purpose**: Agent definitions (workflows, plugins, I/O schemas)

**Data Stored**:
```typescript
{
  id: string,
  user_id: string,
  name: string,
  description: string,
  workflow: object,         // Workflow definition JSON
  plugins: string[],        // Connected plugins
  input_schema: object,
  output_schema: object,
  trigger_type: string,
  is_public: boolean,
  created_at: timestamp,
  updated_at: timestamp
}
```

**Removal Impact**: 🔴 **CANNOT REMOVE** - Core product data

---

#### Table: `plugins`
**Purpose**: Plugin definitions and configurations

**Removal Impact**: 🔴 **CANNOT REMOVE** - Core functionality

---

### 6. ANALYTICS AND MONITORING

#### Table: `usage_analytics`
**Purpose**: Aggregated usage metrics (not per-execution detail)

**Data Stored**:
```typescript
{
  id: string,
  user_id: string,
  date: date,
  total_executions: number,
  total_tokens: number,
  avg_duration_ms: number,
  success_rate: number,
  top_agents: object
}
```

**Storage Impact**: ~1 KB/day/user = 30 KB/month/user

**Removal Impact**: 🟡 **REMOVABLE - LOSES ANALYTICS**
- ✅ Core functionality unaffected
- ⚠️ Users cannot see usage trends
- ⚠️ No capacity planning data
- ✅ Can regenerate from `token_usage` if needed

**Minimization Options**:
- ✅ Already aggregated (daily rollups, not per-execution)
- ✅ Keep 90 days, archive older data

---

#### Table: `error_logs`
**Purpose**: Application error tracking (not user data, but user-triggered)

**Storage Impact**: Minimal (only errors, not all executions)

**Removal Impact**: 🟢 **REMOVABLE - MINOR IMPACT**
- ✅ Core functionality unaffected
- ⚠️ Harder to debug production issues
- ✅ Can use external service (Sentry, etc.)

---

### 7. SYSTEM CONFIGURATION

#### Table: `ais_normalization_ranges`
**Purpose**: AIS system configuration (not user data)

**Removal Impact**: 🔴 **CANNOT REMOVE** - AIS system breaks

---

#### Table: `ais_scoring_weights`
**Purpose**: AIS component weights (not user data)

**Removal Impact**: 🔴 **CANNOT REMOVE** - AIS system breaks

---

## Data Minimization Strategies

### Immediate Actions (Week 1)

#### 1. Implement TTL Policies
**Target Tables**: `agent_logs`, `agent_execution_logs`, `agent_executions` (completed only)

**Implementation**:
```sql
-- Auto-delete old agent_logs (7 days for debug, 90 days for errors)
DELETE FROM agent_logs
WHERE log_type = 'debug' AND created_at < NOW() - INTERVAL '7 days';

DELETE FROM agent_logs
WHERE log_type IN ('info', 'error') AND created_at < NOW() - INTERVAL '90 days';

-- Auto-delete old execution logs (30 days)
DELETE FROM agent_execution_logs
WHERE created_at < NOW() - INTERVAL '30 days';

-- Archive old completed executions (90 days)
DELETE FROM agent_executions
WHERE status = 'completed' AND completed_at < NOW() - INTERVAL '90 days';
```

**Expected Impact**: 60-70% storage reduction for high-volume users

---

#### 2. Compress agent_logs
**Target**: `agent_logs.message` and `agent_logs.metadata` fields

**Implementation**:
```typescript
// app/api/run-agent/route.ts
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// Before insert
const compressedMessage = await gzipAsync(Buffer.from(logMessage));
await supabase.from('agent_logs').insert({
  message: compressedMessage.toString('base64'),
  is_compressed: true
});

// On read
if (log.is_compressed) {
  const buffer = Buffer.from(log.message, 'base64');
  const decompressed = await gunzipAsync(buffer);
  log.message = decompressed.toString();
}
```

**Expected Impact**: 50-70% reduction in `agent_logs` size

---

#### 3. Store Summaries Only
**Target**: `agent_logs` - keep final output + errors, discard intermediate steps

**Implementation**:
```typescript
// lib/agentkit/runAgentKit.ts
const shouldStoreLog = (logType: string, stepNumber: number, totalSteps: number) => {
  // Always store errors
  if (logType === 'error') return true;

  // Store first and last steps only
  if (stepNumber === 1 || stepNumber === totalSteps) return true;

  // Discard intermediate steps
  return false;
};
```

**Expected Impact**: 80-90% reduction in log volume

---

### Medium-Term Actions (Month 1-3)

#### 4. Tiered Retention Policies
**Target**: All execution data

**Policy**:
```typescript
const RETENTION_POLICIES = {
  free: {
    agent_executions: 7,      // 7 days
    agent_logs: 0,            // No detailed logs
    run_memories: 10,         // Top 10 memories only
    token_usage: 30           // 30 days detail, then aggregated
  },
  pro: {
    agent_executions: 90,     // 90 days
    agent_logs: 30,           // 30 days
    run_memories: 100,        // Top 100 memories
    token_usage: 365          // 1 year
  },
  enterprise: {
    agent_executions: 365,    // 1 year
    agent_logs: 90,           // 90 days
    run_memories: 'unlimited',
    token_usage: 'unlimited'
  }
};
```

**Expected Impact**: 70-80% reduction for free tier users

---

#### 5. Aggregate Old Token Usage
**Target**: `token_usage` - roll up to daily summaries after 90 days

**Implementation**:
```sql
-- Create aggregated table
CREATE TABLE token_usage_daily (
  user_id UUID,
  agent_id UUID,
  date DATE,
  total_tokens BIGINT,
  total_cost_usd DECIMAL,
  execution_count INTEGER,
  PRIMARY KEY (user_id, agent_id, date)
);

-- Aggregate and delete
INSERT INTO token_usage_daily
SELECT user_id, agent_id, DATE(timestamp), SUM(total_tokens), SUM(cost_usd), COUNT(*)
FROM token_usage
WHERE timestamp < NOW() - INTERVAL '90 days'
GROUP BY user_id, agent_id, DATE(timestamp);

DELETE FROM token_usage WHERE timestamp < NOW() - INTERVAL '90 days';
```

**Expected Impact**: 90% reduction in old token_usage data

---

#### 6. Memory Retention Limits
**Target**: `run_memories` - keep top N most relevant memories

**Implementation**:
```typescript
// lib/memory/memoryService.ts
async function pruneMemories(agentId: string, userId: string) {
  const MAX_MEMORIES = 100; // Configurable by tier

  // Get all memories sorted by relevance score
  const { data: memories } = await supabase
    .from('run_memories')
    .select('*')
    .eq('agent_id', agentId)
    .order('relevance_score', { ascending: false })
    .limit(MAX_MEMORIES + 1000); // Get more than needed

  if (memories.length > MAX_MEMORIES) {
    const toDelete = memories.slice(MAX_MEMORIES).map(m => m.id);
    await supabase.from('run_memories').delete().in('id', toDelete);
  }
}
```

**Expected Impact**: 80-90% reduction in memory storage

---

### Strategic Actions (Month 3-6)

#### 7. Cold Storage Archival
**Target**: All old data (>90 days)

**Implementation**:
- Move to AWS S3 Glacier / Azure Cool Storage
- Cost: $0.004/GB/month (vs $0.125/GB in Supabase)
- Keep metadata in Supabase for search, full data in S3
- Lazy load on demand (user requests old execution)

**Expected Impact**: 90% cost reduction for archived data

---

#### 8. Make Memory Opt-In
**Target**: Free tier users

**Implementation**:
```typescript
// lib/memory/MemoryInjector.ts
async loadContext(agentId: string, userId: string) {
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('tier')
    .eq('user_id', userId)
    .single();

  if (subscription.tier === 'free') {
    return { memories: [], message: 'Upgrade to Pro for agent memory' };
  }

  // Load memories for Pro/Enterprise
  return await this.loadMemories(agentId, userId);
}
```

**Expected Impact**: 60-70% reduction in memory storage (if 70% users are free tier)

---

#### 9. Execution Log Sampling
**Target**: `agent_logs`, `agent_execution_logs` - store detailed logs for 10% of executions

**Implementation**:
```typescript
// app/api/run-agent/route.ts
const shouldStoreDetailedLogs = () => {
  // Store detailed logs for 10% of executions (for analytics)
  return Math.random() < 0.10;
};

if (shouldStoreDetailedLogs() || executionFailed) {
  // Store detailed logs (all steps, tool calls, etc.)
  await storeDetailedLogs(executionId, logs);
} else {
  // Store summary only (final output + basic metrics)
  await storeSummaryLog(executionId, finalOutput);
}
```

**Expected Impact**: 90% reduction in log storage

---

## Storage Impact Calculations

### Current State (Estimated)
**Assumptions**:
- 10,000 active users
- Average 10 executions/user/day
- 30% of agents have memory enabled

**Daily Storage Growth**:
```
agent_executions:     10,000 × 10 × 800 bytes   = 80 MB/day
token_usage:          10,000 × 10 × 200 bytes   = 20 MB/day
agent_logs:           10,000 × 10 × 5 KB        = 500 MB/day
agent_execution_logs: 10,000 × 10 × 2.5 KB     = 250 MB/day
run_memories:         10,000 × 10 × 0.3 × 2 KB  = 60 MB/day
───────────────────────────────────────────────────────────
TOTAL:                                          = 910 MB/day
```

**Monthly**: ~27 GB/month
**Yearly**: ~324 GB/year

**Storage Cost** (Supabase pricing):
- $0.125/GB/month
- Monthly cost: 27 GB × $0.125 = **$3.38/month** (current)
- Yearly cost: 324 GB × $0.125 = **$40.50/year** (current)

---

### After Minimization (Estimated)
**Applying all strategies**:

```
TTL policies (90 days retention):
- Reduce steady-state by 66% (only keep 90/365 days)

Compression (agent_logs):
- Reduce agent_logs by 60%: 500 MB → 200 MB/day

Summaries only:
- Further reduce agent_logs by 80%: 200 MB → 40 MB/day

Memory limits:
- Reduce run_memories by 80%: 60 MB → 12 MB/day

Tiered retention (70% free tier, 7 days):
- Reduce free tier storage by 90%: 0.7 × 910 × 0.9 = 573 MB saved

Daily storage after optimization:
agent_executions:     80 MB × 0.33 = 26 MB/day
token_usage:          20 MB × 0.33 = 7 MB/day (aggregated)
agent_logs:           40 MB × 0.33 = 13 MB/day (compressed summaries)
agent_execution_logs: 250 MB × 0.1 = 25 MB/day (sampling)
run_memories:         12 MB × 0.33 = 4 MB/day (limited retention)
───────────────────────────────────────────────────────────
TOTAL:                              = 75 MB/day
```

**Monthly**: ~2.3 GB/month (vs 27 GB = **91.5% reduction**)
**Yearly**: ~27 GB/year (vs 324 GB = **91.7% reduction**)

**Storage Cost After Optimization**:
- Monthly: 2.3 GB × $0.125 = **$0.29/month** (vs $3.38 = 91% savings)
- Yearly: 27 GB × $0.125 = **$3.38/year** (vs $40.50 = 92% savings)

**Additional Savings with Cold Storage** (>90 days):
- Archive 90% of data to S3 Glacier: $0.004/GB/month
- Cost: 24 GB × $0.004 = $0.10/month (vs $3.00 in Supabase)
- **Total yearly cost: $1.50** (96% reduction from current)

---

## Recommendations Summary

### Priority 1: IMMEDIATE (Week 1) - No Feature Impact
1. ✅ **Implement TTL policies** for `agent_logs` (7 days debug, 90 days errors)
2. ✅ **Delete old execution logs** >30 days from `agent_execution_logs`
3. ✅ **Archive completed executions** >90 days from `agent_executions`
4. ✅ **Add database indexes** for efficient TTL queries

**Impact**: 60-70% storage reduction, **no feature loss**

---

### Priority 2: MEDIUM-TERM (Month 1) - Minor Impact
5. ✅ **Compress agent_logs** using gzip (50-70% reduction)
6. ✅ **Store summaries only** in agent_logs (discard intermediate steps)
7. ✅ **Aggregate old token_usage** to daily summaries (>90 days)

**Impact**: Additional 20-30% reduction, **minor debugging capability loss**

---

### Priority 3: STRATEGIC (Month 3) - Feature Changes
8. ✅ **Tiered retention policies** (free: 7 days, pro: 90 days, enterprise: 1 year)
9. ✅ **Memory limits** (top 100 memories per agent)
10. ✅ **Make memory opt-in** for free tier (Pro/Enterprise feature)
11. ✅ **Cold storage archival** for data >90 days (S3 Glacier)

**Impact**: 90%+ total reduction, **free tier feature limitations, Pro/Enterprise value increase**

---

### Priority 4: ADVANCED (Month 6) - Optimization
12. ✅ **Execution log sampling** (detailed logs for 10% of executions)
13. ✅ **User data export** (allow users to download and delete their data)
14. ✅ **GDPR compliance tools** (automated data deletion requests)

**Impact**: Compliance + additional storage savings

---

## Impact Analysis by User Segment

### Free Tier Users (70% of users)
**Current**: ~910 MB/day × 0.7 = 637 MB/day from free users

**After Optimization**:
- 7-day retention: 91% reduction
- No detailed logs: 60% reduction in logs
- No/limited memory: 80% reduction in memory
- **Total free tier storage**: ~60 MB/day (90% reduction)

**Feature Impact**:
- ⚠️ Limited execution history (7 days vs 90 days)
- ⚠️ No detailed debugging logs
- ⚠️ Limited/no memory feature
- ✅ Core execution functionality unchanged

**User Experience**:
- Still can run agents unlimited times (within quota)
- Can see recent runs (7 days)
- Can export data before deletion
- **Clear upgrade incentive to Pro tier**

---

### Pro Tier Users (25% of users)
**Current**: ~910 MB/day × 0.25 = 227 MB/day from pro users

**After Optimization**:
- 90-day retention: 75% reduction
- Compressed logs: 60% reduction
- Limited memory: 50% reduction
- **Total pro tier storage**: ~50 MB/day (78% reduction)

**Feature Impact**:
- ✅ Full execution history (90 days)
- ✅ Debugging logs (30 days detailed, 90 days summary)
- ✅ Memory feature (top 100 memories)
- ✅ No functionality loss

---

### Enterprise Tier Users (5% of users)
**Current**: ~910 MB/day × 0.05 = 45 MB/day from enterprise users

**After Optimization**:
- 1-year retention: 0% reduction (keep full history)
- Full logs: Minimal reduction (compression only)
- Unlimited memory: 0% reduction
- **Total enterprise tier storage**: ~40 MB/day (11% reduction)

**Feature Impact**:
- ✅ Full execution history (1 year)
- ✅ Full debugging logs (90 days)
- ✅ Unlimited memory
- ✅ Premium support for data requests
- **No feature loss - premium experience**

---

## Data Privacy and Compliance

### GDPR Compliance
**Current Status**: ✅ Compliant (audit trail, data export, deletion)

**After Optimization**: ✅ Still compliant
- Audit trail: 7-year retention (required)
- Data export: Add automated export feature
- Right to deletion: TTL policies help (auto-delete old data)
- Data minimization: Optimization directly supports GDPR principle

**Action Items**:
1. ✅ Update privacy policy (reflect retention policies)
2. ✅ Add user data export tool (download all my data)
3. ✅ Add automated deletion request handling
4. ✅ Document data retention in ToS

---

### SOC2 Compliance
**Impact**: ✅ No negative impact
- Audit trail: Unchanged (7-year retention)
- Access logs: Unchanged
- Data encryption: Unchanged
- **TTL policies improve compliance** (data minimization principle)

---

## Migration Plan

### Phase 1: TTL Implementation (Week 1-2)
```sql
-- Create TTL cleanup function
CREATE OR REPLACE FUNCTION cleanup_old_data()
RETURNS void AS $$
BEGIN
  -- Delete old debug logs
  DELETE FROM agent_logs
  WHERE log_type = 'debug' AND created_at < NOW() - INTERVAL '7 days';

  -- Delete old info/error logs
  DELETE FROM agent_logs
  WHERE log_type IN ('info', 'error') AND created_at < NOW() - INTERVAL '90 days';

  -- Delete old execution logs
  DELETE FROM agent_execution_logs
  WHERE created_at < NOW() - INTERVAL '30 days';

  -- Archive old executions
  DELETE FROM agent_executions
  WHERE status = 'completed' AND completed_at < NOW() - INTERVAL '90 days';

  RAISE NOTICE 'TTL cleanup completed';
END;
$$ LANGUAGE plpgsql;

-- Schedule daily cleanup (using pg_cron extension)
SELECT cron.schedule('cleanup-old-data', '0 2 * * *', 'SELECT cleanup_old_data()');
```

**Testing**:
1. Run on staging environment first
2. Verify no active executions deleted
3. Monitor storage metrics for 7 days
4. Deploy to production

---

### Phase 2: Compression (Week 3-4)
**Implementation**:
1. Add `is_compressed` boolean column to `agent_logs`
2. Update write logic to compress new logs
3. Update read logic to decompress
4. Backfill: Compress existing logs (batch process)

**Code Changes**:
- `app/api/run-agent/route.ts` - Add compression on write
- `components/dashboard/AgentSandBox/AgentSandbox.tsx` - Add decompression on read
- Migration: Add `is_compressed` column

---

### Phase 3: Tiered Retention (Week 5-8)
**Implementation**:
1. Add retention policies to subscription config
2. Update TTL function to respect tier
3. Add UI warnings ("Execution history limited to 7 days on free tier")
4. Add upgrade prompts

**Code Changes**:
- `lib/utils/tierRetentionPolicies.ts` - New file with policy config
- `supabase/functions/cleanup_old_data.sql` - Update to check tier
- `components/settings/UsageAnalytics.tsx` - Add tier-based warnings

---

### Phase 4: Cold Storage (Week 9-12)
**Implementation**:
1. Set up S3 bucket with Glacier storage class
2. Create archive service
3. Update data access layer (check S3 if not in Supabase)
4. Migrate old data in batches

**Architecture**:
```typescript
// lib/storage/archivalService.ts
async function getExecution(executionId: string) {
  // Try Supabase first (hot data)
  const { data } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('id', executionId)
    .single();

  if (data) return data;

  // Fallback to S3 (cold data)
  const archived = await s3.getObject({
    Bucket: 'agentpilot-archive',
    Key: `executions/${executionId}.json`
  });

  return JSON.parse(archived.Body.toString());
}
```

---

## Monitoring and Alerts

### Storage Metrics to Track
1. **Total database size** (daily)
2. **Growth rate** (MB/day)
3. **Per-table size** (weekly)
4. **TTL cleanup stats** (daily)
5. **Archive success rate** (daily)

**Dashboard** (add to admin UI):
```typescript
// components/admin/StorageMetrics.tsx
<div className="grid grid-cols-4 gap-4">
  <MetricCard
    title="Total Storage"
    value="2.3 GB"
    change="-91.5%"
    trend="down"
  />
  <MetricCard
    title="Daily Growth"
    value="75 MB/day"
    change="-92%"
    trend="down"
  />
  <MetricCard
    title="Archived Data"
    value="24 GB"
    change="+15 GB"
    trend="up"
  />
  <MetricCard
    title="TTL Deletions"
    value="1,250 records"
    change="Today"
    trend="neutral"
  />
</div>
```

---

### Alerts
1. **Storage growth spike** (>2x normal daily growth)
2. **TTL cleanup failure** (function didn't run)
3. **Archive failure** (S3 upload errors)
4. **Low disk space** (<10% free)

---

## Conclusion

**Current State**: 910 MB/day storage growth, $40.50/year cost

**After Full Optimization**: 75 MB/day growth, $1.50/year cost

**Storage Reduction**: 91.7%
**Cost Reduction**: 96%

**Feature Impact**:
- Free tier: Limited retention (acceptable for free users)
- Pro tier: Full functionality (strong value proposition)
- Enterprise: Premium experience (justifies pricing)

**Compliance**: ✅ GDPR and SOC2 compliant

**Next Steps**:
1. Approve Phase 1 (TTL policies) - **No feature impact, immediate 60-70% savings**
2. Review tiered retention strategy - **Align with pricing strategy**
3. Implement monitoring dashboard - **Track optimization impact**
4. Plan user communication - **Transparency about retention policies**

---

**Document Status**: ✅ Complete
**Last Updated**: November 1, 2025
**Reviewed By**: [Pending]
**Approved By**: [Pending]
