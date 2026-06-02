# Phase 1 - Debugging Insight Linking Issue

> **Date:** 2026-06-01
> **Issue:** `insight_id` not being populated in `execution_insight_runs` table

---

## Problem Report

User reported that after Phase 1 implementation, the `insight_id` field in `execution_insight_runs` is `null`, preventing proper linking between the two tables.

### Expected Behavior:

```
execution_insight_runs
  ├─ insight_id: "45d49a5a-..." ← Should link to execution_insights.id
  └─ title: "Urgent tasks increased 67%..."

execution_insights
  └─ id: "45d49a5a-..." ← Should match insight_id above
```

### Actual Behavior:

```
execution_insight_runs
  ├─ insight_id: null ❌ NOT LINKED
  └─ title: "Urgent tasks increased 67%..."

execution_insights
  └─ id: "45d49a5a-..." ← Record exists but not linked
```

---

## Root Cause Analysis

The dual-table pattern flow is:
1. Create `execution_insight_runs` record with `insight_id: null`
2. Create or update `execution_insights` record
3. Call `linkInsightRun(executionId, title, insightId)` to update the insight_id

The linking is failing silently. Possible causes:
1. **Title mismatch** - Titles don't match exactly between tables
2. **Timing issue** - Race condition between create and link
3. **Silent failure** - `linkInsightRun()` returns false but no error is logged

---

## Debugging Changes Applied

### 1. Enhanced Logging in WorkflowPilot

**File:** [lib/pilot/WorkflowPilot.ts](../lib/pilot/WorkflowPilot.ts:2648-2658)

**Added:**
```typescript
if (createResult) {
  console.log(`✅ [WorkflowPilot] Successfully saved business insight: "${insight.title}" with id: ${createResult.id}`);

  const linked = await repository.linkInsightRun(executionId, insight.title, createResult.id);
  if (linked) {
    console.log(`🔗 [WorkflowPilot] Successfully linked insight_run to insight id: ${createResult.id}`);
  } else {
    console.error(`❌ [WorkflowPilot] Failed to link insight_run for "${insight.title}" (execution: ${executionId}, insight: ${createResult.id})`);
  }
}
```

**What to look for:**
- ✅ Success: `🔗 [WorkflowPilot] Successfully linked insight_run to insight id:`
- ❌ Failure: `❌ [WorkflowPilot] Failed to link insight_run for`

### 2. Enhanced Logging in InsightRepository

**File:** [lib/repositories/InsightRepository.ts](../lib/repositories/InsightRepository.ts:423-448)

**Added:**
```typescript
async linkInsightRun(executionId: string, title: string, insightId: string): Promise<boolean> {
  console.log(`[InsightRepository] Linking insight_run: execution=${executionId}, title="${title}", insight=${insightId}`);

  const { data, error } = await this.supabase
    .from('execution_insight_runs')
    .update({ insight_id: insightId })
    .eq('execution_id', executionId)
    .eq('title', title)
    .is('insight_id', null)
    .select();  // ✅ ADDED: Return updated rows

  if (!data || data.length === 0) {
    console.warn(`[InsightRepository] No matching insight_run found to link (execution=${executionId}, title="${title}")`);
    return false;
  }

  console.log(`[InsightRepository] Successfully linked ${data.length} insight_run(s) to insight ${insightId}`);
  return true;
}
```

**What to look for:**
- ✅ Success: `Successfully linked 1 insight_run(s)`
- ❌ No match: `No matching insight_run found to link`
- ❌ Error: Check the error message

---

## Testing Instructions

### 1. Run an Agent

Execute an agent that has 7+ runs (to trigger business insights with ROI).

### 2. Check Console Logs

Look for these log messages in order:

```
📝 [WorkflowPilot] Stored run snapshot for business insight: "..."
[InsightRepository] Linking insight_run: execution=..., title="...", insight=...
[InsightRepository] Successfully linked 1 insight_run(s) to insight ...
🔗 [WorkflowPilot] Successfully linked insight_run to insight id: ...
✅ [WorkflowPilot] Successfully saved business insight: "..." with id: ...
```

### 3. Check Database

**Query 1: Verify linking**
```sql
SELECT
  r.execution_id,
  r.title,
  r.insight_id,
  i.id as actual_insight_id,
  CASE
    WHEN r.insight_id = i.id THEN '✅ LINKED'
    WHEN r.insight_id IS NULL THEN '❌ NULL'
    ELSE '⚠️ MISMATCH'
  END as status
FROM execution_insight_runs r
LEFT JOIN execution_insights i ON r.title = i.title
WHERE r.created_at > NOW() - INTERVAL '1 hour'
ORDER BY r.created_at DESC
LIMIT 10;
```

**Expected:** All rows show `✅ LINKED`

**Query 2: Check for title mismatches**
```sql
SELECT
  r.title as run_title,
  i.title as insight_title,
  r.title = i.title as titles_match,
  LENGTH(r.title) as run_title_length,
  LENGTH(i.title) as insight_title_length
FROM execution_insight_runs r
LEFT JOIN execution_insights i ON r.execution_id = ANY(i.execution_ids)
WHERE r.created_at > NOW() - INTERVAL '1 hour'
  AND r.insight_id IS NULL;
```

**Expected:** `titles_match = true` for all rows

---

## Possible Failure Scenarios

### Scenario 1: Title Mismatch

**Symptom:**
```
[InsightRepository] No matching insight_run found to link
```

**Cause:** Title in `execution_insight_runs` doesn't exactly match title in the link call

**Fix:** Check for whitespace, encoding issues, or truncation

### Scenario 2: Race Condition

**Symptom:**
```
[InsightRepository] No matching insight_run found to link
```

**Cause:** `createInsightRun()` hasn't completed before `linkInsightRun()` is called

**Fix:** Ensure `createInsightRun()` is awaited (currently it is)

### Scenario 3: Already Linked

**Symptom:**
```
[InsightRepository] No matching insight_run found to link
```

**Cause:** The `.is('insight_id', null)` filter excludes already-linked rows

**Fix:** Check if insight_id is already populated (shouldn't happen on first run)

### Scenario 4: Database Error

**Symptom:**
```
[InsightRepository] Failed to link insight run: <error>
```

**Cause:** Supabase query error (permissions, schema mismatch, etc.)

**Fix:** Check error message, verify RLS policies allow UPDATE on execution_insight_runs

---

## Next Steps

1. **Run the agent** and capture console logs
2. **Share the logs** showing the linking sequence
3. **Run the SQL queries** to verify database state
4. **Report findings**:
   - If linking succeeds: ✅ Issue resolved
   - If linking fails: Share the specific error/warning message

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-06-01 | Created | Initial debugging guide for insight_id linking issue |
