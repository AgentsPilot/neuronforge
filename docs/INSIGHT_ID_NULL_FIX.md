# Insight ID Not Populated - Root Cause & Fix

> **Date:** 2026-06-01
> **Status:** 🔴 Fix Ready - Requires Migration
> **Issue:** `insight_id` field in `execution_insight_runs` is NULL despite matching insights existing

---

## Problem Summary

The `execution_insight_runs` table has NULL `insight_id` values even though corresponding insights exist in `execution_insights` with matching titles.

### Evidence from Database Query

```json
[
  {
    "execution_id": "fc4d5c62-b82d-4e6a-9fa5-9f11609f6707",
    "title": "Urgent tasks nearly doubled - team may be overwhelmed",
    "insight_id": null,  // ❌ Should be "15ad345c-eb71-45a8-a397-74b75365b1d6"
    "actual_insight_id": "15ad345c-eb71-45a8-a397-74b75365b1d6",
    "status": "❌ NULL"
  }
]
```

**Impact:** The dual-table architecture breaks down - cannot query historical runs by `insight_id`, cannot track which runs contributed to which insights, anomaly detection is disabled.

---

## Root Cause Analysis

### The Dual-Table Population Flow

From [WorkflowPilot.ts:2506-2652](../lib/pilot/WorkflowPilot.ts):

```typescript
// Step 1: Store run snapshot with insight_id = null
await repository.createInsightRun({
  insight_id: null,
  execution_id: executionId,
  title: insight.title,
  // ...
});

// Step 2: Create insight in execution_insights
const createResult = await repository.create({ /* ... */ });

// Step 3: Link run to insight (THIS IS FAILING SILENTLY)
await repository.linkInsightRun(executionId, insight.title, createResult.id);
```

### The `linkInsightRun()` Method

From [InsightRepository.ts:423-451](../lib/repositories/InsightRepository.ts):

```typescript
async linkInsightRun(executionId: string, title: string, insightId: string): Promise<boolean> {
  const { data, error } = await this.supabase
    .from('execution_insight_runs')
    .update({ insight_id: insightId })
    .eq('execution_id', executionId)
    .eq('title', title)
    .is('insight_id', null)
    .select();

  if (!data || data.length === 0) {
    // ⚠️ THIS IS TRIGGERING - UPDATE affected 0 rows
    console.warn(`No matching insight_run found to link`);
    return false;
  }
}
```

### Why UPDATE Affects 0 Rows

The Supabase client used is from `createAuthenticatedServerClient()` (line 66 in [run-agent/route.ts](../app/api/run-agent/route.ts)), which:

1. ✅ Respects Row Level Security (RLS) policies
2. ✅ Filters by `auth.uid() = user_id` automatically
3. ❌ **Blocks UPDATE if no UPDATE policy exists**

**Diagnosis:** The `execution_insight_runs` table either:
- Does not have RLS enabled, causing confusion
- Has RLS enabled but **missing UPDATE policy**

The INSERT succeeds (Step 1) because there's likely an INSERT policy.
The UPDATE fails silently (Step 3) because there's no UPDATE policy.

---

## Solution: Add RLS Policies

### Migration Script Created

**File:** [`supabase/SQL Scripts/20260601_fix_insight_runs_rls.sql`](../supabase/SQL Scripts/20260601_fix_insight_runs_rls.sql)

This script:

1. ✅ Enables RLS on `execution_insight_runs` (if not already enabled)
2. ✅ Creates 4 policies:
   - **INSERT** - Allows `createInsightRun()`
   - **SELECT** - Allows queries
   - **UPDATE** - Allows `linkInsightRun()` ← **THE CRITICAL FIX**
   - **DELETE** - Allows cleanup
3. ✅ Provides manual fix query to link existing NULL records
4. ✅ Includes verification queries

### Key Policy (The Fix)

```sql
CREATE POLICY "Users can update their own insight runs"
  ON execution_insight_runs
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

This allows the authenticated Supabase client to UPDATE rows where `user_id` matches the current user.

---

## How to Apply the Fix

### Step 1: Run the Migration

```bash
# Connect to your Supabase database
psql $DATABASE_URL -f "supabase/SQL Scripts/20260601_fix_insight_runs_rls.sql"
```

### Step 2: Verify Policies Were Created

After running the script, check the output for:

```
 policyname                              | cmd    | purpose
-----------------------------------------+--------+----------------------------------
 Users can delete their own insight runs | DELETE | ✅ Allows cleanup
 Users can insert their own insight runs | INSERT | ✅ Allows createInsightRun()
 Users can view their own insight runs   | SELECT | ✅ Allows queries
 Users can update their own insight runs | UPDATE | ✅ Allows linkInsightRun()
```

### Step 3: Fix Existing NULL Records

The script includes a query (Part 5) that automatically links all existing unlinked runs:

```sql
WITH unlinked_runs AS (
  SELECT
    r.id as run_id,
    i.id as matching_insight_id
  FROM execution_insight_runs r
  INNER JOIN execution_insights i
    ON i.title = r.title
    AND i.user_id = r.user_id
  WHERE r.insight_id IS NULL
)
UPDATE execution_insight_runs
SET insight_id = unlinked_runs.matching_insight_id
FROM unlinked_runs
WHERE execution_insight_runs.id = unlinked_runs.run_id;
```

This will link the 2 existing NULL records shown in your query.

### Step 4: Verify All Records Are Linked

Run this query:

```sql
SELECT
  COUNT(*) FILTER (WHERE insight_id IS NOT NULL) as linked_count,
  COUNT(*) FILTER (WHERE insight_id IS NULL) as unlinked_count
FROM execution_insight_runs
WHERE user_id = auth.uid();
```

**Expected Result:** `unlinked_count = 0`

### Step 5: Test with New Execution

Run an agent and check logs for:

```
[InsightRepository] Linking insight_run: execution=..., title="...", insight=...
[InsightRepository] Successfully linked 1 insight_run(s) to insight ...
🔗 [WorkflowPilot] Successfully linked insight_run to insight id: ...
```

Then verify in database:

```sql
SELECT
  execution_id,
  title,
  insight_id,
  CASE
    WHEN insight_id IS NOT NULL THEN '✅ LINKED'
    ELSE '❌ NULL'
  END as status
FROM execution_insight_runs
WHERE created_at > NOW() - INTERVAL '10 minutes'
ORDER BY created_at DESC;
```

**Expected:** All rows show `✅ LINKED`

---

## Why This Happened

### Timeline of Events

1. **2026-06-01** - Phase 1 implemented dual-table population pattern
2. **Migration script** [`20260601_fix_execution_insights_schema.sql`](../supabase/SQL Scripts/20260601_fix_execution_insights_schema.sql) was created
3. **Critical oversight:** RLS policies for `execution_insight_runs` were not included in migration
4. **Result:** INSERT works (likely had default policy), UPDATE silently fails (no policy)

### Why It Was Hard to Detect

1. No error thrown - Supabase UPDATE returns `data: []` when RLS blocks it
2. Code only logs a warning: `"No matching insight_run found to link"`
3. The insight system still works for display (reads from `execution_insights`)
4. Only the historical linking feature breaks (invisible to users initially)

---

## Testing Checklist

After applying the fix:

- [ ] Run migration script
- [ ] Verify 4 policies created
- [ ] Run manual fix query for existing NULL records
- [ ] Verify `unlinked_count = 0`
- [ ] Execute an agent
- [ ] Check logs for successful linking messages
- [ ] Query database to verify new runs have `insight_id` populated
- [ ] Test JOIN query between `execution_insight_runs` and `execution_insights`

---

## Related Files

| File | Change Required |
|------|----------------|
| [`20260601_fix_insight_runs_rls.sql`](../supabase/SQL Scripts/20260601_fix_insight_runs_rls.sql) | ✅ **NEW** - Run this migration |
| [`InsightRepository.ts`](../lib/repositories/InsightRepository.ts) | ✅ Already has logging (no change needed) |
| [`WorkflowPilot.ts`](../lib/pilot/WorkflowPilot.ts) | ✅ Already has logging (no change needed) |
| [`20260601_fix_execution_insights_schema.sql`](../supabase/SQL Scripts/20260601_fix_execution_insights_schema.sql) | ℹ️ Original migration (does not include RLS) |

---

## Alternative Solutions Considered

### Option 1: Use Service Role Client (NOT RECOMMENDED)

**What:** Pass `supabaseServer` (service role) to `InsightRepository` instead of authenticated client

**Pros:**
- Bypasses RLS entirely
- No migration needed

**Cons:**
- ❌ Violates security model - service role bypasses all RLS
- ❌ Inconsistent with repository pattern (other repos use authenticated client)
- ❌ Could expose other users' data if code has bugs
- ❌ Against project standards (see [REPOSITORY_STRATEGY.md](../docs/REPOSITORY_STRATEGY.md))

### Option 2: Add RLS Policies (RECOMMENDED ✅)

**What:** Add proper RLS policies to allow UPDATE on own records

**Pros:**
- ✅ Maintains security model
- ✅ Consistent with other tables
- ✅ Follows project standards
- ✅ Future-proof

**Cons:**
- Requires migration
- Need to fix existing NULL records

**Decision:** Option 2 selected (proper RLS policies)

---

## Prevention for Future

### Checklist for New Tables with Repositories

When creating a new table that will be accessed via repositories:

1. [ ] Enable RLS: `ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;`
2. [ ] Add INSERT policy if repositories will insert
3. [ ] Add SELECT policy for queries
4. [ ] Add UPDATE policy if repositories will update
5. [ ] Add DELETE policy if repositories will delete
6. [ ] Test with authenticated client (not service role)
7. [ ] Verify policies work by checking affected row counts

### Template for Basic RLS Policies

```sql
-- Enable RLS
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;

-- Basic CRUD policies for user-owned records
CREATE POLICY "Users can manage their own records"
  ON table_name
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

---

## Summary

**Problem:** `insight_id` NULL in `execution_insight_runs` despite matching insights existing

**Root Cause:** Missing UPDATE RLS policy on `execution_insight_runs` table

**Fix:** Run [`20260601_fix_insight_runs_rls.sql`](../supabase/SQL Scripts/20260601_fix_insight_runs_rls.sql) to:
1. Add UPDATE policy (allows `linkInsightRun()`)
2. Link existing NULL records
3. Enable future runs to link automatically

**Impact:** Restores dual-table architecture, enables historical tracking and anomaly detection

**Status:** ✅ Fix ready - awaiting migration application

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-06-01 | Created | Root cause analysis and RLS fix for insight_id linking issue |
