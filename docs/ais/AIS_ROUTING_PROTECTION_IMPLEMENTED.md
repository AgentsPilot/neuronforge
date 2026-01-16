# AIS Routing Protection - Single Source of Truth Implementation

**Date**: 2025-01-31
**Status**: ✅ IMPLEMENTED

---

## Problem Identified

User correctly identified that having **two separate parameters** controlling routing threshold was problematic:

- `routing_min_executions` (in System Config) - controlled when routing starts
- `min_executions_for_score` (in AIS Config) - controlled when combined_score switches from creation-only to blended formula

**The Issue:**
If these values didn't match exactly, routing could make decisions using stale creation-only combined_scores before blending began, leading to suboptimal model selection.

---

## Solution Implemented

### **Single Source of Truth: `min_executions_for_score`**

Routing now directly uses `min_executions_for_score` from AIS Config, eliminating the need for `routing_min_executions`.

---

## Changes Made

### 1. **Model Router Logic** ([lib/ai/modelRouter.ts](../lib/ai/modelRouter.ts))

**Before:**
```typescript
const minExecutions = routingConfig.minExecutions; // from routing_min_executions

if (!metrics || metrics.total_executions < minExecutions) {
  // Use cheap model
}
```

**After:**
```typescript
// 🚨 CRITICAL: Use min_executions_for_score as the SINGLE SOURCE OF TRUTH
const minExecutionsForScore = await AISConfigService.getSystemConfig(
  supabase,
  'min_executions_for_score',
  5
);

if (!metrics || metrics.total_executions < minExecutionsForScore) {
  // Use cheap model - guaranteed to match when blending starts
}
```

**Benefits:**
- ✅ Routing threshold perfectly synchronized with score blending
- ✅ Impossible to misconfigure
- ✅ No validation needed

---

### 2. **System Config UI Cleanup** ([app/admin/system-config/page.tsx](../app/admin/system-config/page.tsx))

**Removed:**
- ❌ "Minimum Executions" input field
- ❌ `minExecutions` state variable
- ❌ `routing_min_executions` from updates payload

**Result:**
- System Config now only manages thresholds (low, medium) and success rate
- Routing threshold moved to AIS Config where it belongs

---

### 3. **AIS Config UI Enhancement** ([app/admin/ais-config/page.tsx](../app/admin/ais-config/page.tsx))

**Updated Info Box:**
```tsx
<div className="bg-emerald-500/10 border border-emerald-500/20">
  <p className="text-emerald-400">🔒 System Protection: Single Source of Truth</p>
  <p>
    <strong>Protection Enabled:</strong> Model routing now uses
    min_executions_for_score as its threshold. This guarantees routing only starts
    when combined_score has switched to the blended formula.
  </p>
</div>
```

**Updated Parameter Label:**
```tsx
<label>
  Min Executions For Score
  <span className="text-emerald-400">(Controls Routing)</span>
</label>
```

**Updated Description:**
```
🔒 Single Source of Truth: Controls both score blending AND routing threshold.
Before: 100% creation score, uses cheap model.
After: 30% creation + 70% execution, routes by complexity.
```

---

### 4. **API Validation Simplified**

**Before ([app/api/admin/system-limits/route.ts](../app/api/admin/system-limits/route.ts)):**
```typescript
// 30+ lines of cross-table validation checking if values match
if (limits.minExecutionsForScore > routingMinExecutions) {
  return error...
}
```

**After:**
```typescript
// 🔒 PROTECTION: min_executions_for_score is now the single source of truth
// No validation needed - routing uses this value directly
console.log(`🔒 min_executions_for_score set to ${value} - controls both blending AND routing`);
```

**Before ([app/api/admin/system-config/route.ts](../app/api/admin/system-config/route.ts)):**
```typescript
// Validation to ensure routing_min_executions >= min_executions_for_score
if (updates.routing_min_executions < minExecutionsForScore) {
  return error...
}
```

**After:**
```typescript
// 🔒 DEPRECATED: routing_min_executions is no longer used
if (updates.routing_min_executions !== undefined) {
  console.warn(`⚠️ routing_min_executions is deprecated`);
}
```

---

### 5. **Documentation Updates** ([docs/AIS_PARAMETER_FLOW_ANALYSIS.md](./AIS_PARAMETER_FLOW_ANALYSIS.md))

**Updated Executive Summary:**
```markdown
### 🚨 CRITICAL SYSTEM PROTECTION

**Routing Now Uses `min_executions_for_score` as Single Source of Truth**

Benefits:
- ✅ Single source of truth - One parameter controls both behaviors
- ✅ Automatic protection - Impossible to misconfigure
- ✅ Simplified configuration - Admins don't need to keep two values in sync
- ✅ Guaranteed accuracy - Routing always uses most accurate scores
```

---

## System Behavior After Changes

### Execution Timeline Example (threshold = 5):

| Run # | total_executions | execution_score Calculated? | combined_score Formula | Routing Behavior |
|-------|------------------|----------------------------|------------------------|------------------|
| 1 | 1 | ✅ Yes (e.g., 2.4) | creation_score = 3.5 | ⛔ Blocked - Uses GPT-4o-mini |
| 2 | 2 | ✅ Yes (e.g., 2.3) | creation_score = 3.5 | ⛔ Blocked - Uses GPT-4o-mini |
| 3 | 3 | ✅ Yes (e.g., 2.4) | creation_score = 3.5 | ⛔ Blocked - Uses GPT-4o-mini |
| 4 | 4 | ✅ Yes (e.g., 2.5) | creation_score = 3.5 | ⛔ Blocked - Uses GPT-4o-mini |
| **5** | **5** | ✅ Yes (e.g., 2.4) | **(3.5×0.3) + (2.4×0.7) = 2.73** | ✅ **Active** - Routes by score (→ GPT-4o-mini) |
| 6 | 6 | ✅ Yes (e.g., 6.5) | (3.5×0.3) + (6.5×0.7) = 5.6 | ✅ Active - Routes by score (→ Claude Haiku) |
| 7 | 7 | ✅ Yes (e.g., 8.2) | (3.5×0.3) + (8.2×0.7) = 6.8 | ✅ Active - Routes by score (→ GPT-4o) |

**Key Observations:**
1. **execution_score is ALWAYS calculated** (this is why user saw it after 3 runs - normal behavior!)
2. **combined_score formula switches at run 5** (when threshold reached)
3. **Routing is blocked until run 5** (prevents using stale creation-only scores)
4. **Perfect synchronization** - blending and routing start at the exact same run

---

## Migration Notes

### For Admins

**No Action Required:**
- Existing `routing_min_executions` values in database are harmless (just ignored)
- System automatically uses `min_executions_for_score` from AIS Config
- No data migration needed

**Recommended:**
- Set `min_executions_for_score` to desired routing threshold (3 for dev, 5 for production)
- This single value now controls both score blending AND routing

### For Developers

**Updated Code Paths:**
- `ModelRouter.selectModel()` now fetches `min_executions_for_score` directly
- No more cross-table validation between system_settings_config and ais_system_config
- Simplified error handling and logging

---

## Testing Recommendations

1. **Verify Routing Threshold:**
   ```sql
   SELECT config_value
   FROM ais_system_config
   WHERE config_key = 'min_executions_for_score';
   ```

2. **Monitor Routing Decisions:**
   ```sql
   SELECT
     agent_id,
     total_executions,
     combined_score,
     execution_score,
     creation_score
   FROM agent_intensity_metrics
   WHERE total_executions <= 10
   ORDER BY total_executions;
   ```

3. **Check Audit Trail:**
   ```sql
   SELECT
     action,
     details->>'selected_model' as model,
     details->>'reasoning' as reasoning,
     details->>'intensity_score' as score
   FROM audit_trail
   WHERE action = 'model_routing_decision'
   ORDER BY timestamp DESC
   LIMIT 20;
   ```

---

## Summary

### What Changed:
- ❌ **Removed:** `routing_min_executions` from System Config UI and logic
- ✅ **Implemented:** Routing uses `min_executions_for_score` directly
- ✅ **Protected:** Impossible to misconfigure routing threshold
- ✅ **Simplified:** No validation needed, no dual parameters

### Benefits:
1. **Single Source of Truth** - One parameter controls both behaviors
2. **Automatic Protection** - Impossible to create mismatched configurations
3. **Simplified Admin Experience** - Less confusing, clearer purpose
4. **Guaranteed Accuracy** - Routing always uses accurate blended scores when available

### User Impact:
- ✅ **Safer:** Cannot accidentally route with stale scores
- ✅ **Clearer:** Parameter purpose is obvious ("Controls Routing")
- ✅ **Simpler:** One less parameter to manage
- ✅ **Faster:** No validation overhead

---

**Status:** ✅ Ready for production
**Backward Compatible:** ✅ Yes (existing configs continue working)
**Breaking Changes:** ❌ None
