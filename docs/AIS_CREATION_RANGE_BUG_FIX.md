# AIS Creation Range Bug Fix

**Date**: 2025-01-29
**Status**: 🔴 **Action Required** - Manual SQL execution needed
**Priority**: HIGH - Affects all agent creation scores

---

## 🐛 Bug Discovered

After the AIS refactoring was completed, we discovered that **agents with 1 plugin/step/field are scoring 0.0** (same as agents with 0).

### Example from User's Agent

**Agent Details:**
- Workflow Steps: 3
- Connected Plugins: **1** ⚠️
- I/O Fields: 2

**Current Scoring:**
```
Workflow Structure: 2.2/10 ✅
Plugin Diversity:   0.0/10 ❌ (1 plugin connected!)
I/O Schema:         1.4/10 ✅
Trigger Type:       0.0/10 ✅

Creation Score: 1.4/10
```

**Problem**: Agent has **1 plugin connected** but scores **0.0/10** for plugin diversity!

---

## 🔍 Root Cause Analysis

All three creation ranges were configured with `min=1` instead of `min=0`:

| Range | Min | Max | Problem |
|-------|-----|-----|---------|
| `creation_plugins` | **1** | 5 | 0 and 1 plugin both score 0.0 |
| `creation_workflow_steps` | **1** | 10 | 0 and 1 step both score 0.0 |
| `creation_io_fields` | **1** | 8 | 0 and 1 field both score 0.0 |

### Normalization Logic

With `min=1, max=5`:
```
score = (value - min) / (max - min) * 10

0 plugins → clamps to min (1) → (1-1)/(5-1)*10 = 0.0 ❌
1 plugin  → (1-1)/(5-1)*10 = 0.0 ❌ SAME AS 0!
2 plugins → (2-1)/(5-1)*10 = 2.5 ✅
5 plugins → (5-1)/(5-1)*10 = 10.0 ✅
```

### Current Scoring Issues

**Plugin Diversity:**
- 0 plugins: 0.0/10
- 1 plugin: 0.0/10 ❌ **NO CREDIT**
- 2 plugins: 2.5/10
- 3 plugins: 5.0/10
- 5 plugins: 10.0/10

**Workflow Steps:**
- 0 steps: 0.0/10
- 1 step: 0.0/10 ❌ **NO CREDIT**
- 2 steps: 1.1/10
- 3 steps: 2.2/10
- 10 steps: 10.0/10

**I/O Fields:**
- 0 fields: 0.0/10
- 1 field: 0.0/10 ❌ **NO CREDIT**
- 2 fields: 1.4/10
- 3 fields: 2.9/10
- 8 fields: 10.0/10

---

## ✅ Solution

Change all three ranges to start from `min=0`:

| Range | Old Min | New Min | Max |
|-------|---------|---------|-----|
| `creation_plugins` | 1 → **0** | 5 |
| `creation_workflow_steps` | 1 → **0** | 10 |
| `creation_io_fields` | 1 → **0** | 8 |

### After Fix - Plugin Diversity

- 0 plugins: 0.0/10 (no plugins)
- 1 plugin: **2.0/10** ✅ **NOW GETS CREDIT**
- 2 plugins: 4.0/10
- 3 plugins: 6.0/10
- 4 plugins: 8.0/10
- 5 plugins: 10.0/10

### After Fix - Workflow Steps

- 0 steps: 0.0/10
- 1 step: **1.0/10** ✅ **NOW GETS CREDIT**
- 2 steps: 2.0/10
- 3 steps: 3.0/10
- 10 steps: 10.0/10

### After Fix - I/O Fields

- 0 fields: 0.0/10
- 1 field: **1.25/10** ✅ **NOW GETS CREDIT**
- 2 fields: 2.5/10
- 3 fields: 3.75/10
- 8 fields: 10.0/10

---

## 🔧 How to Fix

### Step 1: Execute SQL in Supabase Dashboard

**⚠️ MANUAL STEP REQUIRED** - The Supabase TypeScript client has schema cache issues.

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Run this SQL:

```sql
UPDATE ais_normalization_ranges
SET best_practice_min = 0
WHERE range_key IN ('creation_plugins', 'creation_workflow_steps', 'creation_io_fields');
```

3. Verify the update using the RPC function:

```sql
SELECT * FROM get_active_ais_ranges()
WHERE range_key IN ('creation_plugins', 'creation_workflow_steps', 'creation_io_fields')
ORDER BY range_key;
```

Expected result:
```
creation_io_fields       | 0 | 8
creation_plugins         | 0 | 5
creation_workflow_steps  | 0 | 10
```

### Step 2: Backfill All Agents

After the SQL is executed, run the backfill script to recalculate all agent scores:

```bash
npx tsx scripts/backfill-creation-dimensions.ts
```

This will:
1. Clear the AIS config cache (or wait 5 minutes for auto-clear)
2. Recalculate creation scores for all 15 agents using new ranges
3. Update all 4 creation dimension columns
4. Recalculate combined scores

### Step 3: Verify the Fix

Check that the scoring is now correct:

```bash
npx tsx scripts/check-all-creation-ranges.ts
```

Expected output should show:
- 0 plugins → 0.0/10
- **1 plugin → 2.0/10** ✅ (was 0.0 before)
- 2 plugins → 4.0/10

---

## 📊 Impact Analysis

### Agents Affected

All 15 agents in the database will have their creation scores updated.

**Agents with 1 plugin** (example from user):
- **Before**: Plugin score 0.0/10
- **After**: Plugin score 2.0/10
- **Creation Score Change**: Will increase by ~0.6 points (2.0 × 30% weight)
- **Combined Score Change**: Will increase by ~0.18 points (0.6 × 30% creation weight)

### Example Calculation

User's agent:
- Workflow: 3 steps → 3.0/10 (was 2.2/10 with old ranges)
- Plugins: 1 plugin → **2.0/10** (was 0.0/10) ✅
- I/O: 2 fields → **2.5/10** (was 1.4/10) ✅
- Trigger: on-demand → 0.0/10

**New Creation Score:**
(3.0 × 0.5) + (2.0 × 0.3) + (2.5 × 0.2) + 0.0 = 1.5 + 0.6 + 0.5 = **2.6/10**

**Old Creation Score:** 1.4/10
**Improvement:** +1.2 points (85% increase!)

**New Combined Score:**
(2.6 × 0.3) + (5.0 × 0.7) = 0.78 + 3.5 = **4.28/10**

**Old Combined Score:** 3.9/10
**Improvement:** +0.38 points

---

## 📁 Files

### Created Files

1. **[supabase/migrations/20250129_fix_creation_ranges.sql](../supabase/migrations/20250129_fix_creation_ranges.sql)**
   - SQL migration to fix the ranges

2. **[scripts/check-plugin-scoring.ts](../scripts/check-plugin-scoring.ts)**
   - Analysis script showing the plugin scoring bug

3. **[scripts/check-all-creation-ranges.ts](../scripts/check-all-creation-ranges.ts)**
   - Comprehensive analysis of all 3 creation ranges

4. **[scripts/fix-creation-ranges-v2.ts](../scripts/fix-creation-ranges-v2.ts)**
   - Attempted automatic fix (failed due to schema cache)

5. **[scripts/execute-range-fix.ts](../scripts/execute-range-fix.ts)**
   - Attempted SQL execution (failed due to missing RPC)

### Modified Files

None - this is a **database-only fix** that requires manual SQL execution.

---

## ✅ Success Criteria

After executing the fix:

1. ✅ All 3 creation ranges have `min_value = 0`
2. ✅ Agents with 1 plugin score 2.0/10 (not 0.0)
3. ✅ Agents with 1 step score 1.0/10 (not 0.0)
4. ✅ Agents with 1 field score 1.25/10 (not 0.0)
5. ✅ All 15 agents have updated creation scores
6. ✅ Combined scores reflect the new creation scores
7. ✅ User's agent shows proper plugin diversity score

---

## 🎯 Next Steps

1. **Execute the SQL** (manual step in Supabase dashboard)
2. **Run backfill script** to update all agents
3. **Verify the fix** using check-all-creation-ranges.ts
4. **Check user's agent** to confirm plugin diversity now shows 2.0/10

---

## 📝 Lessons Learned

1. **Always test edge cases**: The range `min=1` seemed reasonable but caused 0 and 1 to score the same
2. **Validate normalization ranges**: Min should be 0 unless there's a strong reason
3. **Schema cache issues**: Supabase TypeScript client can have stale cache - use SQL editor for schema changes
4. **Test with real agents**: The bug wasn't caught until we saw actual agent data

---

*Generated on 2025-01-29*
