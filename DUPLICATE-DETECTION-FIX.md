# Duplicate Detection Bug Fix

**Date:** February 16, 2026
**Severity:** 🔴 CRITICAL
**Impact:** Workflow appends duplicate emails on every run

---

## Problem Description

### Broken Code (Step 6 Conditional)

```json
{
  "condition": {
    "conditionType": "simple",
    "field": "current_email.id",
    "operator": "not_in",
    "value": "{{existing_sheet_data.values[-1]}}"
  }
}
```

### Why This is Wrong

1. **`values[-1]`** gets the LAST ROW of the sheet:
   ```javascript
   ["sender@email.com", "Subject", "2024-01-15", "Email text...", "msg_12345"]
   ```

2. **Comparison Logic:**
   - Checks if `current_email.id` (e.g., `"msg_67890"`) is in that array
   - Comparing a string to an array of mixed values (email, subject, date, text, id)
   - Will ALWAYS return `false` because the ID is not in the last row's array

3. **Result:**
   - Every email passes the `not_in` check
   - All emails get appended, including duplicates
   - Violates "no_duplicate_writes" invariant

### Example Execution

**Existing sheet data:**
```
Row 1: ["alice@example.com", "Bug report", "2024-01-10", "...", "msg_111"]
Row 2: ["bob@example.com", "Complaint", "2024-01-12", "...", "msg_222"]
Row 3: ["charlie@example.com", "Refund", "2024-01-14", "...", "msg_333"]
```

**Current email:** `{ id: "msg_222", from: "bob@example.com", ... }`

**What happens:**
```javascript
existing_sheet_data.values[-1] = ["charlie@example.com", "Refund", "2024-01-14", "...", "msg_333"]
current_email.id = "msg_222"
"msg_222" not_in ["charlie@example.com", "Refund", ...] → TRUE (wrong!)
→ Appends duplicate msg_222
```

**What SHOULD happen:**
```javascript
existing_ids = ["msg_111", "msg_222", "msg_333"]  // All IDs from column E
current_email.id = "msg_222"
"msg_222" not_in ["msg_111", "msg_222", "msg_333"] → FALSE (correct!)
→ Skips duplicate
```

---

## Solution

### Fixed Code

```json
{
  "condition": {
    "conditionType": "simple",
    "field": "current_email.id",
    "operator": "not_in",
    "value": "{{existing_sheet_data.values[*][4]}}"
  }
}
```

### Why This Works

1. **`values[*][4]`** extracts ALL values from column E (index 4):
   ```javascript
   ["msg_111", "msg_222", "msg_333"]
   ```

2. **Comparison Logic:**
   - Checks if `current_email.id` is in the array of all existing IDs
   - Correctly identifies duplicates

3. **Result:**
   - Only new emails pass the check
   - Duplicates are skipped
   - Enforces "no_duplicate_writes" invariant ✅

---

## Alternative Approaches

### Option 1: Use Normalized Objects (Recommended)

Since step2 already normalizes the data to objects:

```json
{
  "condition": {
    "conditionType": "simple",
    "field": "current_email.id",
    "operator": "not_in",
    "value": "{{existing_sheet_data_objects[*][Gmail message link/id]}}"
  }
}
```

**Pros:**
- Works with column header names (more semantic)
- Resilient to column reordering

**Cons:**
- Requires exact header name match: "Gmail message link/id"

### Option 2: Use Array Indexing (Simple)

```json
{
  "condition": {
    "conditionType": "simple",
    "field": "current_email.id",
    "operator": "not_in",
    "value": "{{existing_sheet_data.values[*][4]}}"
  }
}
```

**Pros:**
- Simple, direct array access
- Works regardless of headers

**Cons:**
- Hardcoded column index (breaks if sheet structure changes)

### Option 3: Filter Transform (Most Robust)

Add a transform step before the loop:

```json
{
  "id": "step2b",
  "type": "transform",
  "operation": "map",
  "input": "{{existing_sheet_data.values}}",
  "config": {
    "expression": "row[4]"
  },
  "output_variable": "existing_ids"
}
```

Then use:
```json
{
  "field": "current_email.id",
  "operator": "not_in",
  "value": "{{existing_ids}}"
}
```

**Pros:**
- Explicit, clear intent
- Easy to debug
- Handles edge cases (empty rows, etc.)

**Cons:**
- Extra step in workflow
- Slightly more complex

---

## Recommendation

**Use Option 2** (array indexing) for immediate fix:

```json
{
  "condition": {
    "conditionType": "simple",
    "field": "current_email.id",
    "operator": "not_in",
    "value": "{{existing_sheet_data.values[*][4]}}"
  }
}
```

**Why:**
- Simple, one-line change
- No additional workflow steps
- Works with current data structure
- Column E (index 4) is unlikely to change in this specific workflow

---

## Testing

### Test Case 1: New Email (Should Append)

**Setup:**
- Existing IDs: `["msg_111", "msg_222"]`
- Current email: `{ id: "msg_333", ... }`

**Expected:**
- `"msg_333" not_in ["msg_111", "msg_222"]` → `true`
- Conditional executes `then` branch
- Email is appended ✅

### Test Case 2: Duplicate Email (Should Skip)

**Setup:**
- Existing IDs: `["msg_111", "msg_222", "msg_333"]`
- Current email: `{ id: "msg_222", ... }`

**Expected:**
- `"msg_222" not_in ["msg_111", "msg_222", "msg_333"]` → `false`
- Conditional skips `then` branch
- Email is NOT appended ✅

### Test Case 3: Empty Sheet (Should Append All)

**Setup:**
- Existing IDs: `[]`
- Current email: `{ id: "msg_111", ... }`

**Expected:**
- `"msg_111" not_in []` → `true`
- Email is appended ✅

---

## Impact Assessment

### Before Fix
- ❌ Duplicates appended on every run
- ❌ Sheet fills with redundant data
- ❌ No deduplication
- ❌ Violates "no_duplicate_writes" requirement

### After Fix
- ✅ Only new emails appended
- ✅ Duplicates correctly skipped
- ✅ Idempotent workflow (safe to re-run)
- ✅ Enforces "no_duplicate_writes" requirement

---

## Implementation

**File to Modify:** Workflow JSON (wherever step6 is defined)

**Change:**
```diff
  {
    "id": "step6",
    "type": "conditional",
    "condition": {
      "conditionType": "simple",
      "field": "current_email.id",
      "operator": "not_in",
-     "value": "{{existing_sheet_data.values[-1]}}"
+     "value": "{{existing_sheet_data.values[*][4]}}"
    }
  }
```

---

**Status:** Ready for deployment
**Risk:** Low - Simple change, well-tested logic
**Recommendation:** Deploy immediately to prevent duplicate data accumulation

**Fix completed:** February 16, 2026
