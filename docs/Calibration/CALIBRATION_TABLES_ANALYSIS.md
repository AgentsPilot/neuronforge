# Calibration Tables Analysis - Duplication Check

> **Created**: 2026-04-28
> **Purpose**: Analyze if we need all 3 calibration-related tables/views

---

## Current State

We have **2 tables** and **1 view** related to calibration:

1. **`calibration_sessions`** - Existing table (tracks active calibration sessions)
2. **`calibration_history`** - New table (tracks all calibration runs for analytics)
3. **`calibration_success_metrics`** - View (analytics aggregation from calibration_history)

---

## Table 1: `calibration_sessions`

### Purpose
Tracks **active/in-progress calibration sessions** for the UI workflow.

### Schema
```typescript
interface CalibrationSession {
  id: string;
  agent_id: string;
  user_id: string;
  execution_id?: string;

  // Status tracking for multi-step calibration flow
  status: 'running' | 'collecting_issues' | 'awaiting_fixes' | 'fixes_applied' | 'completed' | 'failed';

  // Collected issues for user review
  issues: CollectedIssue[];
  issue_summary: {
    critical: number;
    warnings: number;
    auto_repairs: number;
  };

  // User interaction tracking
  auto_repairs_proposed: any[];
  user_fixes: Record<string, any>;
  applied_fixes?: {
    parameters: number;
    parameterizations: number;
    auto_repairs: number;
    logic_fixes: number;
  };

  // Workflow backup for rollback
  backup_pilot_steps?: any;

  // Step counts
  total_steps: number;
  completed_steps: number;
  failed_steps: number;
  skipped_steps: number;

  // Execution summary
  execution_summary?: {
    data_sources_accessed?: Array<{
      plugin: string;
      action: string;
      count: number;
      description: string;
    }>;
    items_processed?: number;
    items_delivered?: number;
  };

  // Timestamps
  created_at: string;
  updated_at: string;
  completed_at?: string;
}
```

### Usage
- **Created**: When user starts calibration (batch API)
- **Updated**: As calibration progresses through phases (running → collecting → awaiting fixes → fixes applied → completed)
- **Read**: By CalibrationDashboard.tsx and CalibrationSetup.tsx to show live progress
- **Deleted**: After calibration completes (or kept for recent history - needs verification)

### Key Characteristics
- **Transient data** - Represents current/active calibration session
- **UI-focused** - Stores data needed for interactive calibration workflow
- **User interaction** - Tracks user fixes, approvals, and choices
- **Backup/rollback** - Stores original workflow for rollback if needed

---

## Table 2: `calibration_history`

### Purpose
Permanent record of **all calibration runs** for analytics and quality tracking.

### Schema
```typescript
interface CalibrationHistoryRecord {
  id: string;

  // References
  agent_id: string;
  session_id?: string | null;  // ← Links to calibration_sessions
  user_id: string;

  // Workflow snapshot
  workflow_hash: string;
  workflow_step_count: number;

  // Results
  status: 'success' | 'failed' | 'needs_review' | 'verification_only';
  iterations: number;
  auto_fixes_applied: number;

  // Issues (final state)
  issues_found: any[];
  issues_fixed: any[];
  issues_remaining: any[];

  // Metrics
  execution_time_ms?: number;
  steps_completed: number;
  steps_failed: number;
  steps_skipped: number;

  // V6 quality tracking
  v6_version?: string;
  model_used?: string;

  // Additional context (validation_metadata moved here)
  metadata: {
    validatedAt: string;
    layer1Fixes: number;
    layer2HighConfidenceFixes: number;
    layer2MediumConfidenceFixes: number;
    actionReplacementFixes: number;
    multiStepStructuralFixes: number;
    // ... more validation data
  };

  // Timestamps
  created_at: string;
  completed_at?: string;
}
```

### Usage
- **Created**: When calibration completes (success or failure)
- **Updated**: Never (append-only)
- **Read**: For analytics queries, historical trend analysis, V6 quality metrics
- **Deleted**: Never (or archived after 90+ days)

### Key Characteristics
- **Permanent record** - Never deleted, append-only
- **Analytics-focused** - Optimized for aggregation and pattern detection
- **Comprehensive metrics** - All data needed for V6 quality analysis
- **Workflow snapshot** - Hash-based change detection

---

## View: `calibration_success_metrics`

### Purpose
Pre-aggregated analytics view for common queries.

### Definition
```sql
CREATE OR REPLACE VIEW calibration_success_metrics AS
SELECT
  DATE_TRUNC('day', created_at) as date,
  status,
  COUNT(*) as count,
  AVG(iterations) as avg_iterations,
  AVG(auto_fixes_applied) as avg_fixes,
  AVG(execution_time_ms) as avg_execution_time_ms,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY iterations) as median_iterations
FROM calibration_history
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', created_at), status
ORDER BY date DESC, status;
```

### Usage
- **Read**: Dashboard analytics, success rate tracking
- **Source**: Derived from `calibration_history` table

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ User starts calibration                                         │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ calibration_sessions (created)                                  │
│ - id: "abc123"                                                  │
│ - status: "running"                                             │
│ - issues: []                                                    │
│ - user_fixes: {}                                                │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Calibration executes workflow                                   │
│ - Collects issues                                               │
│ - Applies auto-fixes                                            │
│ - Updates session status: "collecting_issues"                   │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ calibration_sessions (updated)                                  │
│ - status: "awaiting_fixes"                                      │
│ - issues: [issue1, issue2, ...]                                 │
│ - auto_repairs_proposed: [...]                                  │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ User reviews issues (UI reads from calibration_sessions)        │
│ - User approves fixes                                           │
│ - User provides missing parameters                              │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ calibration_sessions (updated)                                  │
│ - status: "fixes_applied"                                       │
│ - user_fixes: { parameters: {...}, autoRepairs: {...} }         │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Calibration completes                                           │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ calibration_sessions (final update)                             │
│ - status: "completed"                                           │
│ - completed_at: timestamp                                       │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ calibration_history (created) ← FINAL RECORD                    │
│ - session_id: "abc123" (links to session)                       │
│ - status: "success"                                             │
│ - iterations: 3                                                 │
│ - auto_fixes_applied: 5                                         │
│ - issues_found: [...]                                           │
│ - issues_fixed: [...]                                           │
│ - issues_remaining: [...]                                       │
│ - metadata: { validation data... }                              │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ calibration_success_metrics (view) ← ANALYTICS                  │
│ - Aggregated metrics from all calibration_history records       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Overlap Analysis

### ✅ No Significant Duplication

| Data | calibration_sessions | calibration_history |
|------|---------------------|---------------------|
| **Purpose** | Active session tracking | Historical record |
| **Lifecycle** | Transient (deleted after?) | Permanent (append-only) |
| **Status field** | 6 statuses (workflow phases) | 4 statuses (final outcome) |
| **Issues tracking** | Live issues list for UI | Final issues snapshot |
| **User interaction** | user_fixes, backup_pilot_steps | None (result only) |
| **Execution summary** | Detailed data sources accessed | High-level metrics only |
| **Workflow backup** | ✅ backup_pilot_steps | ❌ Not needed |
| **Multi-iteration tracking** | ❌ Single session | ✅ iterations field |
| **V6 quality tracking** | ❌ Not tracked | ✅ v6_version, model_used |
| **Analytics indexes** | ❌ Not optimized | ✅ Multiple indexes |
| **Validation metadata** | ❌ Not stored | ✅ metadata JSONB field |

---

## Conclusion: All 3 Are Needed

### `calibration_sessions` - **Keep**
**Why:** Essential for interactive calibration UI workflow
- Tracks multi-phase calibration process
- Stores user fixes and approvals for interactive flow
- Holds backup workflow for rollback
- Different status model (6 phases vs 4 final statuses)
- Optimized for frequent updates during active calibration

**Alternative:** Could we use calibration_history only?
- ❌ No - calibration_history is append-only (can't update during calibration)
- ❌ No - calibration_history doesn't track UI workflow phases
- ❌ No - calibration_history doesn't store user_fixes or backup data

---

### `calibration_history` - **Keep**
**Why:** Essential for analytics and V6 quality tracking
- Permanent record of ALL calibration runs (success and failure)
- Enables historical trend analysis
- Tracks V6 generation quality over time
- Optimized for analytics queries (indexes, view)
- Stores validation metadata (layer1/layer2 fixes)
- Enables pattern detection for common issues

**Alternative:** Could we use calibration_sessions only?
- ❌ No - sessions are transient (might be deleted)
- ❌ No - sessions lack analytics indexes
- ❌ No - sessions don't track V6 version or model used
- ❌ No - sessions don't have workflow_hash for regression detection
- ❌ No - can't query "all successful calibrations in last 30 days" efficiently

---

### `calibration_success_metrics` - **Keep**
**Why:** Performance optimization for common analytics queries
- Pre-aggregated daily metrics (faster than runtime aggregation)
- Used by dashboards and monitoring
- Minimal cost (just a view definition)

**Alternative:** Could we query calibration_history directly?
- ⚠️ Yes, but slower for dashboard queries
- ⚠️ View provides consistent interface if we change aggregation logic

---

## Relationship Between Tables

### Link: session_id
```sql
-- Get full calibration details
SELECT
  ch.*,
  cs.user_fixes,
  cs.execution_summary
FROM calibration_history ch
LEFT JOIN calibration_sessions cs ON cs.id = ch.session_id
WHERE ch.agent_id = '...';
```

### Purpose of Link
- **Traceability**: Link historical record back to original session
- **Debugging**: If analytics show an anomaly, can look up full session details
- **UI**: "View original calibration session" button in history view

---

## Recommendations

### 1. ✅ Keep All 3 (2 tables + 1 view)
They serve different purposes with minimal overlap.

### 2. 📋 Add Session Cleanup Policy
Currently unclear if `calibration_sessions` are deleted after completion.

**Recommendation:**
```sql
-- Delete old completed sessions (keep for 7 days for debugging)
DELETE FROM calibration_sessions
WHERE status IN ('completed', 'failed')
AND completed_at < NOW() - INTERVAL '7 days';
```

Or keep them indefinitely but with a partial index:
```sql
-- Index only active sessions (most queries)
CREATE INDEX idx_calibration_sessions_active
ON calibration_sessions(agent_id, created_at DESC)
WHERE status NOT IN ('completed', 'failed');
```

### 3. 📋 Clarify Data Lifecycle

| Stage | calibration_sessions | calibration_history |
|-------|---------------------|---------------------|
| **Start calibration** | INSERT (status: running) | - |
| **Collect issues** | UPDATE (status: collecting) | - |
| **User review** | UPDATE (status: awaiting_fixes) | - |
| **Apply fixes** | UPDATE (status: fixes_applied) | - |
| **Complete** | UPDATE (status: completed) | INSERT (final record) |
| **After 7 days** | DELETE (optional) | KEEP (permanent) |
| **After 90 days** | - | KEEP or ARCHIVE |

### 4. 📋 Document the Relationship

Add to both repositories:

**CalibrationSessionRepository.ts:**
```typescript
/**
 * IMPORTANT: This table tracks ACTIVE calibration sessions for UI workflow.
 * When calibration completes, a permanent record is saved to calibration_history.
 *
 * Lifecycle:
 * 1. Created when user starts calibration
 * 2. Updated as calibration progresses through phases
 * 3. Marked completed when calibration finishes
 * 4. (Optional) Deleted after 7 days
 *
 * Related tables:
 * - calibration_history: Permanent analytics record (links via session_id)
 */
```

**CalibrationHistoryRepository.ts:**
```typescript
/**
 * IMPORTANT: This table stores PERMANENT records of all calibration runs.
 * Used for analytics, V6 quality tracking, and historical trend analysis.
 *
 * Lifecycle:
 * 1. Created when calibration completes (success or failure)
 * 2. Never updated (append-only)
 * 3. Never deleted (or archived after 90+ days)
 *
 * Related tables:
 * - calibration_sessions: Active session tracking (linked via session_id)
 */
```

---

## Summary

### Question: Do we need all 3?

**Answer: YES**

1. **`calibration_sessions`** = Active session tracking for UI workflow (transient)
2. **`calibration_history`** = Permanent analytics record (append-only)
3. **`calibration_success_metrics`** = Performance optimization (view)

**No significant duplication** - Each serves a distinct purpose:
- Sessions: UI interaction, user fixes, workflow backup
- History: Analytics, V6 quality, regression detection
- Metrics: Pre-aggregated analytics for dashboards

**They complement each other** - Sessions provide rich detail for active calibrations, History provides long-term analytics, Metrics provide fast aggregations.

---

## Action Items

- ✅ Keep all 3 tables/views
- ⬜ Add cleanup policy for old calibration_sessions (optional)
- ⬜ Document relationship in both repositories
- ⬜ Add `session_id` link to batch calibration API (already done in code)
- ⬜ Consider archiving calibration_history after 90 days (future)
