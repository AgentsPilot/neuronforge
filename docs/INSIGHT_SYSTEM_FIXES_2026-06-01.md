# Agent Shadow Insight System - Fixes & Improvements

> **Date:** 2026-06-01
> **Status:** Ready for migration
> **Related SQL:** `supabase/SQL Scripts/20260601_fix_execution_insights_schema.sql`

## Executive Summary

After analyzing the agent shadow insight system following a failed commit, we identified **5 critical schema mismatches** between the database and code expectations. All issues have been diagnosed and fixes prepared.

**Root Cause of Failed Commit:** The database `confidence` column only accepted 4 string values (`observation`, `early_signals`, `emerging_patterns`, `confirmed`) but the LLM-powered `BusinessInsightGenerator` returns numeric confidence scores (0.0-1.0).

---

## 🔴 Critical Issues Fixed

### 1. **Confidence Type Mismatch** (BLOCKING)

**Problem:**
- Database constraint: `confidence IN ('observation', 'early_signals', 'emerging_patterns', 'confirmed')`
- Code generates: Numeric values 0.0-1.0 from LLM
- **Result:** INSERT fails when storing insights

**Fix Applied:**
- Changed `confidence` column from TEXT enum to `numeric(4,3)`
- Added computed `confidence_mode` column for backward compatibility
- Updated TypeScript types to use `confidence: number`
- Removed `convertConfidenceToMode()` method from BusinessInsightGenerator

**Migration:** Lines 44-75 in SQL script

---

### 2. **Missing `business_intelligence` Category** (BLOCKING)

**Problem:**
- Database allows: `'data_quality'`, `'growth'`
- Code uses: `'business_intelligence'` for volume trends, category shifts, performance issues
- **Result:** INSERT fails for trend-based insights

**Fix Applied:**
- Added `'business_intelligence'` to category constraint
- Updated BusinessInsightGenerator to use correct category

**Migration:** Lines 17-26 in SQL script

---

### 3. **Missing Business Intelligence Insight Types** (BLOCKING)

**Problem:**
- Database allows: 11 insight types
- Code generates: 15 types (missing `volume_trend`, `category_shift`, `performance_issue`, `operational_anomaly`)
- **Result:** INSERT fails for business intelligence insights

**Fix Applied:**
- Added 4 missing insight types to constraint

**Migration:** Lines 28-51 in SQL script

---

### 4. **`execution_ids` Type Mismatch** (ERROR PRONE)

**Problem:**
- Database: `text[]`
- Code expects: `uuid[]`
- **Result:** Type errors, potential data corruption

**Fix Applied:**
- Changed column type from `text[]` to `uuid[]`

**Migration:** Lines 11-13 in SQL script

---

### 5. **Wrong Foreign Key in `execution_insight_runs`** (ERROR PRONE)

**Problem:**
- Current FK: `execution_id` → `agent_executions(id)`
- Should reference: `workflow_executions(id)` (new execution table)
- **Result:** FK violations when linking to workflow executions

**Fix Applied:**
- Updated FK constraint to reference `workflow_executions`
- Added `agent_id` column for better querying
- Backfilled `agent_id` from existing execution data

**Migration:** Lines 84-102 in SQL script

---

## ✅ Code Updates Applied

### TypeScript Type Updates

**File:** `lib/pilot/insight/types.ts`

```typescript
export interface ExecutionInsight {
  // ... other fields ...

  confidence: number;  // UPDATED: Always numeric (0.0-1.0)
  confidence_mode?: ConfidenceMode;  // ADDED: Computed from score

  // ADDED: Business value metrics (from DB schema)
  time_saved_hours_per_week?: number;
  cost_saved_usd_per_week?: number;
  revenue_at_risk_usd?: number;
  automation_potential_percentage?: number;
}

// ADDED: Helper functions
export function getConfidenceModeFromScore(confidence: number): ConfidenceMode;
export function getConfidenceScoreFromExecutionCount(executionCount: number): number;
```

### Repository Updates

**File:** `lib/repositories/InsightRepository.ts`

- Updated `create()` to accept numeric confidence
- Added business value metric fields to INSERT
- Updated type signature: `Omit<ExecutionInsight, 'id' | 'created_at' | 'updated_at' | 'confidence_mode'>`

### Generator Updates

**File:** `lib/pilot/insight/BusinessInsightGenerator.ts`

- Changed category from `'growth'` → `'business_intelligence'` for trend insights
- Store numeric confidence directly (removed conversion)
- Removed unused `convertConfidenceToMode()` method

---

## 📊 Database Schema (After Migration)

### `execution_insights` Table

```sql
CREATE TABLE execution_insights (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  agent_id UUID REFERENCES agents,
  execution_ids UUID[],  -- FIXED: Was text[]

  -- Classification
  insight_type TEXT CHECK (insight_type IN (
    -- Data Quality
    'data_unavailable', 'data_malformed', 'data_missing_fields',
    'data_type_mismatch', 'data_validation_failed',
    -- Growth
    'automation_opportunity', 'cost_optimization', 'performance_degradation',
    'reliability_risk', 'schedule_optimization', 'scale_opportunity',
    -- Business Intelligence (ADDED)
    'volume_trend', 'category_shift', 'performance_issue', 'operational_anomaly'
  )),
  category TEXT CHECK (category IN (
    'data_quality', 'growth', 'business_intelligence'  -- ADDED business_intelligence
  )),
  severity TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical')),

  -- FIXED: Confidence now numeric with computed mode
  confidence NUMERIC(4,3) CHECK (confidence >= 0.0 AND confidence <= 1.0),
  confidence_mode TEXT GENERATED ALWAYS AS (
    CASE
      WHEN confidence < 0.20 THEN 'observation'
      WHEN confidence < 0.35 THEN 'early_signals'
      WHEN confidence < 0.50 THEN 'emerging_patterns'
      ELSE 'confirmed'
    END
  ) STORED,

  -- Content
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  business_impact TEXT NOT NULL,
  recommendation TEXT NOT NULL,

  -- Metadata
  pattern_data JSONB DEFAULT '{}',
  metrics JSONB DEFAULT '{}',

  -- Business value metrics
  time_saved_hours_per_week NUMERIC(10,2),
  cost_saved_usd_per_week NUMERIC(10,2),
  revenue_at_risk_usd NUMERIC(10,2),
  automation_potential_percentage NUMERIC(5,2),

  -- Lifecycle
  status TEXT DEFAULT 'new',
  snoozed_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  viewed_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ
);
```

### `execution_insight_runs` Table

```sql
CREATE TABLE execution_insight_runs (
  id UUID PRIMARY KEY,
  insight_id UUID REFERENCES execution_insights,
  execution_id UUID REFERENCES workflow_executions,  -- FIXED: Was agent_executions
  agent_id UUID REFERENCES agents,  -- ADDED
  user_id UUID REFERENCES auth.users,

  -- Insight content
  title TEXT NOT NULL,
  description TEXT,
  business_impact TEXT,
  recommendation TEXT,
  severity TEXT,
  confidence TEXT,

  -- Run metadata
  this_run_count INTEGER,
  last_run_count INTEGER,

  -- LLM metrics
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  model TEXT,
  latency_ms INTEGER,
  llm_called BOOLEAN DEFAULT TRUE,
  cache_hit BOOLEAN DEFAULT FALSE,

  -- Business metrics
  time_saved_hours_per_week NUMERIC(10,2),
  cost_saved_usd_per_week NUMERIC(10,2),
  pattern_data JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 🚀 Next Steps

### 1. Run Migration (Required)

```bash
# Connect to Supabase and run:
psql $DATABASE_URL -f "supabase/SQL Scripts/20260601_fix_execution_insights_schema.sql"
```

**Verification:**
```sql
-- Check confidence column type
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_name = 'execution_insights'
  AND column_name IN ('confidence', 'confidence_mode', 'execution_ids');

-- Check constraints
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'execution_insights'::regclass
  AND (conname LIKE '%category%' OR conname LIKE '%insight_type%');
```

### 2. Test Insight Generation (Recommended)

```typescript
// Test that insights now store successfully
import { InsightAnalyzer } from '@/lib/pilot/insight/InsightAnalyzer';

const analyzer = new InsightAnalyzer(supabase);
const result = await analyzer.analyze(agentId, 20);

// Verify:
// 1. result.patterns contains DetectedPattern[] with numeric confidence_score
// 2. result.businessInsights contains BusinessInsight[] with numeric confidence
// 3. Insights stored in DB with confidence as numeric (0.0-1.0)
// 4. confidence_mode computed correctly
```

### 3. Update Documentation (Optional)

The three categories are now:

| Category | Purpose | Examples |
|----------|---------|----------|
| **data_quality** | Fix data problems | Empty results, malformed data, missing fields |
| **growth** | Improve business | Automation opportunities, cost optimization, reliability |
| **business_intelligence** | Understand trends | Volume changes, category shifts, performance degradation |

**Note:** Your initial description mentioned "Growth, Data Insight, Technical" — we kept the code's naming (`data_quality`, `growth`, `business_intelligence`) since it's more descriptive and already implemented throughout.

---

## 💡 Recommended Improvements (Future)

### A. Add Performance Indexes

```sql
-- Already included in migration, but worth highlighting:
CREATE INDEX idx_execution_insights_dedup
  ON execution_insights(agent_id, category, created_at DESC)
  WHERE status IN ('new', 'viewed');

CREATE INDEX idx_execution_insights_confidence
  ON execution_insights(confidence_mode, severity);
```

### B. Replace console.error with Structured Logging

**File:** `lib/repositories/InsightRepository.ts`

```typescript
// Current (44 occurrences of console.error)
console.error('[InsightRepository] Failed to create insight:', error);

// Should be
import { createLogger } from '@/lib/logger';
const logger = createLogger({ service: 'InsightRepository' });

logger.error({ err: error, insight }, 'Failed to create insight');
```

### C. Track Insight Lifecycle Events

Add audit trail for user interactions:

```typescript
// When user views/applies/dismisses insight
await auditTrail.log({
  action: 'INSIGHT_VIEWED',
  entityType: 'execution_insight',
  entityId: insightId,
  metadata: {
    insight_type,
    category,
    severity,
    confidence,
    days_to_action: daysFromCreation
  }
});
```

### D. Add ROI Dashboard UI

The system now tracks:
- `time_saved_hours_per_week`
- `cost_saved_usd_per_week`
- `automation_potential_percentage`
- ROI estimate in `pattern_data`

Create a dashboard component to visualize cumulative time/cost savings across all agents.

---

## 📊 Dual-Table Population Architecture

The insight system now populates **both tables** on every execution to enable anomaly detection:

### Table Responsibilities

| Table | Purpose | Use Case |
|-------|---------|----------|
| **`execution_insight_runs`** | Per-execution snapshot | Compare current run vs historical runs to detect anomalies |
| **`execution_insights`** | Current active insights | User-facing dashboard grouped by 3 categories |

### Anomaly Detection Use Case

**Purpose**: Store every run's insight metrics to identify when the latest run is anomalous.

**Example**:
- Run #1-10: "Processing 100 leads/day" (volume_trend, confidence: 0.8)
- Run #11: "Processing 500 leads/day" (volume_trend, confidence: 0.85) ← **ANOMALY DETECTED**

By storing `this_run_count` and `last_run_count` in `execution_insight_runs`, the system can:
1. Compare current run's metrics to historical average
2. Detect sudden spikes/drops in volume, quality, or performance
3. Alert users when latest run deviates significantly from pattern

### Population Flow

```typescript
// For each pattern/insight detected:

// 1. Store snapshot to execution_insight_runs (with insight_id = null initially)
await repository.createInsightRun({
  insight_id: null,         // Will be linked after step 2
  execution_id: executionId,
  this_run_count: 500,      // Current run: 500 items
  last_run_count: 100,      // Previous run: 100 items
  confidence: 0.85,
  llm_called: true,
  cache_hit: false,
  input_tokens: 1234,
  // ... store LLM metrics for performance tracking
});

// 2. Upsert to execution_insights (user-facing current state)
const existing = await repository.findExistingByTitle(agentId, insight.title, 7);
if (existing) {
  await repository.addExecutionToInsight(existing.id, executionId);
  await repository.linkInsightRun(executionId, insight.title, existing.id);
} else {
  const created = await repository.create({ category: 'business_insight', ... });
  await repository.linkInsightRun(executionId, insight.title, created.id);
}
```

**Linking Benefits:**
- ✅ Can query `execution_insight_runs` and JOIN to `execution_insights` for full context
- ✅ Track which runs contributed to which active insights
- ✅ Analyze insight evolution over time (confidence changes, severity shifts)
- ✅ Maintain time-series independence while enabling relational queries

### Why This Enables Anomaly Detection

- **Historical Baseline**: `execution_insight_runs` builds a time-series of metrics per insight
- **Comparison Logic**: System can query last N runs to compute average/std-dev
- **Latest Run Analysis**: Compare `this_run_count` vs historical pattern
- **Alerting**: If latest run is >2σ from mean → flag as anomaly

---

## 📝 Files Changed

| File | Changes |
|------|---------|
| `supabase/SQL Scripts/20260601_fix_execution_insights_schema.sql` | **NEW** - Migration script with all fixes |
| `lib/pilot/insight/types.ts` | Updated `ExecutionInsight` interface, added helper functions |
| `lib/repositories/InsightRepository.ts` | **NEW** - Added `createInsightRun()` method for dual-table population |
| `lib/pilot/insight/BusinessInsightGenerator.ts` | Fixed category, LLM prompt types, removed confidence conversion |
| `lib/pilot/WorkflowPilot.ts` | **CRITICAL** - Dual-table population, fixed category bug ('growth' → 'business_insight'), fixed confidence type bug (string → numeric) |

---

## ✅ Testing Checklist

Before deploying:

- [ ] Run migration script on staging
- [ ] Verify confidence column is `numeric(4,3)`
- [ ] Verify confidence_mode is computed correctly
- [ ] Test insight generation for agent with 1 execution (observation mode)
- [ ] Test insight generation for agent with 10+ executions (confirmed mode)
- [ ] Verify business intelligence insights store successfully
- [ ] Check that existing insights (if any) migrated correctly
- [ ] Verify FK from execution_insight_runs → workflow_executions works
- [ ] Test deduplication logic (findExistingInsight by category)

---

## 🎯 Summary

**What was broken:**
- Database schema didn't match code expectations
- Failed commits due to constraint violations
- Type mismatches causing errors

**What's fixed:**
- ✅ Confidence now stores numeric values from LLM
- ✅ Business intelligence category and types added
- ✅ execution_ids properly typed as UUID[]
- ✅ FK references correct table
- ✅ TypeScript types updated to match DB
- ✅ Unused code removed

**What's improved:**
- 📊 Performance indexes added
- 🧮 Computed confidence_mode column
- 📈 Business value metrics available
- 🔍 Better query patterns for deduplication

**Impact:**
- System will now successfully store insights from LLM
- Trend-based insights will work correctly
- No more INSERT constraint violations
- Foundation for ROI tracking and analytics

---

## 🔄 Implementation Summary (2026-06-01)

### ✅ Completed Changes

**1. Database Migration** (`20260601_fix_execution_insights_schema.sql`)
- ✅ Category migration: `data_quality` → `data_insight`, `business_intelligence` → `business_insight`
- ✅ Split `growth` category into `technical_insight` and `business_insight` based on insight_type
- ✅ Confidence column: TEXT enum → numeric(4,3) with computed `confidence_mode`
- ✅ Added `scale_opportunity` to allowed business insight types
- ✅ Fixed execution_ids: text[] → uuid[]
- ✅ Fixed FK in execution_insight_runs: references workflow_executions (not agent_executions)
- ✅ **NEW**: Made `insight_id` nullable in execution_insight_runs to allow dual-table population

**2. TypeScript Types** (`lib/pilot/insight/types.ts`)
- ✅ Updated InsightCategory to 3 categories: data_insight, business_insight, technical_insight
- ✅ Reorganized InsightType with clear category groupings
- ✅ Added helper functions: getConfidenceModeFromScore(), getConfidenceScoreFromExecutionCount()

**3. LLM Prompt Fixes** (`lib/pilot/insight/BusinessInsightGenerator.ts`)
- ✅ Fixed BusinessInsight interface: removed performance_issue, added scale_opportunity
- ✅ Fixed LLM prompt types (lines 327 & 911): Now generates correct business types
- ✅ Added type guidelines to prompt (volume_trend, scale_opportunity, operational_anomaly, category_shift)
- ✅ Added severity guidelines (context-aware: "0 complaints" = good news)
- ✅ Changed category from 'business_intelligence' to 'business_insight' (line 752)
- ✅ Fixed cache lookup to use 'business_insight' category (line 100)
- ✅ Added type validation: filters invalid LLM responses (line 589)

**4. Pattern Detector Categories** (4 files)
- ✅ DataQualityDetector: data_quality → data_insight
- ✅ ReliabilityDetector: growth → technical_insight
- ✅ CostDetector: growth → technical_insight
- ✅ AutomationDetector: growth → business_insight

**5. Dual-Table Population** (`lib/pilot/WorkflowPilot.ts` + `lib/repositories/InsightRepository.ts`)
- ✅ Added `createInsightRun()` method to InsightRepository
- ✅ Added `linkInsightRun()` method to link runs to their corresponding insights
- ✅ WorkflowPilot now populates BOTH tables on every execution:
  - First: Store to `execution_insight_runs` (per-execution snapshot with LLM metrics, `insight_id = null`)
  - Then: Upsert to `execution_insights` (current active state)
  - Finally: Link run to insight via `linkInsightRun()` for relational queries
- ✅ Fixed critical bugs in WorkflowPilot:
  - Line 2571: Changed 'growth' → 'business_insight'
  - Line 2573: Changed confidence from string → numeric
  - Line 2525: Use pattern.category instead of hardcoded 'data_quality'
  - Line 2527: Use pattern.confidence_score instead of analysisResult.confidence_mode

**6. Documentation** (`docs/INSIGHT_SYSTEM_FIXES_2026-06-01.md`)
- ✅ Added comprehensive 3-category system explanation
- ✅ Documented dual-table population architecture
- ✅ Explained anomaly detection use case

### 🎯 Result

The insight system now:
1. ✅ Stores insights correctly with numeric confidence (0.0-1.0)
2. ✅ Uses correct 3-category taxonomy: data_insight, business_insight, technical_insight
3. ✅ LLM generates correct business insight types
4. ✅ Populates BOTH tables for anomaly detection:
   - `execution_insight_runs`: Historical time-series for comparing latest run vs baseline
   - `execution_insights`: Current active insights shown in UI
5. ✅ No more INSERT constraint violations
6. ✅ Foundation for anomaly detection (compare this_run_count vs last_run_count)

---

**Ready for production after migration is applied and tested.**

---

## 📊 Three Categories of Insights

The system provides insights in 3 distinct categories aligned with user needs:

### 1. Data Insight
**Purpose:** Fix data quality problems

**Source:** DataQualityDetector (rule-based pattern detection)

**Types:**
- `data_unavailable` - Empty results, missing data
- `data_malformed` - Unexpected structure
- `data_missing_fields` - Required fields not present
- `data_type_mismatch` - Wrong data type
- `data_validation_failed` - Schema validation errors

**Examples:**
- "Gmail search returns 0 emails in last 15 runs - check search filters"
- "Missing 'priority' field in 70% of executions - API response changed"
- "Spreadsheet 'Q4 Invoices' not found - check file name"

**Severity Logic:** Based on frequency (80%+ = critical, 50-80% = high, 30-50% = medium, <30% = low)

---

### 2. Business Insight
**Purpose:** Understand business operations, identify growth opportunities

**Source:** BusinessInsightGenerator (LLM - Claude Sonnet 4) + AutomationDetector (rare)

**Types:**
- `volume_trend` - Volume changes (increasing/decreasing, good news or problems)
- `scale_opportunity` - Growth/scaling opportunities, capacity planning
- `operational_anomaly` - Unusual patterns, spikes, drops, zero results
- `category_shift` - Distribution changes (field presence, category mix)
- `automation_opportunity` - Manual work that could be automated (pattern detector)

**Examples:**
- "Lead volume up 45% this week - consider faster schedule" (good news, low severity)
- "Customer complaints down 80% - automation working well!" (celebratory, low severity)
- "Zero new invoices for 3 days - check data source" (problem, high severity)
- "Processing 3x more items - could handle 2x current volume" (scale opportunity, medium severity)
- "High-priority emails increased from 20% to 60%" (category shift, medium severity)

**Severity Logic:** Context-aware
- "0 complaints" = LOW severity (good news)
- "0 leads" = HIGH severity (problem)
- Celebratory insights = LOW severity
- Problems/concerns = MEDIUM-HIGH severity

**Key Feature:** Shows ALL situations (good news + problems) to help users understand their business

---

### 3. Technical Insight
**Purpose:** Fix system health issues

**Source:** ReliabilityDetector, CostDetector (rule-based pattern detection)

**Types:**
- `reliability_risk` - Failures, no fallbacks, single points of failure
- `performance_degradation` - Processing slower than baseline
- `cost_optimization` - High LLM token usage, expensive operations
- `schedule_optimization` - Inefficient scheduling (runs when no work available)

**Examples:**
- "Workflow failed 5 times in last 10 runs - check data sources" (high severity)
- "Performance degraded: 8 seconds per run (was 4 seconds)" (medium severity)
- "High token usage: 7,500 tokens/run = $12.50/week" (medium severity)
- "Agent runs hourly but only has work 3x/day - reduce schedule" (low severity)

**Severity Logic:** Based on failure rate and performance impact

---

## 🎯 Why Three Categories?

**Clear Separation of Concerns:**
- **Data Insight** → "Is my data broken?"
- **Business Insight** → "What's happening in my business?"
- **Technical Insight** → "Is my system healthy?"

**Different Sources:**
- Data + Technical → Rule-based pattern detectors (fast, deterministic)
- Business → LLM-powered analysis (context-aware, intelligent caching)

**Different Actions:**
- Data → Fix integrations, check filters
- Business → Scale operations, investigate trends, celebrate wins
- Technical → Optimize performance, reduce costs, fix failures

---

## 🔄 Migration Impact

The migration renames categories to align with user vision:

| Old Category | New Category | What Changed |
|-------------|--------------|--------------|
| `data_quality` | `data_insight` | Name only (same insights) |
| `business_intelligence` | `business_insight` | Name + expanded types |
| `growth` | Split: `business_insight` OR `technical_insight` | Based on insight_type |

**Split Logic for `growth`:**
- `automation_opportunity` → `business_insight`
- `reliability_risk`, `performance_degradation`, `cost_optimization`, `schedule_optimization` → `technical_insight`
