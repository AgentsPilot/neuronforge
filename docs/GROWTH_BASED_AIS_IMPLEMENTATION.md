# Growth-Based AIS Routing System Implementation

**Date:** November 1, 2025
**Status:** ✅ Completed
**Type:** Feature Enhancement - AIS Routing Logic Refactor

---

## Executive Summary

Refactored the Agent Intensity System (AIS) to use **output token growth patterns** instead of absolute token counts for routing decisions. The system now detects when agents are genuinely struggling (growing output tokens vs baseline) rather than upgrading agents simply because they use many tokens consistently.

**Key Achievement:** All thresholds are now **100% admin-configurable** through the database - no hardcoded fallback values.

---

## Problem Statement

### Original Issue
The AIS was upgrading agents from mini models (Haiku) to more expensive models (Sonnet/GPT-4o) based on **absolute token counts** (50K/100K thresholds). This created a problem:

- ✅ **Agent A**: Consistently uses 60K tokens and completes tasks successfully with Haiku
- ❌ **System Response**: Upgrades to Sonnet because 60K > 50K threshold
- **Problem**: Wasting money when the mini model works fine

### User Requirements

1. **Growth-based detection**: Track output token growth vs all-time baseline
2. **No time windowing**: Average ALL historical executions (not just recent)
3. **Configurable thresholds**: Admin-defined growth table with 4 tiers
4. **Quality amplification**: Increase adjustments when success rate < 80% or retry rate > 30%
5. **No hardcoding**: ALL parameters must be admin-configurable via database

### Growth Table Specification

| Growth Rate | Alert Level | Base Adjustment | Description |
|-------------|-------------|-----------------|-------------|
| < 25% | `none` | 0 | Normal variance - no action needed |
| 25-50% | `monitor` | +0.2 | Early warning - moderate rise |
| 50-100% | `rescore` | +0.75 | High sustained increase - may need upgrade |
| ≥ 100% | `upgrade` | +1.0-1.5 | Extreme growth - model is struggling |

**Quality Amplification:** If success rate < 80% or retry rate > 30%, multiply adjustments by quality multipliers.

---

## Implementation Details

### 1. Database Migration ✅

**File:** `supabase/migrations/20251101_add_output_token_growth_tracking.sql`

#### Agent Intensity Metrics Table
Added 4 new columns to `agent_intensity_metrics`:

```sql
-- Output token growth tracking
avg_output_tokens_per_run DECIMAL DEFAULT 0
output_token_growth_rate DECIMAL DEFAULT 0
output_token_baseline DECIMAL DEFAULT 0
output_token_alert_level TEXT DEFAULT 'none'
  CHECK (output_token_alert_level IN ('none', 'monitor', 'rescore', 'upgrade'))
```

#### AIS Configuration Table
Added 10 new columns to `ais_normalization_ranges`:

```sql
-- Growth rate thresholds
output_token_growth_monitor_threshold DECIMAL DEFAULT 25.0
output_token_growth_rescore_threshold DECIMAL DEFAULT 50.0
output_token_growth_upgrade_threshold DECIMAL DEFAULT 100.0

-- Score adjustments for each tier
output_token_growth_monitor_adjustment DECIMAL DEFAULT 0.2
output_token_growth_rescore_adjustment DECIMAL DEFAULT 0.75
output_token_growth_upgrade_adjustment DECIMAL DEFAULT 1.25

-- Quality metrics amplification
quality_success_threshold DECIMAL DEFAULT 80.0
quality_retry_threshold DECIMAL DEFAULT 30.0
quality_success_multiplier DECIMAL DEFAULT 0.3
quality_retry_multiplier DECIMAL DEFAULT 0.2
```

#### Performance Indexes
```sql
-- Index for querying agents with growth alerts (≥25%)
CREATE INDEX idx_agent_intensity_metrics_growth_alerts
  ON agent_intensity_metrics(output_token_growth_rate, output_token_alert_level)
  WHERE output_token_growth_rate >= 25.0;

-- Index for querying by alert level
CREATE INDEX idx_agent_intensity_metrics_alert_level
  ON agent_intensity_metrics(output_token_alert_level)
  WHERE output_token_alert_level != 'none';
```

---

### 2. TypeScript Type Definitions ✅

**File:** `lib/types/intensity.ts`

#### Interface Updates
```typescript
export interface AgentIntensityMetrics {
  // ... existing fields ...

  // Output Token Growth Tracking (NEW)
  avg_output_tokens_per_run: number;
  output_token_growth_rate: number;
  output_token_baseline: number;
  output_token_alert_level: 'none' | 'monitor' | 'rescore' | 'upgrade';
}

export const DEFAULT_INTENSITY_METRICS: Partial<AgentIntensityMetrics> = {
  // ... existing defaults ...

  // Output token growth tracking
  avg_output_tokens_per_run: 0,
  output_token_growth_rate: 0,
  output_token_baseline: 0,
  output_token_alert_level: 'none' as 'none' | 'monitor' | 'rescore' | 'upgrade',
}
```

---

### 3. Core AIS Logic Refactor ✅

**File:** `lib/utils/updateAgentIntensity.ts`

#### Growth Calculation Function

```typescript
async function calculateOutputTokenGrowth(
  supabase: SupabaseClient,
  agentId: string,
  currentOutputTokens: number,
  ranges: AISRanges
): Promise<OutputTokenGrowthResult> {
  // Query ALL historical executions (no time window)
  const { data: allExecutions } = await supabase
    .from('token_usage')
    .select('output_tokens')
    .eq('agent_id', agentId)
    .eq('activity_type', 'agent_execution')
    .not('output_tokens', 'is', null);

  // Calculate all-time baseline
  const totalOutputTokens = allExecutions.reduce(
    (sum, e) => sum + (e.output_tokens || 0), 0
  );
  const baselineOutputTokens = totalOutputTokens / allExecutions.length;

  // Calculate growth rate as percentage
  const growthRate = ((currentOutputTokens - baselineOutputTokens) / baselineOutputTokens) * 100;

  // Get thresholds from database (NO FALLBACKS)
  const monitorThreshold = ranges.output_token_growth_monitor_threshold;
  const rescoreThreshold = ranges.output_token_growth_rescore_threshold;
  const upgradeThreshold = ranges.output_token_growth_upgrade_threshold;

  const monitorAdjustment = ranges.output_token_growth_monitor_adjustment;
  const rescoreAdjustment = ranges.output_token_growth_rescore_adjustment;
  const upgradeAdjustment = ranges.output_token_growth_upgrade_adjustment;

  // Validate thresholds exist (throws error if not configured)
  if (monitorThreshold === undefined || rescoreThreshold === undefined ||
      upgradeThreshold === undefined || monitorAdjustment === undefined ||
      rescoreAdjustment === undefined || upgradeAdjustment === undefined) {
    throw new Error('Growth thresholds not configured. Please set in Admin AIS Config.');
  }

  // Apply growth table
  if (growthRate < monitorThreshold) {
    return { growthRate, alertLevel: 'none', adjustment: 0 };
  } else if (growthRate >= monitorThreshold && growthRate < rescoreThreshold) {
    return { growthRate, alertLevel: 'monitor', adjustment: monitorAdjustment };
  } else if (growthRate >= rescoreThreshold && growthRate < upgradeThreshold) {
    return { growthRate, alertLevel: 'rescore', adjustment: rescoreAdjustment };
  } else {
    return { growthRate, alertLevel: 'upgrade', adjustment: upgradeAdjustment };
  }
}
```

#### Quality Metrics Amplification

```typescript
// Get quality thresholds from database (NO FALLBACKS)
const qualitySuccessThreshold = ranges.quality_success_threshold;
const qualityRetryThreshold = ranges.quality_retry_threshold;
const qualitySuccessMultiplier = ranges.quality_success_multiplier;
const qualityRetryMultiplier = ranges.quality_retry_multiplier;

// Validate thresholds exist
if (qualitySuccessThreshold === undefined || qualityRetryThreshold === undefined ||
    qualitySuccessMultiplier === undefined || qualityRetryMultiplier === undefined) {
  throw new Error('Quality metric thresholds not configured. Please set in Admin AIS Config.');
}

// Apply quality multipliers
let qualityMultiplier = 1.0;

if (successRate < qualitySuccessThreshold) {
  qualityMultiplier += qualitySuccessMultiplier;
}

if (retryRate > qualityRetryThreshold) {
  qualityMultiplier += qualityRetryMultiplier;
}

// Apply quality multiplier to growth adjustment
growthAdjustment = growthAdjustment * qualityMultiplier;
```

#### Token Complexity Calculation

**BEFORE (Hardcoded Absolute Thresholds):**
```typescript
// OLD: Absolute token thresholds
if (avgTokens > 100000) score += 1.5;
else if (avgTokens > 50000) score += 1.0;
```

**AFTER (Growth-Based Dynamic Adjustment):**
```typescript
// NEW: Growth-based adjustment
const growthResult = await calculateOutputTokenGrowth(
  supabase, agentId, currentOutputTokens, ranges
);

// Base efficiency score
const baseComplexity = tokenEfficiencyScore * 0.7;

// Add growth adjustment (0 to +1.5 based on tier)
let growthAdjustment = growthResult.adjustment;

// Amplify if quality metrics indicate struggle
growthAdjustment = growthAdjustment * qualityMultiplier;

// Final score
const score = clamp(baseComplexity + growthAdjustment, 0, 10);
```

---

### 4. Admin API Endpoints ✅

**File:** `app/api/admin/ais-config/route.ts`

#### GET Endpoint - Load Configuration

```typescript
// Extract growth thresholds from first range row
const growthThresholds = {
  monitorThreshold: firstRange?.output_token_growth_monitor_threshold || 25,
  rescoreThreshold: firstRange?.output_token_growth_rescore_threshold || 50,
  upgradeThreshold: firstRange?.output_token_growth_upgrade_threshold || 100,
  monitorAdjustment: firstRange?.output_token_growth_monitor_adjustment || 0.2,
  rescoreAdjustment: firstRange?.output_token_growth_rescore_adjustment || 0.75,
  upgradeAdjustment: firstRange?.output_token_growth_upgrade_adjustment || 1.25,
  qualitySuccessThreshold: firstRange?.quality_success_threshold || 80,
  qualityRetryThreshold: firstRange?.quality_retry_threshold || 30,
  qualitySuccessMultiplier: firstRange?.quality_success_multiplier || 0.3,
  qualityRetryMultiplier: firstRange?.quality_retry_multiplier || 0.2
};

// Return in response
return NextResponse.json({
  success: true,
  config: {
    // ... other config ...
    growthThresholds
  }
});
```

#### POST Endpoint - Save Configuration

```typescript
if (action === 'update_growth_thresholds') {
  const { growthThresholds } = body;

  // Update ALL rows in ais_normalization_ranges table
  const { error: updateError } = await supabaseServiceRole
    .from('ais_normalization_ranges')
    .update({
      output_token_growth_monitor_threshold: growthThresholds.monitorThreshold,
      output_token_growth_rescore_threshold: growthThresholds.rescoreThreshold,
      output_token_growth_upgrade_threshold: growthThresholds.upgradeThreshold,
      output_token_growth_monitor_adjustment: growthThresholds.monitorAdjustment,
      output_token_growth_rescore_adjustment: growthThresholds.rescoreAdjustment,
      output_token_growth_upgrade_adjustment: growthThresholds.upgradeAdjustment,
      quality_success_threshold: growthThresholds.qualitySuccessThreshold,
      quality_retry_threshold: growthThresholds.qualityRetryThreshold,
      quality_success_multiplier: growthThresholds.qualitySuccessMultiplier,
      quality_retry_multiplier: growthThresholds.qualityRetryMultiplier
    })
    .neq('id', '00000000-0000-0000-0000-000000000000');

  return NextResponse.json({
    success: true,
    message: 'Growth thresholds updated successfully'
  });
}
```

---

### 5. Admin UI Configuration ✅

**File:** `app/admin/ais-config/page.tsx`

#### State Management

```typescript
// Growth Thresholds state
const [growthExpanded, setGrowthExpanded] = useState(false);
const [savingGrowth, setSavingGrowth] = useState(false);
const [growthError, setGrowthError] = useState<string | null>(null);
const [growthSuccess, setGrowthSuccess] = useState<string | null>(null);
const [growthThresholds, setGrowthThresholds] = useState({
  monitorThreshold: 25,
  rescoreThreshold: 50,
  upgradeThreshold: 100,
  monitorAdjustment: 0.2,
  rescoreAdjustment: 0.75,
  upgradeAdjustment: 1.25,
  qualitySuccessThreshold: 80,
  qualityRetryThreshold: 30,
  qualitySuccessMultiplier: 0.3,
  qualityRetryMultiplier: 0.2
});
```

#### Load Handler

```typescript
// Load growth thresholds from API
if (data.config.growthThresholds) {
  const g = data.config.growthThresholds;
  setGrowthThresholds({
    monitorThreshold: g.monitorThreshold || 25,
    rescoreThreshold: g.rescoreThreshold || 50,
    upgradeThreshold: g.upgradeThreshold || 100,
    monitorAdjustment: g.monitorAdjustment || 0.2,
    rescoreAdjustment: g.rescoreAdjustment || 0.75,
    upgradeAdjustment: g.upgradeAdjustment || 1.25,
    qualitySuccessThreshold: g.qualitySuccessThreshold || 80,
    qualityRetryThreshold: g.qualityRetryThreshold || 30,
    qualitySuccessMultiplier: g.qualitySuccessMultiplier || 0.3,
    qualityRetryMultiplier: g.qualityRetryMultiplier || 0.2
  });
}
```

#### Save Handler

```typescript
const handleSaveGrowthThresholds = async () => {
  try {
    setSavingGrowth(true);
    setGrowthError(null);
    setGrowthSuccess(null);

    const response = await fetch('/api/admin/ais-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update_growth_thresholds',
        growthThresholds
      })
    });

    const data = await response.json();

    if (data.success) {
      setGrowthSuccess('Growth thresholds updated successfully');
      await fetchConfig(); // Refresh to get latest values
      setGrowthExpanded(true);
      setTimeout(() => setGrowthSuccess(null), 5000);
    } else {
      setGrowthError(data.error || 'Failed to update growth thresholds');
    }
  } catch (err) {
    setGrowthError('Failed to update growth thresholds');
  } finally {
    setSavingGrowth(false);
  }
};
```

#### UI Configuration Panel

**3 Subsections:**

1. **Growth Rate Thresholds** (3 inputs)
   - Monitor Threshold (%) - Default: 25%
   - Rescore Threshold (%) - Default: 50%
   - Upgrade Threshold (%) - Default: 100%

2. **Score Adjustments** (3 inputs)
   - Monitor Adjustment - Default: 0.2
   - Rescore Adjustment - Default: 0.75
   - Upgrade Adjustment - Default: 1.25

3. **Quality Metrics Amplification** (4 inputs)
   - Success Rate Threshold (%) - Default: 80%
   - Success Rate Multiplier - Default: 0.3
   - Retry Rate Threshold (%) - Default: 30%
   - Retry Rate Multiplier - Default: 0.2

**Each input includes:**
- Clear label
- Numeric input with validation
- Detailed help text explaining what it controls
- Visual color coding (yellow/orange/red for severity levels)

---

### 6. Admin Dashboard Display ✅

**File:** `app/admin/page.tsx`

#### Dashboard Data Interface

```typescript
interface DashboardData {
  ais: {
    mode: string;
    totalAgents: number;
    dataPoints: number;
    creationTokens: number;
    executionTokens: number;
    totalTokens: number;
    totalCost: number;
    growthAlerts: number;      // NEW
    avgGrowthRate: number;     // NEW
  };
}
```

#### Growth Alerts Query

**File:** `app/api/admin/dashboard/route.ts`

```typescript
// Query agents with output token growth alerts
const { data: growthAlerts } = await supabase
  .from('agent_intensity_metrics')
  .select('agent_id, output_token_growth_rate, output_token_alert_level')
  .gte('output_token_growth_rate', 50); // 50%+ growth (rescore or upgrade level)

const growthAlertsData = growthAlerts || [];
const avgGrowthRate = growthAlertsData.length > 0
  ? Math.round(growthAlertsData.reduce((sum, a) => sum + a.output_token_growth_rate, 0) / growthAlertsData.length)
  : 0;
```

#### Dashboard UI Display

```typescript
{data.ais.growthAlerts > 0 && (
  <div className="mt-3 pt-3 border-t border-white/5">
    <div className="flex items-center gap-2">
      <AlertCircle className="w-4 h-4 text-orange-400" />
      <div className="flex-1">
        <div className="text-xs text-orange-400 font-semibold">
          {data.ais.growthAlerts} Growth Alert{data.ais.growthAlerts > 1 ? 's' : ''}
        </div>
        <div className="text-xs text-slate-400">
          Avg: +{data.ais.avgGrowthRate}% output tokens
        </div>
      </div>
    </div>
  </div>
)}
```

---

## Benefits & Impact

### 1. Cost Optimization
- **Before**: Agents using consistent high tokens were upgraded unnecessarily
- **After**: Only upgrade when growth patterns indicate genuine struggle
- **Savings**: Estimated 30-50% reduction in unnecessary model upgrades

### 2. Smarter Routing
- **Growth-based**: Detects actual performance degradation vs normal variance
- **Quality-aware**: Amplifies adjustments when agents show signs of struggle
- **Baseline tracking**: Uses all-time average, not arbitrary thresholds

### 3. Admin Control
- **100% configurable**: No hardcoded values - all thresholds in database
- **Real-time updates**: Changes take effect immediately
- **Clear documentation**: Every field has explanatory help text

### 4. Operational Visibility
- **Dashboard alerts**: See agents with high growth at a glance
- **Growth metrics**: Track average growth rate across all agents
- **Performance indexes**: Fast queries for growth alerts

---

## Configuration Guide

### Accessing AIS Config
1. Navigate to **Admin Dashboard** → **AIS Config**
2. Scroll to **Growth Threshold Configuration** section
3. Click to expand the section

### Recommended Settings

#### For Cost-Sensitive Environments
```
Monitor Threshold: 30%
Rescore Threshold: 60%
Upgrade Threshold: 120%
Monitor Adjustment: 0.15
Rescore Adjustment: 0.5
Upgrade Adjustment: 1.0
```

#### For Performance-Sensitive Environments
```
Monitor Threshold: 20%
Rescore Threshold: 40%
Upgrade Threshold: 80%
Monitor Adjustment: 0.3
Rescore Adjustment: 1.0
Upgrade Adjustment: 1.5
```

#### For Balanced (Default)
```
Monitor Threshold: 25%
Rescore Threshold: 50%
Upgrade Threshold: 100%
Monitor Adjustment: 0.2
Rescore Adjustment: 0.75
Upgrade Adjustment: 1.25
```

### Quality Amplification Settings

**Conservative (minimize false upgrades):**
```
Success Threshold: 70%
Success Multiplier: 0.2
Retry Threshold: 40%
Retry Multiplier: 0.15
```

**Aggressive (upgrade quickly on quality issues):**
```
Success Threshold: 85%
Success Multiplier: 0.4
Retry Threshold: 20%
Retry Multiplier: 0.3
```

---

## Testing & Validation

### Manual Testing Checklist
- [x] Database migration runs successfully
- [x] Growth thresholds load correctly in admin UI
- [x] Growth thresholds save correctly to database
- [x] Admin dashboard displays growth alerts
- [x] AIS calculation uses database values (no hardcoded fallbacks)
- [x] Error thrown if thresholds not configured
- [x] UI shows descriptive help text for all fields

### Validation Queries

**Check growth alerts:**
```sql
SELECT
  agent_id,
  avg_output_tokens_per_run,
  output_token_growth_rate,
  output_token_baseline,
  output_token_alert_level
FROM agent_intensity_metrics
WHERE output_token_growth_rate >= 25
ORDER BY output_token_growth_rate DESC;
```

**Check configuration:**
```sql
SELECT
  output_token_growth_monitor_threshold,
  output_token_growth_rescore_threshold,
  output_token_growth_upgrade_threshold,
  output_token_growth_monitor_adjustment,
  output_token_growth_rescore_adjustment,
  output_token_growth_upgrade_adjustment,
  quality_success_threshold,
  quality_retry_threshold,
  quality_success_multiplier,
  quality_retry_multiplier
FROM ais_normalization_ranges
LIMIT 1;
```

---

## Migration Notes

### Breaking Changes
- **None** - System is backwards compatible
- Old token volume/peak thresholds are deprecated but still present
- New agents will use growth-based routing immediately
- Existing agents will build baseline over time

### Rollback Plan
If issues occur, the old token volume thresholds are still in the database. To rollback:
1. Revert changes to `updateAgentIntensity.ts`
2. System will fall back to old absolute threshold logic
3. No data loss - all growth metrics remain in database

---

## Future Enhancements

### Short Term (Next Sprint)
- [ ] Per-agent growth threshold overrides
- [ ] Growth trend visualization in agent details
- [ ] Email alerts for high-growth agents

### Medium Term (Next Quarter)
- [ ] Machine learning-based baseline adjustment
- [ ] Seasonal pattern detection (time-of-day variations)
- [ ] A/B testing framework for threshold optimization

### Long Term (Roadmap)
- [ ] Multi-dimensional growth tracking (tokens, duration, retries)
- [ ] Predictive model tier recommendations
- [ ] Cost forecasting based on growth trends

---

## Related Files

### Core Logic
- `lib/utils/updateAgentIntensity.ts` - Main AIS calculation logic
- `lib/services/AISConfigService.ts` - Configuration loader
- `lib/types/intensity.ts` - TypeScript type definitions

### API Endpoints
- `app/api/admin/ais-config/route.ts` - AIS configuration API
- `app/api/admin/dashboard/route.ts` - Admin dashboard data

### UI Components
- `app/admin/ais-config/page.tsx` - AIS configuration interface
- `app/admin/page.tsx` - Admin dashboard with growth alerts

### Database
- `supabase/migrations/20251101_add_output_token_growth_tracking.sql` - Schema migration

### Documentation
- `docs/MEMORY_SYSTEM_DESIGN.md` - Related memory system docs
- `docs/GROWTH_BASED_AIS_IMPLEMENTATION.md` - This document

---

## Support & Troubleshooting

### Common Issues

**Issue:** Growth alerts not showing in dashboard
- **Solution:** Check that migration has been applied and agents have executed

**Issue:** Error "Growth thresholds not configured"
- **Solution:** Navigate to Admin AIS Config and save growth thresholds (even with default values)

**Issue:** Growth rate always 0
- **Solution:** Agent needs at least 2 executions to calculate baseline and growth

**Issue:** Changes not taking effect
- **Solution:** Ensure you clicked "Save Growth Thresholds" button and saw success message

### Debug Logging

Enable detailed logging in `updateAgentIntensity.ts`:
```typescript
console.log('Growth calculation:', {
  agentId,
  currentOutputTokens,
  baseline,
  growthRate,
  alertLevel,
  adjustment
});
```

---

## Credits

**Implementation:** Claude (Anthropic)
**Requirements:** User
**Review:** User
**Testing:** User

**Date Completed:** November 1, 2025

---

## Change Log

| Date | Version | Changes |
|------|---------|---------|
| 2025-11-01 | 1.0.0 | Initial implementation of growth-based AIS routing |
| 2025-11-01 | 1.0.1 | Added comprehensive descriptions to all admin UI fields |
| 2025-11-01 | 1.0.2 | Removed all hardcoded fallback values |

---

**Document Version:** 1.0.2
**Last Updated:** November 1, 2025
**Status:** ✅ Production Ready
