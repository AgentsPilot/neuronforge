# AIS System Fix Plan - Complete Overhaul

**Created:** 2025-01-29
**Priority:** CRITICAL
**Estimated Time:** 4-6 hours
**Goal:** Make AIS 100% reliable, eliminate all hardcoding, fix all inconsistencies

---

## EXECUTIVE SUMMARY

### Current State
✅ **AgentKit Path (use_agentkit=true):** Intensity tracking is working
❌ **Legacy Path:** No intensity tracking at all
❌ **Pricing Integration:** NOT CONNECTED - intensity scores don't affect user costs
❌ **Hardcoded Values:** Same ranges duplicated in 3 locations
❌ **Creation Score:** Calculated twice with different logic (2-component vs 4-dimension)

### Critical Finding from `/api/run-agent` Analysis

**LINE 221-261:** ✅ AgentKit DOES track intensity metrics correctly
```typescript
const executionData: AgentExecutionData = {
  agent_id: agent.id,
  user_id: user.id,
  tokens_used: result.tokensUsed.total,
  // ... all metrics captured ...
};
const updated = await updateAgentIntensityMetrics(supabase, executionData);
```

**LINE 663-665:** ❌ Legacy path does NOT track intensity
```typescript
// NOTE: Legacy execution path does not track intensity metrics
console.log('⚠️ Legacy execution path - intensity metrics not tracked');
```

**BIGGEST ISSUE:** Nowhere in the codebase is `CreditService.chargeForExecution()` called!
- The intensity multiplier is calculated ✅
- But it's NEVER applied to actual credit charges ❌
- Users are being charged base rate regardless of complexity ❌

---

## PHASE 1: VERIFY CURRENT STATE (30 minutes)

### Task 1.1: Check if Pricing Integration Exists Anywhere
```bash
# Search for any credit charging
grep -r "deductCredits\|chargeForExecution\|credits_delta" app/api lib --include="*.ts"

# Check if intensity is in credit transactions
# RUN THIS SQL:
SELECT
  COUNT(*) as total_transactions,
  COUNT(CASE WHEN metadata->>'intensity_score' IS NOT NULL THEN 1 END) as with_intensity,
  COUNT(CASE WHEN metadata->>'multiplier' IS NOT NULL THEN 1 END) as with_multiplier
FROM credit_transactions
WHERE created_at > NOW() - INTERVAL '30 days';
```

**Expected Result:** 0 transactions with intensity (confirms pricing not integrated)

### Task 1.2: Verify Which Execution Path Is Used
```sql
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN logs->>'agentkit' = 'true' THEN 1 END) as agentkit_count,
  COUNT(CASE WHEN logs->>'agentkit' IS NULL THEN 1 END) as legacy_count
FROM agent_executions
WHERE created_at > NOW() - INTERVAL '7 days';
```

**Action Based on Results:**
- If >90% AgentKit: Can deprecate legacy path
- If <90% AgentKit: Must add intensity tracking to legacy path too

---

## PHASE 2: ELIMINATE HARDCODED VALUES (2 hours)

### Task 2.1: Create Centralized AIS Configuration Service

**File:** `lib/services/AISConfigService.ts`

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AISRange {
  min: number;
  max: number;
}

export interface AISRanges {
  // Token metrics
  token_volume: AISRange;
  token_peak: AISRange;
  token_io_ratio_min: number;  // Single value
  token_io_ratio_max: number;  // Single value

  // Execution metrics
  iterations: AISRange;
  duration_ms: AISRange;
  failure_rate: AISRange;
  retry_rate: AISRange;

  // Plugin metrics
  plugin_count: AISRange;
  plugins_per_run: AISRange;
  orchestration_overhead_ms: AISRange;

  // Workflow metrics
  workflow_steps: AISRange;
  branches: AISRange;
  loops: AISRange;
  parallel: AISRange;

  // CREATION-SPECIFIC RANGES (NEW)
  creation_workflow_steps: AISRange;
  creation_plugins: AISRange;
  creation_io_fields: AISRange;
}

export interface AISConfig {
  ranges: AISRanges;
  pilot_credit_cost_usd: number;
  creation_weight: number;  // 0.3
  execution_weight: number; // 0.7
}

/**
 * Centralized AIS Configuration Service
 * Single source of truth for ALL AIS ranges and settings
 */
export class AISConfigService {
  private static cache: AISConfig | null = null;
  private static cacheTimestamp: number = 0;
  private static CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Get active AIS configuration (with caching)
   */
  static async getConfig(supabase: SupabaseClient): Promise<AISConfig> {
    const now = Date.now();

    // Return cached config if still valid
    if (this.cache && (now - this.cacheTimestamp) < this.CACHE_TTL_MS) {
      return this.cache;
    }

    try {
      // Fetch ranges from database
      const { data: rangesData, error: rangesError } = await supabase
        .rpc('get_active_ais_ranges');

      if (rangesError || !rangesData) {
        console.warn('⚠️ Failed to fetch AIS ranges, using fallback defaults');
        return this.getFallbackConfig();
      }

      // Convert array to typed ranges object
      const ranges = this.parseRanges(rangesData);

      // Fetch platform config
      const { data: configData } = await supabase
        .from('platform_pricing_config')
        .select('key, value')
        .in('key', ['pilot_credit_usd_cost', 'ais_creation_weight', 'ais_execution_weight']);

      const config: AISConfig = {
        ranges,
        pilot_credit_cost_usd: this.findConfigValue(configData, 'pilot_credit_usd_cost', 0.00048),
        creation_weight: this.findConfigValue(configData, 'ais_creation_weight', 0.3),
        execution_weight: this.findConfigValue(configData, 'ais_execution_weight', 0.7),
      };

      // Update cache
      this.cache = config;
      this.cacheTimestamp = now;

      return config;
    } catch (error) {
      console.error('Error fetching AIS config:', error);
      return this.getFallbackConfig();
    }
  }

  /**
   * Parse ranges from database result
   */
  private static parseRanges(data: any[]): AISRanges {
    const rangeMap: Record<string, { min: number; max: number }> = {};
    data.forEach((row: any) => {
      rangeMap[row.range_key] = {
        min: parseFloat(row.min_value),
        max: parseFloat(row.max_value)
      };
    });

    return {
      token_volume: rangeMap.token_volume,
      token_peak: rangeMap.token_peak,
      token_io_ratio_min: rangeMap.token_io_ratio_min?.min ?? 0.5,
      token_io_ratio_max: rangeMap.token_io_ratio_max?.min ?? 3.0,
      iterations: rangeMap.iterations,
      duration_ms: rangeMap.duration_ms,
      failure_rate: rangeMap.failure_rate,
      retry_rate: rangeMap.retry_rate,
      plugin_count: rangeMap.plugin_count,
      plugins_per_run: rangeMap.plugins_per_run,
      orchestration_overhead_ms: rangeMap.orchestration_overhead_ms,
      workflow_steps: rangeMap.workflow_steps,
      branches: rangeMap.branches,
      loops: rangeMap.loops,
      parallel: rangeMap.parallel,
      creation_workflow_steps: rangeMap.creation_workflow_steps ?? rangeMap.workflow_steps,
      creation_plugins: rangeMap.creation_plugins ?? rangeMap.plugin_count,
      creation_io_fields: rangeMap.creation_io_fields ?? { min: 1, max: 8 },
    };
  }

  /**
   * Find config value with fallback
   */
  private static findConfigValue(data: any[] | null, key: string, fallback: number): number {
    if (!data) return fallback;
    const found = data.find((row: any) => row.key === key);
    return found ? parseFloat(found.value) : fallback;
  }

  /**
   * Fallback configuration (used when database unavailable)
   */
  private static getFallbackConfig(): AISConfig {
    return {
      ranges: {
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
      },
      pilot_credit_cost_usd: 0.00048,
      creation_weight: 0.3,
      execution_weight: 0.7,
    };
  }

  /**
   * Normalize value to 0-10 scale using configured ranges
   */
  static normalize(
    value: number,
    range: AISRange,
    invert: boolean = false
  ): number {
    const clamped = Math.max(range.min, Math.min(range.max, value));
    const normalized = ((clamped - range.min) / (range.max - range.min)) * 10;
    return invert ? (10 - normalized) : normalized;
  }

  /**
   * Clear cache (for testing or after config updates)
   */
  static clearCache(): void {
    this.cache = null;
    this.cacheTimestamp = 0;
  }
}
```

### Task 2.2: Database Migration for Platform Config

**File:** `supabase/migrations/YYYYMMDD_create_platform_pricing_config.sql`

```sql
-- Create platform pricing configuration table
CREATE TABLE IF NOT EXISTS platform_pricing_config (
  key TEXT PRIMARY KEY,
  value DECIMAL(10,6) NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);

-- Insert default values
INSERT INTO platform_pricing_config (key, value, description, category) VALUES
('pilot_credit_usd_cost', 0.00048, 'Cost per pilot credit in USD', 'pricing'),
('ais_creation_weight', 0.3, 'Weight of creation score in combined score (0-1)', 'ais'),
('ais_execution_weight', 0.7, 'Weight of execution score in combined score (0-1)', 'ais')
ON CONFLICT (key) DO NOTHING;

-- Add creation-specific ranges to ais_normalization_ranges
INSERT INTO ais_normalization_ranges (range_key, best_practice_min, best_practice_max, dynamic_min, dynamic_max, description) VALUES
('creation_workflow_steps', 1, 10, 1, 10, 'Number of workflow steps in agent design'),
('creation_plugins', 1, 5, 1, 5, 'Number of plugins connected to agent'),
('creation_io_fields', 1, 8, 1, 8, 'Total input + output fields in agent schema')
ON CONFLICT (range_key) DO NOTHING;

-- Add index
CREATE INDEX IF NOT EXISTS idx_platform_pricing_config_category ON platform_pricing_config(category);

-- Add RLS policies
ALTER TABLE platform_pricing_config ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY "Allow authenticated users to read pricing config"
ON platform_pricing_config FOR SELECT
TO authenticated
USING (true);

-- Only admins can update (you'll need to add admin role check)
CREATE POLICY "Only admins can update pricing config"
ON platform_pricing_config FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);
```

### Task 2.3: Update AgentIntensityService to Use Centralized Config

**File:** `lib/services/AgentIntensityService.ts`

**Changes:**
1. Import AISConfigService
2. Remove ALL hardcoded ranges (lines 556-586)
3. Use `AISConfigService.getConfig()` instead

```typescript
// BEFORE (hardcoded):
const tokenVolumeScore = this.normalizeToScale(metrics.avg_tokens_per_run || 0, 0, 5000, 0, 10);

// AFTER (database-driven):
const config = await AISConfigService.getConfig(supabaseClient);
const tokenVolumeScore = AISConfigService.normalize(
  metrics.avg_tokens_per_run || 0,
  config.ranges.token_volume
);
```

**Lines to Update:**
- 87: `const PILOT_CREDIT_COST = config.pilot_credit_cost_usd;`
- 489: Use `config.ranges.creation_workflow_steps`
- 495: Use `config.ranges.creation_plugins`
- 502: Use `config.ranges.creation_io_fields`
- 556-586: Replace ALL hardcoded normalizeToScale calls

### Task 2.4: Update updateAgentIntensity.ts

**File:** `lib/utils/updateAgentIntensity.ts`

**Changes:**
1. Replace `getDefaultRanges()` with `AISConfigService.getConfig()`
2. Update `getAISRanges()` to use config service
3. Remove hardcoded ranges (lines 259-277)

```typescript
// BEFORE:
function getDefaultRanges(): Record<string, { min: number; max: number }> {
  return {
    token_volume: { min: 0, max: 5000 }, // HARDCODED
    // ...
  };
}

// AFTER:
async function getDefaultRanges(supabase: SupabaseClient): Promise<AISRanges> {
  const config = await AISConfigService.getConfig(supabase);
  return config.ranges;
}
```

### Task 2.5: Update API Route to Use Centralized Config

**File:** `app/api/agents/[id]/intensity/route.ts`

**Changes:**
- Lines 134-137: Replace hardcoded ranges
- Use `AISConfigService` for all normalization

---

## PHASE 3: FIX CREATION SCORE INCONSISTENCY (1 hour)

### Issue
Creation score is calculated in TWO places with DIFFERENT logic:
1. **AgentIntensityService** (during creation): Returns 2 components (both same value)
2. **API route** (for UI): Recalculates as 4 dimensions

### Solution: Unify to 4-Dimension System

### Task 3.1: Update Database Schema

```sql
-- Add 4 new columns for creation dimensions
ALTER TABLE agent_intensity_metrics
ADD COLUMN IF NOT EXISTS creation_workflow_score DECIMAL(5,2) DEFAULT 5.0,
ADD COLUMN IF NOT EXISTS creation_plugin_score DECIMAL(5,2) DEFAULT 5.0,
ADD COLUMN IF NOT EXISTS creation_io_score DECIMAL(5,2) DEFAULT 5.0,
ADD COLUMN IF NOT EXISTS creation_trigger_score DECIMAL(5,2) DEFAULT 0.0;

-- Drop old columns (after data migration)
-- ALTER TABLE agent_intensity_metrics
-- DROP COLUMN IF EXISTS creation_complexity_score,
-- DROP COLUMN IF EXISTS creation_token_efficiency_score;
```

### Task 3.2: Update AgentIntensityService.calculateCreationScores()

**File:** `lib/services/AgentIntensityService.ts` (lines 444-535)

**Change return type:**
```typescript
// OLD:
return {
  creation_complexity: { score: 2.15, weight: 0.5 },
  creation_efficiency: { score: 2.15, weight: 0.5 } // DUPLICATE!
};

// NEW:
return {
  workflow_structure: { score: workflowScore, weight: 0.5 },
  plugin_diversity: { score: pluginScore, weight: 0.3 },
  io_schema: { score: ioScore, weight: 0.2 },
  trigger_type: { score: triggerBonus, weight: 0.0 }
};
```

### Task 3.3: Store Individual Dimension Scores

**Update line 103-115:**
```typescript
const { data, error } = await supabaseClient
  .from('agent_intensity_metrics')
  .update({
    creation_tokens_used: creationData.tokens_used,
    total_creation_cost_usd: creation_cost_usd,
    creation_score,
    // NEW: Store all 4 dimensions
    creation_workflow_score: creationComponents.workflow_structure.score,
    creation_plugin_score: creationComponents.plugin_diversity.score,
    creation_io_score: creationComponents.io_schema.score,
    creation_trigger_score: creationComponents.trigger_type.score,
    // Calculate combined score immediately
    combined_score: (creation_score * 0.3) + (5.0 * 0.7),
    updated_at: new Date().toISOString(),
  })
```

### Task 3.4: Update Type Definitions

**File:** `lib/types/intensity.ts` (lines 141-162)

Already updated in previous session ✅

---

## PHASE 4: FIX COMBINED SCORE ON CREATION (15 minutes)

### Issue
When agent is created, `combined_score` defaults to 5.0 instead of being calculated from creation_score.

### Fix: Calculate Immediately

**File:** `lib/services/AgentIntensityService.ts` (line 103-115)

```typescript
// Calculate combined score using creation score + default execution score
const execution_score_default = 5.0;
const combined_score = (creation_score * 0.3) + (execution_score_default * 0.7);

const { data, error } = await supabaseClient
  .from('agent_intensity_metrics')
  .update({
    creation_tokens_used: creationData.tokens_used,
    total_creation_cost_usd: creation_cost_usd,
    creation_score,
    creation_workflow_score: creationComponents.workflow_structure.score,
    creation_plugin_score: creationComponents.plugin_diversity.score,
    creation_io_score: creationComponents.io_schema.score,
    creation_trigger_score: creationComponents.trigger_type.score,
    execution_score: execution_score_default, // Set default
    combined_score, // ✅ CALCULATED, not default
    updated_at: new Date().toISOString(),
  })
```

---

## PHASE 5: ADD PRICING INTEGRATION (1 hour)

### Issue
`CreditService.chargeForExecution()` exists but is NEVER called.

### Task 5.1: Add Credit Charging to AgentKit Execution

**File:** `app/api/run-agent/route.ts`

**Add after line 261 (after intensity update):**

```typescript
// Track intensity metrics for dynamic pricing
try {
  console.log('📊 [INTENSITY] Starting update for agent:', agent.id);
  const executionData: AgentExecutionData = {
    // ... existing code ...
  };
  const updated = await updateAgentIntensityMetrics(supabase, executionData);
  console.log('✅ [INTENSITY] Update result:', updated ? 'SUCCESS' : 'FAILED');

  // NEW: CHARGE CREDITS BASED ON INTENSITY
  if (updated) {
    const { data: metrics } = await supabase
      .from('agent_intensity_metrics')
      .select('combined_score')
      .eq('agent_id', agent.id)
      .single();

    const intensityScore = metrics?.combined_score ?? 5.0;

    // Import CreditService at top of file
    const creditService = new CreditService(supabase);
    const { charged, newBalance } = await creditService.chargeForExecution(
      user.id,
      agent.id,
      result.tokensUsed.total,
      intensityScore
    );

    console.log(`💰 [PRICING] Charged ${charged} credits (intensity: ${intensityScore.toFixed(2)}, multiplier: ${(1 + intensityScore/10).toFixed(2)}x)`);
    console.log(`💰 [PRICING] New balance: ${newBalance} credits`);
  }
} catch (intensityError) {
  console.error('❌ Failed to update intensity metrics:', intensityError);
  // Non-fatal error - continue execution
}
```

### Task 5.2: Import CreditService

**File:** `app/api/run-agent/route.ts` (top)

```typescript
import { CreditService } from '@/lib/services/CreditService';
```

### Task 5.3: Add Credit Check Before Execution

**Add before line 79 (before runAgentKit):**

```typescript
// Check user has sufficient credits
const creditService = new CreditService(supabase);
const balance = await creditService.getBalance(user.id);

if (balance.balance <= 0) {
  return NextResponse.json({
    success: false,
    error: 'Insufficient credits',
    message: 'Your credit balance is depleted. Please add more credits to continue.',
    balance: balance.balance
  }, { status: 402 }); // 402 Payment Required
}

// Estimate cost (rough estimate before execution)
const { data: metrics } = await supabase
  .from('agent_intensity_metrics')
  .select('combined_score')
  .eq('agent_id', agent.id)
  .single();

const estimatedScore = metrics?.combined_score ?? 5.0;
const estimatedTokens = metrics?.avg_tokens_per_run ?? 3000;
const estimatedCost = Math.ceil(estimatedTokens / 10) * (1 + estimatedScore / 10);

if (balance.balance < estimatedCost) {
  console.warn(`⚠️ Low balance: ${balance.balance} credits, estimated cost: ${estimatedCost} credits`);
  // Allow execution but warn
}
```

---

## PHASE 6: ADD COMPREHENSIVE VALIDATION (30 minutes)

### Task 6.1: Create AIS Validation Script

**File:** `scripts/validate-ais-system.ts`

```typescript
import { supabase } from '@/lib/supabaseClient';

async function validateAISSystem() {
  console.log('🔍 VALIDATING AIS SYSTEM\n');

  let issues = 0;

  // 1. Check all ranges exist in database
  const requiredRanges = [
    'token_volume', 'token_peak', 'token_io_ratio_min', 'token_io_ratio_max',
    'iterations', 'duration_ms', 'failure_rate', 'retry_rate',
    'plugin_count', 'plugins_per_run', 'orchestration_overhead_ms',
    'workflow_steps', 'branches', 'loops', 'parallel',
    'creation_workflow_steps', 'creation_plugins', 'creation_io_fields'
  ];

  const { data: ranges } = await supabase.rpc('get_active_ais_ranges');
  const existingKeys = new Set(ranges?.map((r: any) => r.range_key) ?? []);

  for (const key of requiredRanges) {
    if (!existingKeys.has(key)) {
      console.error(`❌ Missing range: ${key}`);
      issues++;
    }
  }

  if (issues === 0) {
    console.log('✅ All required ranges exist');
  }

  // 2. Check agents have intensity metrics
  const { data: agents } = await supabase
    .from('agents')
    .select('id')
    .eq('status', 'active');

  const { data: metrics } = await supabase
    .from('agent_intensity_metrics')
    .select('agent_id');

  const metricsSet = new Set(metrics?.map(m => m.agent_id) ?? []);
  let missingMetrics = 0;

  for (const agent of agents ?? []) {
    if (!metricsSet.has(agent.id)) {
      console.error(`❌ Agent ${agent.id} missing intensity metrics`);
      missingMetrics++;
    }
  }

  if (missingMetrics === 0) {
    console.log('✅ All active agents have intensity metrics');
  } else {
    console.error(`❌ ${missingMetrics} agents missing metrics`);
    issues += missingMetrics;
  }

  // 3. Check combined scores are calculated
  const { data: invalidScores } = await supabase
    .from('agent_intensity_metrics')
    .select('agent_id, creation_score, execution_score, combined_score')
    .neq('creation_score', 5.0); // Non-default creation score

  let invalidCombined = 0;
  for (const record of invalidScores ?? []) {
    const expected = (record.creation_score * 0.3) + (record.execution_score * 0.7);
    const actual = record.combined_score;

    if (Math.abs(expected - actual) > 0.1) {
      console.error(`❌ Agent ${record.agent_id}: combined_score mismatch (expected: ${expected.toFixed(2)}, actual: ${actual})`);
      invalidCombined++;
    }
  }

  if (invalidCombined === 0) {
    console.log('✅ All combined scores correctly calculated');
  } else {
    issues += invalidCombined;
  }

  // 4. Check pricing integration
  const { data: recentCharges } = await supabase
    .from('credit_transactions')
    .select('metadata')
    .eq('activity_type', 'agent_execution')
    .order('created_at', { ascending: false })
    .limit(10);

  let chargesWithIntensity = 0;
  for (const charge of recentCharges ?? []) {
    if (charge.metadata?.intensity_score !== undefined) {
      chargesWithIntensity++;
    }
  }

  if (chargesWithIntensity === 0) {
    console.error('❌ No recent charges include intensity metadata (pricing not integrated!)');
    issues++;
  } else {
    console.log(`✅ ${chargesWithIntensity}/10 recent charges include intensity`);
  }

  // Summary
  console.log(`\n${'='.repeat(50)}`);
  if (issues === 0) {
    console.log('✅ AIS SYSTEM FULLY VALIDATED');
  } else {
    console.error(`❌ VALIDATION FAILED: ${issues} issues found`);
  }

  process.exit(issues > 0 ? 1 : 0);
}

validateAISSystem();
```

---

## PHASE 7: BACKFILL FIXES (30 minutes)

### Task 7.1: Backfill Combined Scores

**File:** `scripts/backfill-combined-scores.ts`

```typescript
import { supabase } from '@/lib/supabaseClient';

async function backfillCombinedScores() {
  const { data: metrics } = await supabase
    .from('agent_intensity_metrics')
    .select('agent_id, creation_score, execution_score');

  for (const record of metrics ?? []) {
    const combined_score = (record.creation_score * 0.3) + (record.execution_score * 0.7);

    await supabase
      .from('agent_intensity_metrics')
      .update({ combined_score })
      .eq('agent_id', record.agent_id);

    console.log(`✅ Updated ${record.agent_id}: ${combined_score.toFixed(2)}`);
  }

  console.log(`✅ Backfilled ${metrics?.length} agents`);
}

backfillCombinedScores();
```

### Task 7.2: Backfill Creation Dimension Scores

**File:** `scripts/backfill-creation-dimensions.ts`

```typescript
import { supabase } from '@/lib/supabaseClient';
import { AgentIntensityService } from '@/lib/services/AgentIntensityService';

async function backfillCreationDimensions() {
  const { data: agents } = await supabase
    .from('agent_intensity_metrics')
    .select('agent_id');

  for (const record of agents ?? []) {
    // Recalculate creation scores using new 4-dimension system
    const components = await AgentIntensityService['calculateCreationScores'](
      supabase,
      record.agent_id
    );

    await supabase
      .from('agent_intensity_metrics')
      .update({
        creation_workflow_score: components.workflow_structure.score,
        creation_plugin_score: components.plugin_diversity.score,
        creation_io_score: components.io_schema.score,
        creation_trigger_score: components.trigger_type.score,
      })
      .eq('agent_id', record.agent_id);

    console.log(`✅ Updated ${record.agent_id}`);
  }
}

backfillCreationDimensions();
```

---

## TESTING CHECKLIST

### Unit Tests
- [ ] AISConfigService.getConfig() returns valid config
- [ ] AISConfigService.normalize() produces 0-10 scores
- [ ] Creation score components sum to creation_score
- [ ] Combined score = (creation × 0.3) + (execution × 0.7)
- [ ] Multiplier = 1.0 + (score / 10)

### Integration Tests
- [ ] Create new agent → creation_score calculated
- [ ] Create new agent → combined_score = (creation × 0.3) + 3.5
- [ ] Execute agent → execution_score updated
- [ ] Execute agent → combined_score recalculated
- [ ] Execute agent → credits charged with multiplier
- [ ] Check credit_transactions has intensity metadata

### End-to-End Tests
- [ ] Simple agent (3 steps, 1 plugin) → score ~2-3
- [ ] Complex agent (10 steps, 5 plugins) → score ~7-8
- [ ] Simple agent costs ~1.2x base rate
- [ ] Complex agent costs ~1.7x base rate
- [ ] Admin can update ranges
- [ ] Range updates affect new calculations

---

## ROLLOUT PLAN

### Stage 1: Preparation (No User Impact)
1. Create AISConfigService
2. Add database migration
3. Run validation script
4. Fix any issues found

### Stage 2: Backend Updates (No User Impact)
1. Update AgentIntensityService
2. Update updateAgentIntensity.ts
3. Update API route
4. Deploy to staging
5. Run validation again

### Stage 3: Backfill Data (Read-Only)
1. Run backfill-combined-scores.ts
2. Run backfill-creation-dimensions.ts
3. Validate all scores are correct

### Stage 4: Enable Pricing (USER IMPACT)
1. Add credit charging to run-agent
2. Deploy to production
3. Monitor first 100 executions
4. Verify charges are correct
5. Communicate to users

### Stage 5: Cleanup (Optional)
1. Remove old columns (creation_complexity_score, creation_token_efficiency_score)
2. Deprecate legacy execution path
3. Update documentation

---

## SUCCESS CRITERIA

✅ Zero hardcoded ranges in code
✅ All ranges sourced from database
✅ Creation score calculated consistently (4 dimensions)
✅ Combined score calculated on creation
✅ Pricing multiplier applied to all executions
✅ Credit transactions include intensity metadata
✅ Validation script passes 100%
✅ Simple agents cost 1.1-1.3x base rate
✅ Complex agents cost 1.6-2.0x base rate

---

## ESTIMATED TIME BREAKDOWN

| Phase | Task | Time |
|-------|------|------|
| 1 | Verify current state | 30 min |
| 2 | Eliminate hardcoded values | 2 hours |
| 3 | Fix creation score | 1 hour |
| 4 | Fix combined score | 15 min |
| 5 | Add pricing integration | 1 hour |
| 6 | Add validation | 30 min |
| 7 | Backfill data | 30 min |
| **TOTAL** | | **5.75 hours** |

---

## RISKS & MITIGATION

### Risk: Pricing changes affect users unexpectedly
**Mitigation:**
- Stage 4 is clearly marked as USER IMPACT
- Monitor first 100 executions
- Can revert pricing integration while keeping AIS improvements

### Risk: Database migration fails
**Mitigation:**
- Test migration on staging first
- Have rollback script ready
- Platform config has ON CONFLICT DO NOTHING

### Risk: Old agents have incorrect scores
**Mitigation:**
- Backfill scripts recalculate from source data
- Validation script catches mismatches
- Can re-run backfill if needed

---

## POST-DEPLOYMENT MONITORING

### Day 1:
- Check validation script every hour
- Monitor credit_transactions for intensity metadata
- Check error logs for AIS-related issues

### Week 1:
- Analyze score distribution (should be bell curve)
- Verify complex agents cost more than simple
- Gather user feedback on pricing

### Month 1:
- Review dynamic ranges (may need adjustment)
- Check if any agents consistently score 10/10 (range too low)
- Optimize cache TTL if needed

---

**STATUS:** Ready to implement
**NEXT STEP:** Run Phase 1 validation queries
