# Field Extraction Investigation

## Problem Summary

The insight system is generating misleading insights because it's summing ALL step outputs (`total_items: 96`) instead of tracking the business metric step ("Filter Group 1" with 0 items).

### Root Cause Chain

```
1. StepExecutor tries to extract field_names from step results
   ↓
2. Field extraction logic FAILS (fieldNames array stays empty)
   ↓
3. Empty field_names stored in execution_metadata
   ↓
4. MetricsCollector can't populate items_by_field (stays {})
   ↓
5. MetricDetector can't use field-level data for detection
   ↓
6. System falls back to total_items (96) instead of detected metric (0)
   ↓
7. LLM receives wrong data → Generates misleading insights
```

---

## Investigation Steps

### Step 1: Verified Data Collection ✅

**File**: `lib/pilot/MetricsCollector.ts`

- ✅ Queries `execution_metadata` column (line 96)
- ✅ Includes zero-count steps (line 129)
- ✅ Attempts to populate `items_by_field` from field_names (lines 147-158)

**Result**: Code is correct, but data source is empty!

---

### Step 2: Checked Database Content ❌

**Query**: `workflow_step_executions` for recent execution

**Result**:
```json
{
  "execution_metadata": {
    "success": true,
    "itemCount": 20,
    "executedAt": "2026-02-04T23:08:00.596Z",
    "tokensUsed": 400,
    "executionTime": 4107
    // ❌ NO field_names property!
  }
}
```

**Problem**: `field_names` is NOT being stored in the database!

---

### Step 3: Traced Field Extraction Logic

**File**: `lib/pilot/StepExecutor.ts` (lines 475-482)

**Current Code**:
```typescript
let fieldNames: string[] = [];
if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'object' && result[0] !== null) {
  // Extract field names from first item (for UI preview)
  fieldNames = Object.keys(result[0]).slice(0, 10);
} else if (result && typeof result === 'object' && !Array.isArray(result)) {
  // For object results, get top-level keys
  fieldNames = Object.keys(result).slice(0, 10);
}
```

**Hypothesis**: The `result` variable doesn't match expected structure:
- Gmail plugin might return `{ success: true, data: [...] }`
- Transform steps might return wrapped results
- Some steps might return primitives or unexpected formats

---

### Step 4: Added Diagnostic Logging ✅

**File**: `lib/pilot/StepExecutor.ts` (lines 475-485)

**Changes**:
```typescript
if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'object' && result[0] !== null) {
  fieldNames = Object.keys(result[0]).slice(0, 10);
  console.log(`✅ [StepExecutor] Extracted ${fieldNames.length} field names from step ${step.id}:`, fieldNames);
} else if (result && typeof result === 'object' && !Array.isArray(result)) {
  fieldNames = Object.keys(result).slice(0, 10);
  console.log(`✅ [StepExecutor] Extracted ${fieldNames.length} fields from object result (step ${step.id}):`, fieldNames);
} else if (itemCount > 0) {
  // NEW: Log when we have items but no field extraction
  console.warn(`⚠️  [StepExecutor] Step ${step.id} (${step.name}) has ${itemCount} items but no field names extracted.`);
  console.warn(`    Result type: ${typeof result}, isArray: ${Array.isArray(result)}, hasData: ${result && 'data' in result}`);
}
```

**Purpose**: Identify WHY field extraction is failing without changing logic

---

## Next Steps (To Run After Execution)

### 1. Trigger One Execution

Run the agent from UI and check logs for:

```bash
# Expected logs:
✅ [StepExecutor] Extracted 5 field names from step gmail_step_id: ["from", "subject", "date", "snippet", "id"]

# OR if extraction fails:
⚠️  [StepExecutor] Step gmail_step_id (Fetch Gmail messages) has 20 items but no field names extracted.
    Result type: object, isArray: false, hasData: true
```

### 2. Analyze Log Output

**If we see "Extracted X field names"**:
- ✅ Extraction is working
- ❌ Storage might be failing in StateManager
- → Check StateManager.updateStepExecution() logic

**If we see "no field names extracted"**:
- ❌ Result structure doesn't match expected format
- → Need to add wrapper handling (check for `result.data`, `result.items`, etc.)

### 3. Fix Based on Findings

**Scenario A**: Extraction works, storage fails
- Fix: Update StateManager to properly store field_names in execution_metadata

**Scenario B**: Extraction fails, result is wrapped
- Fix: Add logic to unwrap `{ data: [...] }` pattern in StepExecutor

**Scenario C**: Different issue
- Investigate further based on log output

---

## Expected Outcome

After fixing field extraction:

### Database Will Have:
```json
{
  "execution_metadata": {
    "success": true,
    "itemCount": 20,
    "field_names": ["from", "subject", "date", "snippet", "id"],  // ✅ NOW POPULATED
    "executedAt": "2026-02-04T23:08:00.596Z",
    "tokensUsed": 400,
    "executionTime": 4107
  }
}
```

### MetricsCollector Will Populate:
```typescript
{
  items_by_field: {
    has_from: 20,
    has_subject: 20,
    has_date: 20,
    has_snippet: 20,
    has_id: 20
  },
  field_names: ["from", "subject", "date", "snippet", "id"]
}
```

### Insights Will Be Accurate:
- ✅ Tracks Filter Group 1 (0 items) instead of total (96 items)
- ✅ "Customer complaints remain near zero - excellent service quality"
- ❌ NOT "Customer complaint volume surged 420%"

---

## Safety Notes

**Why this change is safe**:
1. Only added logging (console.log / console.warn)
2. No logic changes - same conditions, same behavior
3. Logging only runs if existing conditions match
4. Won't affect execution flow or results
5. Can be removed after investigation

**Risk**: None - pure diagnostic code

---

## Timeline

1. ✅ Added diagnostic logging (DONE)
2. 🔄 Run one execution (NEXT - user action required)
3. 🔄 Check logs in console/terminal
4. 🔄 Identify root cause from log output
5. 🔄 Implement targeted fix
6. 🔄 Verify field_names appear in database
7. ✅ Insights will be accurate

---

## Status: WAITING FOR EXECUTION

**Action Required**: Run one production execution of agent `08eb9918-e60f-4179-a5f4-bc83b95fc15c` and check logs.

**Expected logs location**:
- Next.js terminal/console where the app is running
- Look for lines starting with `[StepExecutor]`
- Should appear during step execution (near "Step X completed" logs)
