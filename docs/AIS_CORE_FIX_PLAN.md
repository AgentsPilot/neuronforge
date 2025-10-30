# AIS CORE SYSTEM FIX PLAN
## Making AIS 100% Reliable & Consistent

**Created:** 2025-01-29
**Goal:** Fix all AIS scoring issues, eliminate hardcoding, ensure reliability
**Scope:** AIS calculation accuracy ONLY (pricing integration excluded)
**Time:** 4 hours

---

## CRITICAL ISSUES TO FIX

### 🔴 ISSUE 1: Hardcoded Values in 3 Locations
**Files Affected:**
- `lib/services/AgentIntensityService.ts` (lines 489, 495, 502, 556-586)
- `lib/utils/updateAgentIntensity.ts` (lines 259-277)
- `app/api/agents/[id]/intensity/route.ts` (lines 134-137)

**Problem:** Same ranges defined differently in each location
**Risk:** Update one, forget the others → inconsistent scores
**Fix:** Single source of truth from database

---

### 🔴 ISSUE 2: Creation Score Calculated Inconsistently
**Where:**
- **AgentIntensityService.calculateCreationScores()** → Returns 2 components (both duplicates)
- **API /agents/[id]/intensity** → Recalculates as 4 dimensions

**Problem:** Stored score doesn't match UI breakdown
**Example:**
```
Database: creation_score = 2.15 (from complexity + efficiency dummy)
UI shows: workflow=1.8, plugin=1.0, io=3.2, trigger=0.0
When recalculated: 1.8×0.5 + 1.0×0.3 + 3.2×0.2 + 0 = 1.84 ≠ 2.15
```

**Fix:** Store and use 4 dimensions consistently everywhere

---

### 🔴 ISSUE 3: Combined Score Not Calculated on Creation
**Where:** `AgentIntensityService.trackCreationCosts()` (line 103-115)

**Problem:**
```typescript
// Agent created with creation_score = 2.15
// combined_score defaults to 5.0
// Should be: (2.15 × 0.3) + (5.0 × 0.7) = 4.145
```

**Impact:** New agents have wrong combined_score until first execution

---

### 🟡 ISSUE 4: Different Ranges for Same Concept
**Examples:**
- Workflow steps: Creation uses (1-10), Execution uses (0-20)
- Plugins: Creation uses (1-5), Execution uses (0-10)

**Problem:** Same metric normalized differently depending on context
**Fix:** Unify ranges or explicitly separate creation vs execution ranges

---

## FIX PLAN

### PHASE 1: Create Centralized Configuration (1.5 hours)

#### Step 1.1: Create AISConfigService
**File:** `lib/services/AISConfigService.ts` (NEW FILE)

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AISRange {
  min: number;
  max: number;
}

export interface AISRanges {
  // Execution metrics
  token_volume: AISRange;
  token_peak: AISRange;
  token_io_ratio_min: number;
  token_io_ratio_max: number;
  iterations: AISRange;
  duration_ms: AISRange;
  failure_rate: AISRange;
  retry_rate: AISRange;
  plugin_count: AISRange;
  plugins_per_run: AISRange;
  orchestration_overhead_ms: AISRange;
  workflow_steps: AISRange;
  branches: AISRange;
  loops: AISRange;
  parallel: AISRange;

  // Creation-specific metrics
  creation_workflow_steps: AISRange;
  creation_plugins: AISRange;
  creation_io_fields: AISRange;
}

/**
 * Centralized AIS Configuration Service
 * SINGLE SOURCE OF TRUTH for all AIS ranges
 */
export class AISConfigService {
  private static cache: AISRanges | null = null;
  private static cacheTimestamp: number = 0;
  private static CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Get active AIS ranges (with caching)
   */
  static async getRanges(supabase: SupabaseClient): Promise<AISRanges> {
    const now = Date.now();

    // Return cached ranges if still valid
    if (this.cache && (now - this.cacheTimestamp) < this.CACHE_TTL_MS) {
      return this.cache;
    }

    try {
      // Fetch ranges from database
      const { data, error } = await supabase.rpc('get_active_ais_ranges');

      if (error || !data) {
        console.warn('⚠️ Failed to fetch AIS ranges, using fallback');
        return this.getFallbackRanges();
      }

      // Convert array to typed object
      const ranges = this.parseRanges(data);

      // Update cache
      this.cache = ranges;
      this.cacheTimestamp = now;

      return ranges;
    } catch (error) {
      console.error('Error fetching AIS ranges:', error);
      return this.getFallbackRanges();
    }
  }

  /**
   * Parse database result into typed ranges
   */
  private static parseRanges(data: any[]): AISRanges {
    const map: Record<string, { min: number; max: number }> = {};

    data.forEach((row: any) => {
      map[row.range_key] = {
        min: parseFloat(row.min_value),
        max: parseFloat(row.max_value)
      };
    });

    return {
      // Execution ranges
      token_volume: map.token_volume ?? { min: 0, max: 5000 },
      token_peak: map.token_peak ?? { min: 0, max: 10000 },
      token_io_ratio_min: map.token_io_ratio_min?.min ?? 0.5,
      token_io_ratio_max: map.token_io_ratio_max?.min ?? 3.0,
      iterations: map.iterations ?? { min: 1, max: 10 },
      duration_ms: map.duration_ms ?? { min: 0, max: 30000 },
      failure_rate: map.failure_rate ?? { min: 0, max: 50 },
      retry_rate: map.retry_rate ?? { min: 0, max: 3 },
      plugin_count: map.plugin_count ?? { min: 0, max: 10 },
      plugins_per_run: map.plugins_per_run ?? { min: 0, max: 8 },
      orchestration_overhead_ms: map.orchestration_overhead_ms ?? { min: 0, max: 5000 },
      workflow_steps: map.workflow_steps ?? { min: 0, max: 20 },
      branches: map.branches ?? { min: 0, max: 10 },
      loops: map.loops ?? { min: 0, max: 50 },
      parallel: map.parallel ?? { min: 0, max: 5 },

      // Creation ranges (use same as execution if not specified)
      creation_workflow_steps: map.creation_workflow_steps ?? map.workflow_steps ?? { min: 1, max: 10 },
      creation_plugins: map.creation_plugins ?? map.plugin_count ?? { min: 1, max: 5 },
      creation_io_fields: map.creation_io_fields ?? { min: 1, max: 8 },
    };
  }

  /**
   * Fallback ranges (when database unavailable)
   */
  private static getFallbackRanges(): AISRanges {
    return {
      token_volume: { min: 0, max: 5000 },
      token_peak: { min: 0, max: 10000 },
      token_io_ratio_min: 0.5,
      token_io_ratio_max: 3.0,
      iterations: { min: 1, max: 10 },
      duration_ms: { min: 0, max: 30000 },
      failure_rate: { min: 0, max: 50 },
      retry_rate: { min: 0, max: 3 },
      plugin_count: { min: 0, max: 10 },
      plugins_per_run: { min: 0, max: 8 },
      orchestration_overhead_ms: { min: 0, max: 5000 },
      workflow_steps: { min: 0, max: 20 },
      branches: { min: 0, max: 10 },
      loops: { min: 0, max: 50 },
      parallel: { min: 0, max: 5 },
      creation_workflow_steps: { min: 1, max: 10 },
      creation_plugins: { min: 1, max: 5 },
      creation_io_fields: { min: 1, max: 8 },
    };
  }

  /**
   * Normalize value to 0-10 scale
   */
  static normalize(value: number, range: AISRange, invert: boolean = false): number {
    const clamped = Math.max(range.min, Math.min(range.max, value));
    const normalized = ((clamped - range.min) / (range.max - range.min)) * 10;
    return invert ? (10 - normalized) : normalized;
  }

  /**
   * Clear cache (for testing or admin updates)
   */
  static clearCache(): void {
    this.cache = null;
    this.cacheTimestamp = 0;
  }
}
```

#### Step 1.2: Add Creation Ranges to Database
**File:** `supabase/migrations/YYYYMMDD_add_creation_ranges.sql`

```sql
-- Add creation-specific ranges to ais_normalization_ranges
INSERT INTO ais_normalization_ranges (
  range_key,
  best_practice_min,
  best_practice_max,
  dynamic_min,
  dynamic_max,
  description
) VALUES
(
  'creation_workflow_steps',
  1, 10,
  1, 10,
  'Number of workflow steps in agent design (for creation score)'
),
(
  'creation_plugins',
  1, 5,
  1, 5,
  'Number of plugins connected to agent (for creation score)'
),
(
  'creation_io_fields',
  1, 8,
  1, 8,
  'Total input + output fields in agent schema (for creation score)'
)
ON CONFLICT (range_key) DO NOTHING;
```

---

### PHASE 2: Fix Creation Score Calculation (1 hour)

#### Step 2.1: Update Database Schema
**File:** `supabase/migrations/YYYYMMDD_update_creation_dimensions.sql`

```sql
-- Add 4 new columns for creation dimensions
ALTER TABLE agent_intensity_metrics
ADD COLUMN IF NOT EXISTS creation_workflow_score DECIMAL(5,2) DEFAULT 5.0,
ADD COLUMN IF NOT EXISTS creation_plugin_score DECIMAL(5,2) DEFAULT 5.0,
ADD COLUMN IF NOT EXISTS creation_io_score DECIMAL(5,2) DEFAULT 5.0,
ADD COLUMN IF NOT EXISTS creation_trigger_score DECIMAL(5,2) DEFAULT 0.0;

-- Add indices for performance
CREATE INDEX IF NOT EXISTS idx_agent_intensity_creation_workflow
ON agent_intensity_metrics(creation_workflow_score);

CREATE INDEX IF NOT EXISTS idx_agent_intensity_creation_plugin
ON agent_intensity_metrics(creation_plugin_score);

-- Note: We'll keep old columns for now (backward compatibility during migration)
-- Will drop them in a future migration after backfill is complete
```

#### Step 2.2: Update AgentIntensityService
**File:** `lib/services/AgentIntensityService.ts`

**Changes to calculateCreationScores() (lines 444-535):**

```typescript
// BEFORE:
return {
  creation_complexity: {
    score: this.clamp(creationComplexityScore, 0, 10),
    weight: CREATION_WEIGHTS.CREATION_COMPLEXITY,
    weighted_score: this.clamp(creationComplexityScore, 0, 10) * CREATION_WEIGHTS.CREATION_COMPLEXITY,
  },
  creation_efficiency: {
    score: this.clamp(creation_efficiency_dummy, 0, 10),
    weight: CREATION_WEIGHTS.CREATION_EFFICIENCY,
    weighted_score: this.clamp(creation_efficiency_dummy, 0, 10) * CREATION_WEIGHTS.CREATION_EFFICIENCY,
  },
};

// AFTER:
import { AISConfigService } from './AISConfigService';

// At the start of the function, fetch ranges
const ranges = await AISConfigService.getRanges(supabaseClient);

// Use database ranges for normalization
const workflowScore = AISConfigService.normalize(
  workflowSteps.length,
  ranges.creation_workflow_steps
);

const pluginScore = AISConfigService.normalize(
  connectedPlugins.length,
  ranges.creation_plugins
);

const ioScore = AISConfigService.normalize(
  ioFieldCount,
  ranges.creation_io_fields
);

// Return 4 dimensions
return {
  workflow_structure: {
    score: this.clamp(workflowScore, 0, 10),
    weight: 0.5,
    weighted_score: this.clamp(workflowScore, 0, 10) * 0.5,
  },
  plugin_diversity: {
    score: this.clamp(pluginScore, 0, 10),
    weight: 0.3,
    weighted_score: this.clamp(pluginScore, 0, 10) * 0.3,
  },
  io_schema: {
    score: this.clamp(ioScore, 0, 10),
    weight: 0.2,
    weighted_score: this.clamp(ioScore, 0, 10) * 0.2,
  },
  trigger_type: {
    score: triggerBonus,
    weight: 0.0, // Bonus only
    weighted_score: 0,
  },
};
```

**Changes to trackCreationCosts() (lines 68-147):**

```typescript
// AFTER calculating creation components...
const creation_score = this.calculateCreationOverallScore(creationComponents);

// NEW: Calculate combined score immediately
const execution_score_default = 5.0;
const combined_score = (creation_score * COMBINED_WEIGHTS.CREATION) +
                       (execution_score_default * COMBINED_WEIGHTS.EXECUTION);

// Update database
const { data, error } = await supabaseClient
  .from('agent_intensity_metrics')
  .update({
    creation_tokens_used: creationData.tokens_used,
    total_creation_cost_usd: creation_cost_usd,

    // Three scores
    creation_score,
    execution_score: execution_score_default,
    combined_score, // ✅ CALCULATED, not default

    // Four creation dimensions
    creation_workflow_score: creationComponents.workflow_structure.score,
    creation_plugin_score: creationComponents.plugin_diversity.score,
    creation_io_score: creationComponents.io_schema.score,
    creation_trigger_score: creationComponents.trigger_type.score,

    // OLD (keep for backward compatibility during migration)
    creation_complexity_score: creation_score,
    creation_token_efficiency_score: creation_score,

    updated_at: new Date().toISOString(),
  })
  .eq('agent_id', creationData.agent_id)
  .select()
  .single();
```

**Changes to calculateComponentScores() (lines 551-610):**

```typescript
// BEFORE (hardcoded):
const tokenVolumeScore = this.normalizeToScale(metrics.avg_tokens_per_run || 0, 0, 5000, 0, 10);
const tokenPeakScore = this.normalizeToScale(metrics.peak_tokens_single_run || 0, 0, 10000, 0, 10);
// ... etc

// AFTER (database-driven):
private static async calculateComponentScores(
  metrics: Partial<AgentIntensityMetrics>,
  ranges: AISRanges  // NEW: Pass ranges
): Promise<IntensityComponentScores> {
  // TOKEN COMPLEXITY (35% weight)
  const tokenVolumeScore = AISConfigService.normalize(
    metrics.avg_tokens_per_run || 0,
    ranges.token_volume
  );
  const tokenPeakScore = AISConfigService.normalize(
    metrics.peak_tokens_single_run || 0,
    ranges.token_peak
  );
  const tokenEfficiencyScore = this.normalizeToScale(
    metrics.input_output_ratio || 1.0,
    ranges.token_io_ratio_min,
    ranges.token_io_ratio_max,
    10,
    0
  );
  const token_complexity_score = (
    tokenVolumeScore * 0.5 +
    tokenPeakScore * 0.3 +
    tokenEfficiencyScore * 0.2
  );

  // EXECUTION COMPLEXITY (25% weight)
  const iterationScore = AISConfigService.normalize(
    metrics.avg_iterations_per_run || 1,
    ranges.iterations
  );
  const durationScore = AISConfigService.normalize(
    metrics.avg_execution_duration_ms || 0,
    ranges.duration_ms
  );
  const failureRateScore = AISConfigService.normalize(
    100 - (metrics.success_rate || 100),
    ranges.failure_rate
  );
  const retryScore = AISConfigService.normalize(
    metrics.retry_rate || 0,
    ranges.retry_rate
  );
  const execution_complexity_score = (
    iterationScore * 0.35 +
    durationScore * 0.30 +
    failureRateScore * 0.20 +
    retryScore * 0.15
  );

  // PLUGIN COMPLEXITY (25% weight)
  const pluginCountScore = AISConfigService.normalize(
    metrics.unique_plugins_used || 0,
    ranges.plugin_count
  );
  const pluginFrequencyScore = AISConfigService.normalize(
    metrics.avg_plugins_per_run || 0,
    ranges.plugins_per_run
  );
  const orchestrationScore = AISConfigService.normalize(
    metrics.tool_orchestration_overhead_ms || 0,
    ranges.orchestration_overhead_ms
  );
  const plugin_complexity_score = (
    pluginCountScore * 0.4 +
    pluginFrequencyScore * 0.35 +
    orchestrationScore * 0.25
  );

  // WORKFLOW COMPLEXITY (15% weight)
  const stepsScore = AISConfigService.normalize(
    metrics.workflow_steps_count || 0,
    ranges.workflow_steps
  );
  const branchScore = AISConfigService.normalize(
    metrics.conditional_branches_count || 0,
    ranges.branches
  );
  const loopScore = AISConfigService.normalize(
    metrics.loop_iterations_count || 0,
    ranges.loops
  );
  const parallelScore = AISConfigService.normalize(
    metrics.parallel_execution_count || 0,
    ranges.parallel
  );
  const workflow_complexity_score = (
    stepsScore * 0.4 +
    branchScore * 0.25 +
    loopScore * 0.20 +
    parallelScore * 0.15
  );

  return {
    token_complexity: {
      score: this.clamp(token_complexity_score, 0, 10),
      weight: EXECUTION_WEIGHTS.TOKEN_COMPLEXITY,
      weighted_score: this.clamp(token_complexity_score, 0, 10) * EXECUTION_WEIGHTS.TOKEN_COMPLEXITY,
    },
    execution_complexity: {
      score: this.clamp(execution_complexity_score, 0, 10),
      weight: EXECUTION_WEIGHTS.EXECUTION_COMPLEXITY,
      weighted_score: this.clamp(execution_complexity_score, 0, 10) * EXECUTION_WEIGHTS.EXECUTION_COMPLEXITY,
    },
    plugin_complexity: {
      score: this.clamp(plugin_complexity_score, 0, 10),
      weight: EXECUTION_WEIGHTS.PLUGIN_COMPLEXITY,
      weighted_score: this.clamp(plugin_complexity_score, 0, 10) * EXECUTION_WEIGHTS.PLUGIN_COMPLEXITY,
    },
    workflow_complexity: {
      score: this.clamp(workflow_complexity_score, 0, 10),
      weight: EXECUTION_WEIGHTS.WORKFLOW_COMPLEXITY,
      weighted_score: this.clamp(workflow_complexity_score, 0, 10) * EXECUTION_WEIGHTS.WORKFLOW_COMPLEXITY,
    },
  };
}
```

**Update updateMetricsFromExecution() (line 152-206):**

```typescript
// Fetch ranges
const ranges = await AISConfigService.getRanges(supabaseClient);

// 3. Calculate new component scores (pass ranges)
const componentScores = await this.calculateComponentScores(updated, ranges);
```

---

### PHASE 3: Update Execution Path (45 minutes)

#### Step 3.1: Update updateAgentIntensity.ts
**File:** `lib/utils/updateAgentIntensity.ts`

**Replace getAISRanges() and getDefaultRanges() (lines 232-277):**

```typescript
// DELETE these functions entirely, use AISConfigService instead

import { AISConfigService } from '@/lib/services/AISConfigService';

// In updateExistingMetrics(), replace line 135:
// OLD:
const ranges = await getAISRanges(supabase);

// NEW:
const aisRanges = await AISConfigService.getRanges(supabase);

// Update all calculation functions to use AISConfigService.normalize():

async function calculateTokenComplexity(
  avgTokens: number,
  peakTokens: number,
  ioRatio: number,
  ranges: AISRanges  // Use typed ranges from AISConfigService
): Promise<number> {
  const tokenVolumeScore = AISConfigService.normalize(avgTokens, ranges.token_volume);
  const tokenPeakScore = AISConfigService.normalize(peakTokens, ranges.token_peak);
  const tokenEfficiencyScore = normalizeToScale(ioRatio, ranges.token_io_ratio_min, ranges.token_io_ratio_max, 10, 0);
  return clamp(tokenVolumeScore * 0.5 + tokenPeakScore * 0.3 + tokenEfficiencyScore * 0.2, 0, 10);
}

async function calculateExecutionComplexity(
  avgIterations: number,
  avgDuration: number,
  successRate: number,
  retryRate: number,
  ranges: AISRanges
): Promise<number> {
  const iterationScore = AISConfigService.normalize(avgIterations, ranges.iterations);
  const durationScore = AISConfigService.normalize(avgDuration, ranges.duration_ms);
  const failureRateScore = AISConfigService.normalize(100 - successRate, ranges.failure_rate);
  const retryScore = AISConfigService.normalize(retryRate, ranges.retry_rate);
  return clamp(iterationScore * 0.35 + durationScore * 0.30 + failureRateScore * 0.20 + retryScore * 0.15, 0, 10);
}

async function calculatePluginComplexity(
  uniquePlugins: number,
  avgPluginsPerRun: number,
  orchestrationOverhead: number,
  ranges: AISRanges
): Promise<number> {
  const pluginCountScore = AISConfigService.normalize(uniquePlugins, ranges.plugin_count);
  const pluginFrequencyScore = AISConfigService.normalize(avgPluginsPerRun, ranges.plugins_per_run);
  const orchestrationScore = AISConfigService.normalize(orchestrationOverhead, ranges.orchestration_overhead_ms);
  return clamp(pluginCountScore * 0.4 + pluginFrequencyScore * 0.35 + orchestrationScore * 0.25, 0, 10);
}

async function calculateWorkflowComplexity(
  steps: number,
  branches: number,
  loops: number,
  parallel: number,
  ranges: AISRanges
): Promise<number> {
  const stepsScore = AISConfigService.normalize(steps, ranges.workflow_steps);
  const branchScore = AISConfigService.normalize(branches, ranges.branches);
  const loopScore = AISConfigService.normalize(loops, ranges.loops);
  const parallelScore = AISConfigService.normalize(parallel, ranges.parallel);
  return clamp(stepsScore * 0.4 + branchScore * 0.25 + loopScore * 0.20 + parallelScore * 0.15, 0, 10);
}
```

**Update function calls (lines 138-141):**

```typescript
// Pass aisRanges to all calculation functions
const token_complexity_score = await calculateTokenComplexity(
  avg_tokens_per_run,
  peak_tokens_single_run,
  input_output_ratio,
  aisRanges
);
const execution_complexity_score = await calculateExecutionComplexity(
  avg_iterations_per_run,
  avg_execution_duration_ms,
  success_rate,
  retry_rate,
  aisRanges
);
const plugin_complexity_score = await calculatePluginComplexity(
  unique_plugins_used,
  avg_plugins_per_run,
  tool_orchestration_overhead_ms,
  aisRanges
);
const workflow_complexity_score = await calculateWorkflowComplexity(
  workflow_steps_count,
  conditional_branches_count,
  loop_iterations_count,
  parallel_execution_count,
  aisRanges
);
```

---

### PHASE 4: Update API Route (30 minutes)

#### Step 4.1: Update /agents/[id]/intensity Route
**File:** `app/api/agents/[id]/intensity/route.ts`

**Replace hardcoded calculations (lines 127-179):**

```typescript
import { AISConfigService } from '@/lib/services/AISConfigService';

function buildIntensityBreakdown(metrics: AgentIntensityMetrics, agent: any): IntensityBreakdown {
  // ... existing parsing code ...

  // Fetch ranges from AISConfigService
  const ranges = await AISConfigService.getRanges(supabase);

  // Use ranges for normalization (instead of hardcoded values)
  const workflowScore = AISConfigService.normalize(
    workflowSteps.length,
    ranges.creation_workflow_steps
  );

  const pluginScore = AISConfigService.normalize(
    connectedPlugins.length,
    ranges.creation_plugins
  );

  const ioScore = AISConfigService.normalize(
    ioFieldCount,
    ranges.creation_io_fields
  );

  // ... rest of function ...
}
```

**Make function async:**
```typescript
// BEFORE:
function buildIntensityBreakdown(metrics: AgentIntensityMetrics, agent: any): IntensityBreakdown {

// AFTER:
async function buildIntensityBreakdown(
  metrics: AgentIntensityMetrics,
  agent: any,
  supabase: SupabaseClient
): Promise<IntensityBreakdown> {
```

**Update callers:**
```typescript
// Line 90:
return NextResponse.json(await buildIntensityBreakdown(newMetrics as AgentIntensityMetrics, agent, supabase));

// Line 94:
const breakdown = await buildIntensityBreakdown(metrics as AgentIntensityMetrics, agent, supabase);
```

---

### PHASE 5: Validation & Testing (1 hour)

#### Step 5.1: Create Validation Script
**File:** `scripts/validate-ais-core.ts`

```typescript
import { supabase } from '@/lib/supabaseClient';
import { AISConfigService } from '@/lib/services/AISConfigService';

async function validateAISCore() {
  console.log('🔍 VALIDATING AIS CORE SYSTEM\n');

  let issues = 0;

  // ===== TEST 1: Verify ranges are loaded from database =====
  console.log('TEST 1: Verifying ranges load from database...');
  const ranges = await AISConfigService.getRanges(supabase);

  const requiredKeys = [
    'token_volume', 'token_peak', 'iterations', 'duration_ms',
    'plugin_count', 'plugins_per_run', 'workflow_steps',
    'creation_workflow_steps', 'creation_plugins', 'creation_io_fields'
  ];

  for (const key of requiredKeys) {
    if (!ranges[key as keyof typeof ranges]) {
      console.error(`❌ Missing range: ${key}`);
      issues++;
    }
  }

  if (issues === 0) {
    console.log('✅ All required ranges loaded\n');
  }

  // ===== TEST 2: Verify creation dimensions are stored =====
  console.log('TEST 2: Verifying creation dimensions are stored...');
  const { data: metrics, error } = await supabase
    .from('agent_intensity_metrics')
    .select('agent_id, creation_workflow_score, creation_plugin_score, creation_io_score, creation_trigger_score, creation_score')
    .not('creation_score', 'is', null)
    .limit(5);

  if (error) {
    console.error('❌ Error fetching metrics:', error);
    issues++;
  } else if (!metrics || metrics.length === 0) {
    console.warn('⚠️ No agents with creation scores found');
  } else {
    let dimensionIssues = 0;
    for (const m of metrics) {
      // Check if dimensions exist
      if (m.creation_workflow_score === null ||
          m.creation_plugin_score === null ||
          m.creation_io_score === null) {
        console.error(`❌ Agent ${m.agent_id}: Missing dimension scores`);
        dimensionIssues++;
      } else {
        // Check if dimensions sum to creation_score (within tolerance)
        const calculated = (
          m.creation_workflow_score * 0.5 +
          m.creation_plugin_score * 0.3 +
          m.creation_io_score * 0.2 +
          (m.creation_trigger_score || 0)
        );

        if (Math.abs(calculated - m.creation_score) > 0.5) {
          console.error(`❌ Agent ${m.agent_id}: Dimension sum mismatch (${calculated.toFixed(2)} vs ${m.creation_score})`);
          dimensionIssues++;
        }
      }
    }

    if (dimensionIssues === 0) {
      console.log('✅ All creation dimensions properly stored\n');
    } else {
      issues += dimensionIssues;
    }
  }

  // ===== TEST 3: Verify combined scores are calculated =====
  console.log('TEST 3: Verifying combined scores...');
  const { data: scoreData } = await supabase
    .from('agent_intensity_metrics')
    .select('agent_id, creation_score, execution_score, combined_score')
    .limit(10);

  let scoreIssues = 0;
  for (const record of scoreData || []) {
    const expected = (record.creation_score * 0.3) + (record.execution_score * 0.7);
    const actual = record.combined_score;

    if (Math.abs(expected - actual) > 0.1) {
      console.error(`❌ Agent ${record.agent_id}: Combined score mismatch (expected: ${expected.toFixed(2)}, actual: ${actual})`);
      scoreIssues++;
    }
  }

  if (scoreIssues === 0) {
    console.log('✅ All combined scores correctly calculated\n');
  } else {
    issues += scoreIssues;
  }

  // ===== TEST 4: Verify no hardcoded values in code =====
  console.log('TEST 4: Code should use AISConfigService (manual verification required)');
  console.log('   - Check: AgentIntensityService uses AISConfigService.normalize()');
  console.log('   - Check: updateAgentIntensity.ts uses AISConfigService');
  console.log('   - Check: /agents/[id]/intensity route uses AISConfigService');
  console.log('   ⚠️ MANUAL VERIFICATION REQUIRED\n');

  // ===== TEST 5: Test normalization consistency =====
  console.log('TEST 5: Testing normalization consistency...');

  // Test same value normalized with same range should give same result
  const testValue = 5;
  const testRange = { min: 0, max: 10 };

  const result1 = AISConfigService.normalize(testValue, testRange);
  const result2 = AISConfigService.normalize(testValue, testRange);

  if (Math.abs(result1 - result2) > 0.001) {
    console.error(`❌ Normalization inconsistent: ${result1} vs ${result2}`);
    issues++;
  } else {
    console.log('✅ Normalization is consistent\n');
  }

  // ===== SUMMARY =====
  console.log('='.repeat(50));
  if (issues === 0) {
    console.log('✅ AIS CORE VALIDATION PASSED');
    console.log('All automated tests successful');
  } else {
    console.error(`❌ VALIDATION FAILED: ${issues} issues found`);
  }
  console.log('='.repeat(50));

  process.exit(issues > 0 ? 1 : 0);
}

validateAISCore();
```

Run with: `npx ts-node scripts/validate-ais-core.ts`

#### Step 5.2: Create Backfill Script
**File:** `scripts/backfill-creation-dimensions.ts`

```typescript
import { supabase } from '@/lib/supabaseClient';
import { AgentIntensityService } from '@/lib/services/AgentIntensityService';

async function backfillCreationDimensions() {
  console.log('🔄 BACKFILLING CREATION DIMENSIONS\n');

  // Get all agents with intensity metrics
  const { data: agents, error } = await supabase
    .from('agent_intensity_metrics')
    .select('agent_id');

  if (error || !agents) {
    console.error('❌ Failed to fetch agents:', error);
    process.exit(1);
  }

  console.log(`Found ${agents.length} agents to update\n`);

  let updated = 0;
  let failed = 0;

  for (const record of agents) {
    try {
      // Recalculate creation scores from agent design
      // Note: We need to make calculateCreationScores public or create a wrapper
      const { data: agent } = await supabase
        .from('agents')
        .select('workflow_steps, input_schema, output_schema, connected_plugins, trigger_conditions')
        .eq('id', record.agent_id)
        .single();

      if (!agent) {
        console.warn(`⚠️ Agent ${record.agent_id} not found, skipping`);
        continue;
      }

      // Parse agent data (handle both string and object from Supabase)
      const workflowSteps = typeof agent.workflow_steps === 'string'
        ? JSON.parse(agent.workflow_steps)
        : (agent.workflow_steps || []);
      const connectedPlugins = typeof agent.connected_plugins === 'string'
        ? JSON.parse(agent.connected_plugins)
        : (agent.connected_plugins || []);
      const inputSchema = typeof agent.input_schema === 'string'
        ? JSON.parse(agent.input_schema)
        : (agent.input_schema || []);
      const outputSchema = typeof agent.output_schema === 'string'
        ? JSON.parse(agent.output_schema)
        : (agent.output_schema || []);
      const triggerConditions = typeof agent.trigger_conditions === 'string'
        ? JSON.parse(agent.trigger_conditions)
        : (agent.trigger_conditions || {});

      // Calculate scores using same logic as AgentIntensityService
      const ranges = await AISConfigService.getRanges(supabase);

      const workflowScore = AISConfigService.normalize(workflowSteps.length, ranges.creation_workflow_steps);
      const pluginScore = AISConfigService.normalize(connectedPlugins.length, ranges.creation_plugins);
      const ioFieldCount = inputSchema.length + outputSchema.length;
      const ioScore = AISConfigService.normalize(ioFieldCount, ranges.creation_io_fields);

      let triggerBonus = 0;
      if (triggerConditions.schedule_cron) triggerBonus = 1;
      if (triggerConditions.event_triggers && triggerConditions.event_triggers.length > 0) triggerBonus = 2;

      const baseComplexity = (workflowScore * 0.5 + pluginScore * 0.3 + ioScore * 0.2);
      const creation_score = Math.min(10, baseComplexity + triggerBonus);

      // Get current execution score
      const { data: current } = await supabase
        .from('agent_intensity_metrics')
        .select('execution_score')
        .eq('agent_id', record.agent_id)
        .single();

      const execution_score = current?.execution_score ?? 5.0;
      const combined_score = (creation_score * 0.3) + (execution_score * 0.7);

      // Update database
      const { error: updateError } = await supabase
        .from('agent_intensity_metrics')
        .update({
          creation_workflow_score: workflowScore,
          creation_plugin_score: pluginScore,
          creation_io_score: ioScore,
          creation_trigger_score: triggerBonus,
          creation_score,
          combined_score,
        })
        .eq('agent_id', record.agent_id);

      if (updateError) {
        console.error(`❌ Failed to update ${record.agent_id}:`, updateError.message);
        failed++;
      } else {
        console.log(`✅ Updated ${record.agent_id}: creation=${creation_score.toFixed(2)}, combined=${combined_score.toFixed(2)}`);
        updated++;
      }
    } catch (err) {
      console.error(`❌ Error processing ${record.agent_id}:`, err);
      failed++;
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Updated: ${updated} agents`);
  if (failed > 0) {
    console.error(`❌ Failed: ${failed} agents`);
  }
  console.log('='.repeat(50));

  process.exit(failed > 0 ? 1 : 0);
}

backfillCreationDimensions();
```

---

## IMPLEMENTATION ORDER

1. **Create AISConfigService** (30 min)
   - Write service class
   - Add database migration for creation ranges
   - Test ranges load correctly

2. **Update AgentIntensityService** (45 min)
   - Import AISConfigService
   - Replace hardcoded values in calculateCreationScores()
   - Replace hardcoded values in calculateComponentScores()
   - Update trackCreationCosts() to calculate combined_score
   - Add storage of 4 creation dimensions

3. **Update updateAgentIntensity.ts** (30 min)
   - Import AISConfigService
   - Replace getAISRanges() and getDefaultRanges()
   - Update all calculation functions

4. **Update API Route** (20 min)
   - Import AISConfigService
   - Make buildIntensityBreakdown() async
   - Use AISConfigService for normalization

5. **Database Migration** (10 min)
   - Add 4 creation dimension columns
   - Add indices

6. **Run Backfill** (15 min)
   - Execute backfill script
   - Verify all agents updated

7. **Validation** (30 min)
   - Run validation script
   - Fix any issues found
   - Manual code review

---

## SUCCESS CRITERIA

✅ **Zero hardcoded ranges** - All use AISConfigService
✅ **Single source of truth** - All ranges from database
✅ **Creation score consistent** - Same calculation everywhere (4 dimensions)
✅ **Combined score calculated on creation** - No more default 5.0
✅ **4 dimensions stored** - workflow, plugin, io, trigger scores in DB
✅ **Validation passes** - All automated tests green
✅ **Backfill complete** - All existing agents have correct scores

---

## TESTING CHECKLIST

### Before Starting
- [ ] Current state documented
- [ ] Backup database (or use staging)
- [ ] All tests pass

### After Each Phase
- [ ] Code compiles without errors
- [ ] No TypeScript errors
- [ ] Console has no AIS-related warnings

### After Implementation
- [ ] Validation script passes 100%
- [ ] Backfill script completes successfully
- [ ] Create new agent → 4 dimensions stored
- [ ] Create new agent → combined_score calculated
- [ ] Execute agent → scores update correctly
- [ ] UI shows correct dimension breakdown
- [ ] No hardcoded values remain in code

---

## ROLLBACK PLAN

If anything goes wrong:

1. **Revert Code Changes:**
   ```bash
   git revert <commit-hash>
   git push
   ```

2. **Revert Database (if needed):**
   ```sql
   -- Drop new columns (only if causing issues)
   ALTER TABLE agent_intensity_metrics
   DROP COLUMN IF EXISTS creation_workflow_score,
   DROP COLUMN IF EXISTS creation_plugin_score,
   DROP COLUMN IF EXISTS creation_io_score,
   DROP COLUMN IF EXISTS creation_trigger_score;

   -- Ranges can stay (won't hurt anything)
   ```

3. **Old code will still work** because:
   - We kept old columns (creation_complexity_score, creation_token_efficiency_score)
   - AISConfigService has fallback ranges
   - Changes are backward compatible

---

**TOTAL TIME:** ~4 hours
**RISK LEVEL:** Low (backward compatible)
**IMPACT:** High (eliminates all hardcoding, ensures consistency)
