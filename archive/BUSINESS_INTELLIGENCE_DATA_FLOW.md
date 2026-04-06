# Business Intelligence System - Complete Data Flow

## Overview
This document traces how we collect, store, and analyze execution data for business intelligence without storing any customer data.

---

## Phase 1: Data Collection (During Execution)

### 1.1 StepExecutor Calculates Item Count
**File**: `lib/pilot/StepExecutor.ts:4487-4546`

When a step completes, `StepExecutor` calculates the item count:

```typescript
// Line 421: Calculate item count from plugin result
const itemCount = this.calculateItemCount(result);

// calculateItemCount() handles all output formats:
// - Direct arrays: [item1, item2, ...] → 20
// - Nested arrays: {emails: [...], total_found: 20} → 20
// - Count fields: {count: 20, ...} → 20
// - Single objects: {id: 1, ...} → 1
```

**Example**:
```typescript
// Gmail plugin returns:
result = {
  emails: [/* 20 email objects */],
  total_found: 20,
  search_query: "is:unread"
}

// calculateItemCount() extracts: 20
```

### 1.2 StepExecutor Stores in StepOutput Metadata
**File**: `lib/pilot/StepExecutor.ts:419-431`

```typescript
const output: StepOutput = {
  stepId: step.id,
  plugin: 'google-mail',
  action: 'search_emails',
  data: result,  // Full data (in-memory only)
  metadata: {
    success: true,
    executedAt: new Date().toISOString(),
    executionTime: 1200,
    itemCount: 20,  // ← Stored in metadata
    tokensUsed: { total: 500 },
  },
};
```

### 1.3 StateManager Persists to Database
**File**: `lib/pilot/StateManager.ts:1096-1130`

StepExecutor calls `StateManager.updateStepExecution()`:

```typescript
await this.stateManager.updateStepExecution(
  executionId,
  stepId,
  'completed',
  {
    itemCount: 20,  // ← Passed to database
    execution_time: 1200,
    tokens_used: 500,
    ...
  }
);
```

StateManager stores in `workflow_step_executions` table:

```sql
UPDATE workflow_step_executions
SET
  status = 'completed',
  item_count = 20,              -- ← Persisted!
  execution_time_ms = 1200,
  tokens_used = 500,
  completed_at = NOW()
WHERE workflow_execution_id = '...' AND step_id = 'step1';
```

---

## Phase 2: Aggregation (After Execution)

### 2.1 MetricsCollector Queries Database
**File**: `lib/pilot/MetricsCollector.ts:77-144`

Called by `StateManager.finalizeExecution()`:

```typescript
const metricsCollector = new MetricsCollector(supabase);
await metricsCollector.collectMetrics(executionId, agentId, context);
```

MetricsCollector queries `workflow_step_executions`:

```typescript
// Query step executions from database
const { data: stepExecutions } = await this.supabase
  .from('workflow_step_executions')
  .select('step_id, step_name, plugin, action, item_count, status')
  .eq('workflow_execution_id', executionId)
  .order('created_at', { ascending: true });

// Result:
stepExecutions = [
  { step_name: "Find unread emails", plugin: "google-mail", action: "search_emails", item_count: 20 },
  { step_name: "Find PDFs", plugin: "google-drive", action: "find_files", item_count: 4 },
  { step_name: "Download PDFs", plugin: "google-drive", action: "get_file", item_count: 4 },
  { step_name: "Send summary", plugin: "google-mail", action: "send_email", item_count: 1 },
]
```

### 2.2 MetricsCollector Aggregates Metrics
**File**: `lib/pilot/MetricsCollector.ts:105-165`

```typescript
const metrics: ExecutionMetrics = {
  total_items: 0,
  step_metrics: [],
  has_empty_results: false,
  failed_step_count: 0,
  duration_ms: 5300,
};

// Aggregate from step executions
for (const stepExec of stepExecutions) {
  metrics.step_metrics.push({
    plugin: stepExec.plugin,
    action: stepExec.action,
    step_name: stepExec.step_name,
    count: stepExec.item_count,  // ← Read from database
  });

  metrics.total_items += stepExec.item_count;  // 20 + 4 + 4 + 1 = 29
}
```

### 2.3 MetricsCollector Stores Aggregated Metrics
**File**: `lib/pilot/MetricsCollector.ts:175-220`

Stores in `execution_metrics` table:

```sql
INSERT INTO execution_metrics (
  execution_id,
  agent_id,
  executed_at,
  duration_ms,
  total_items,
  step_metrics,
  has_empty_results,
  failed_step_count
) VALUES (
  '...',
  '...',
  NOW(),
  5300,
  29,  -- Total items across all steps
  '[
    {"count": 20, "plugin": "google-mail", "action": "search_emails", "step_name": "Find unread emails"},
    {"count": 4, "plugin": "google-drive", "action": "find_files", "step_name": "Find PDFs"},
    {"count": 4, "plugin": "google-drive", "action": "get_file", "step_name": "Download PDFs"},
    {"count": 1, "plugin": "google-mail", "action": "send_email", "step_name": "Send summary"}
  ]'::jsonb,
  false,
  0
);
```

---

## Phase 3: Trend Analysis (Over Time)

### 3.1 TrendAnalyzer Fetches Historical Metrics
**File**: `lib/pilot/insight/TrendAnalyzer.ts:84-99`

```typescript
const trendAnalyzer = new TrendAnalyzer(supabase);
const trends = await trendAnalyzer.analyzeTrends(agentId);
```

Queries `execution_metrics` for last 30 days:

```sql
SELECT
  executed_at,
  total_items,
  step_metrics,
  has_empty_results,
  failed_step_count,
  duration_ms
FROM execution_metrics
WHERE agent_id = '...'
  AND executed_at >= NOW() - INTERVAL '30 days'
ORDER BY executed_at DESC
LIMIT 30;
```

**Result** (last 10 executions):
```typescript
[
  { executed_at: "2026-02-04", total_items: 29, step_metrics: [{count: 20, ...}, {count: 4, ...}] },
  { executed_at: "2026-02-03", total_items: 25, step_metrics: [{count: 18, ...}, {count: 3, ...}] },
  { executed_at: "2026-02-02", total_items: 32, step_metrics: [{count: 24, ...}, {count: 5, ...}] },
  { executed_at: "2026-02-01", total_items: 22, step_metrics: [{count: 16, ...}, {count: 3, ...}] },
  { executed_at: "2026-01-31", total_items: 20, step_metrics: [{count: 15, ...}, {count: 2, ...}] },
  { executed_at: "2026-01-30", total_items: 18, step_metrics: [{count: 14, ...}, {count: 2, ...}] },
  { executed_at: "2026-01-29", total_items: 19, step_metrics: [{count: 14, ...}, {count: 3, ...}] },
  { executed_at: "2026-01-28", total_items: 21, step_metrics: [{count: 16, ...}, {count: 3, ...}] },
  { executed_at: "2026-01-27", total_items: 17, step_metrics: [{count: 13, ...}, {count: 2, ...}] },
  { executed_at: "2026-01-26", total_items: 16, step_metrics: [{count: 12, ...}, {count: 2, ...}] },
]
```

### 3.2 TrendAnalyzer Calculates Trends
**File**: `lib/pilot/insight/TrendAnalyzer.ts:101-168`

```typescript
// Calculate baseline (days 8-30)
const baseline = {
  avg_items_per_execution: 18.5,  // Average of older data
};

// Calculate recent (last 7 days)
const recent = {
  avg_items_per_execution: 25.0,  // Average of last 7
};

// Detect volume change
const volumeChange7d = (25.0 - 18.5) / 18.5 = 0.35;  // +35%

const trends: TrendMetrics = {
  volume_change_7d: 0.35,  // +35% increase
  is_volume_spike: true,   // 2+ std deviations above mean
  avg_duration_ms: 5200,
  empty_result_rate: 0.05,
  failure_rate: 0.02,
  data_points: 10,
  confidence: 'medium',
};
```

---

## Phase 4: Business Intelligence Generation (LLM)

### 4.1 BusinessInsightGenerator Uses Trends
**File**: `lib/pilot/insight/BusinessInsightGenerator.ts:73-168`

```typescript
const generator = new BusinessInsightGenerator(supabase);
const insights = await generator.generate(agent, trends, recentMetrics);
```

### 4.2 Build LLM Prompt with Business Context
**File**: `lib/pilot/insight/BusinessInsightGenerator.ts:180-283`

```typescript
const prompt = `
Workflow Context: "Track and respond to customer support emails"

Recent Metrics (last 10 executions):
- Execution 1: 29 items (20 emails → 4 files → 1 sent)
- Execution 2: 25 items (18 emails → 3 files → 1 sent)
- Execution 3: 32 items (24 emails → 5 files → 1 sent)
...

Historical Baseline:
- Average: 18.5 items/execution
- Typical: 14 emails → 2 files → 1 sent

Trends Detected:
- Volume change (7 days): +35%
- Category shift: Email volume up from 14 → 20 avg (+43%)
- Performance: Stable at 5200ms

Task: Generate 1-3 business insights explaining:
1. What's happening in the business?
2. Why should they care?
3. What should they do?
`;
```

### 4.3 LLM Generates Business Insights
**Response**:

```json
{
  "insights": [
    {
      "type": "volume_trend",
      "severity": "high",
      "title": "Customer Support Email Volume Up 43% This Week",
      "description": "Your workflow processed an average of 20 emails per day this week, up from 14 emails previously. The spike appears in unread support emails, with PDF attachments increasing proportionally (2 → 4 files per execution).",
      "business_impact": "Increased email volume may lead to slower response times and customer dissatisfaction if team capacity hasn't scaled. The 43% jump suggests either: (1) growing customer base, (2) product quality issues, or (3) seasonal spike.",
      "recommendation": "Review team capacity and consider: (1) hiring additional support staff, (2) investigating root cause of increased tickets, or (3) implementing automated triage to prioritize urgent issues. Monitor for continued growth.",
      "confidence": 0.85
    }
  ]
}
```

### 4.4 Store Insights in Database
**File**: `lib/pilot/insight/BusinessInsightGenerator.ts:391-454`

```sql
INSERT INTO execution_insights (
  user_id,
  agent_id,
  execution_ids,
  insight_type,
  category,
  severity,
  confidence,
  title,
  description,
  business_impact,
  recommendation,
  pattern_data,
  status
) VALUES (
  '...',
  '...',
  ARRAY['exec1', 'exec2', ...],
  'volume_trend',
  'business_intelligence',  -- ← Business insight
  'high',
  0.85,
  'Customer Support Email Volume Up 43% This Week',
  'Your workflow processed...',
  'Increased email volume may lead...',
  'Review team capacity...',
  '{"volume_change_7d": 0.35, ...}'::jsonb,  -- ← Store trends for caching
  'new'
);
```

---

## Phase 5: Display to User

### 5.1 Fetch Insights for Agent Page
**File**: `app/api/v6/insights/route.ts:35-41`

```typescript
const repository = new InsightRepository(supabase);
const insights = await repository.findByAgent(agentId, 'new');
```

### 5.2 Display in UI
**File**: `app/v2/agents/[id]/page.tsx`

```tsx
{insights.business.length > 0 && (
  <MiniInsightCard
    insight={{
      title: "Customer Support Email Volume Up 43% This Week",
      description: "Your workflow processed an average of 20 emails...",
      recommendation: "Review team capacity and consider hiring...",
      severity: "high",
      category: "business_intelligence"
    }}
  />
)}
```

**User sees**:
```
┌─────────────────────────────────────────────────────────────┐
│ Latest Execution                         ⚙️ Smart Pilot     │
├─────────────────────────────────────────────────────────────┤
│ ⚠️ Status: Needs Attention - 1 insight                      │
│                                                               │
│ What Happened:                                                │
│ ① 20  Find unread emails (google-mail)                      │
│ ② 4   Find PDFs (google-drive)                              │
│ ③ 4   Download PDFs (google-drive)                          │
│ ④ 1   Send summary (google-mail)                            │
│                                                               │
│ ┌───────────────────────────────────────────────────────┐  │
│ │ 📊 Business: Customer Support Email Volume Up 43%     │  │
│ │                                                         │  │
│ │ Your workflow processed 20 emails/day this week, up   │  │
│ │ from 14 previously (+43%). PDF attachments increased  │  │
│ │ proportionally.                                        │  │
│ │                                                         │  │
│ │ 💡 Recommendation: Review team capacity, investigate  │  │
│ │ root cause, or implement automated triage.            │  │
│ └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Tables Summary

### workflow_step_executions (Per-Step Detail)
**Purpose**: Store execution data for each individual step
**Updated by**: `StepExecutor` via `StateManager.updateStepExecution()`

```sql
| id   | workflow_execution_id | step_id | step_name           | plugin       | action        | item_count | execution_time_ms | tokens_used | status    |
|------|-----------------------|---------|---------------------|--------------|---------------|------------|-------------------|-------------|-----------|
| ...  | exec-123              | step1   | Find unread emails  | google-mail  | search_emails | 20         | 1200              | 500         | completed |
| ...  | exec-123              | step2   | Find PDFs           | google-drive | find_files    | 4          | 800               | 0           | completed |
| ...  | exec-123              | step3   | Download PDFs       | google-drive | get_file      | 4          | 2500              | 0           | completed |
| ...  | exec-123              | step4   | Send summary        | google-mail  | send_email    | 1          | 800               | 300         | completed |
```

### execution_metrics (Aggregated Per-Execution)
**Purpose**: Store aggregated metrics for business intelligence and trends
**Updated by**: `MetricsCollector.storeMetrics()`

```sql
| id  | execution_id | agent_id | executed_at | total_items | step_metrics                                      | duration_ms | has_empty_results | failed_step_count |
|-----|--------------|----------|-------------|-------------|---------------------------------------------------|-------------|-------------------|-------------------|
| ... | exec-123     | agent-1  | 2026-02-04  | 29          | [{"count":20,...},{"count":4,...},{"count":1,...}] | 5300        | false             | 0                 |
```

### execution_insights (Business Intelligence)
**Purpose**: Store generated business insights for display to users
**Updated by**: `BusinessInsightGenerator.storeInsights()`

```sql
| id  | agent_id | insight_type  | category              | severity | title                                    | description      | recommendation   | pattern_data        | status |
|-----|----------|---------------|-----------------------|----------|------------------------------------------|------------------|------------------|---------------------|--------|
| ... | agent-1  | volume_trend  | business_intelligence | high     | Customer Support Email Volume Up 43%... | Your workflow... | Review team...   | {"volume_change_7d":0.35} | new |
```

---

## Privacy Guarantee

✅ **What we store**:
- `item_count`: 20 (just the number)
- `step_name`: "Find unread emails"
- `plugin`: "google-mail"
- `action`: "search_emails"
- `duration_ms`: 1200
- `tokens_used`: 500

❌ **What we NEVER store**:
- Customer email addresses
- Email subjects or body content
- Attachment file names or contents
- Any PII or business-sensitive data

**The full data exists only in RAM during execution, then is discarded after metadata collection.**

---

## Summary

1. **StepExecutor** calculates `itemCount` → stores in `StepOutput.metadata`
2. **StateManager** persists to `workflow_step_executions.item_count`
3. **MetricsCollector** queries `workflow_step_executions` → aggregates → stores in `execution_metrics`
4. **TrendAnalyzer** queries `execution_metrics` → calculates trends
5. **BusinessInsightGenerator** uses trends + LLM → generates insights → stores in `execution_insights`
6. **UI** fetches `execution_insights` → displays to user

**Result**: Users see actionable business intelligence like "Email volume up 43% - consider hiring support" without us ever storing their customer data.
