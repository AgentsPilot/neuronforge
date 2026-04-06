# CRITICAL: Workflow Sequence Bugs - February 9, 2026

## Summary

The compiled workflow has **CRITICAL sequence errors** that will cause runtime failures. These are NOT validator issues - these are **real compiler bugs**.

---

## Bug #1: Conditional Before Data Extraction ❌

### The Problem

```
Step 5: Extract Original Items (emails)
Step 7: Conditional (check if amount > 50)  ← CHECKS AMOUNT
Step 8: Extract Attachments                 ← GETS ATTACHMENTS
Step 11: Loop AI Extraction                 ← EXTRACTS AMOUNT
Step 12: Flatten AI Results                 ← MAKES AMOUNT AVAILABLE
```

**Issue:** Step 7 checks `amount > 50` but `amount` doesn't exist until Step 12!

### Current Workflow Order (WRONG)
```json
{
  "id": "step7",
  "name": "Conditional: branching logic",
  "input": "{{step5.data}}",  ← Data from emails (no amount field yet!)
  "config": {
    "condition": {
      "conditions": [
        {
          "field": "amount",           ← AMOUNT DOESN'T EXIST YET
          "operator": "greater_than",
          "value": 50
        }
      ]
    },
    "then": [],  ← EMPTY - does nothing
    "else": []   ← EMPTY - does nothing
  }
}
```

### Correct Order Should Be
```
Step 5: Extract Original Items (emails)
Step 8: Extract Attachments
Step 11: Loop AI Extraction (extract amount from PDFs)
Step 12: Flatten AI Results (amount now available)
Step 7: Conditional (NOW can check amount > 50)
Step 17: Execute Deliveries (conditional applied)
```

### Impact
- **Runtime Error:** Conditional will fail because `amount` field is undefined
- **Logic Error:** Even if it doesn't crash, the conditional evaluates before data exists (always false)

---

## Bug #2: Useless Conditional (Empty Actions) ❌

### The Problem

```json
{
  "id": "step7",
  "config": {
    "condition": {...},
    "then": [],  ← NO ACTIONS
    "else": []   ← NO ACTIONS
  }
}
```

**Issue:** The conditional checks a condition but does nothing regardless of result.

### Expected Behavior

The conditional should filter which items go to Google Sheets:
- **If amount > 50 AND amount is not empty:** Append to Sheets
- **Always:** Send email digest and store in Drive

### How This Should Be Implemented

**Option A: Post-AI Filter (Current IR Pattern)**
```json
// After step 12 (Flatten AI Results)
{
  "id": "step13",
  "name": "Filter High-Value Items",
  "type": "transform",
  "operation": "filter",
  "input": "{{step12.data}}",
  "config": {
    "condition": "(item.amount > 50) && (item.amount != null)"
  },
  "output_variable": "high_value_items"
}

// Then in parallel delivery:
{
  "id": "step16",
  "name": "Append to Sheets",
  "plugin": "google-sheets",
  "action": "append_rows",
  "input": "{{high_value_items}}"  ← Only high-value items
}
```

**Option B: Conditional Routing**
```json
{
  "id": "step13",
  "type": "conditional",
  "input": "{{step12.data}}",
  "config": {
    "condition": {
      "conditions": [
        {"field": "amount", "operator": "greater_than", "value": 50},
        {"field": "amount", "operator": "is_not_empty"}
      ]
    },
    "then": [
      {
        "id": "step14",
        "name": "Append High-Value to Sheets",
        "plugin": "google-sheets",
        "action": "append_rows",
        "input": "{{current_item}}"
      }
    ],
    "else": []  // Skip Sheets for low-value items
  }
}
```

### Impact
- **Wasted Computation:** Conditional evaluates but has no effect
- **Missing Logic:** Sheets will get ALL items, not just amount > 50

---

## Bug #3: Drive Operations in Parallel (Will Fail) ❌

### The Problem

```json
{
  "id": "step17",
  "type": "parallel",
  "steps": [
    {"id": "step13", "action": "create_folder_message"},  ← Creates folder
    {"id": "step14", "action": "upload_file_message"},     ← Needs folder_id
    {"id": "step15", "action": "share_file_message"}       ← Needs file_id
  ]
}
```

**Issue:** All three run simultaneously, but:
- `upload_file` needs `folder_id` from `create_folder`
- `share_file` needs `file_id` from `upload_file`

### Expected Behavior

These must run **sequentially** (one after another):

```json
{
  "id": "step13",
  "name": "Create Vendor Folder",
  "action": "create_folder_message",
  "output_variable": "folder_result"
},
{
  "id": "step14",
  "name": "Upload PDF to Folder",
  "action": "upload_file_message",
  "params": {
    "folder_id": "{{folder_result.folder_id}}"  ← Dependency
  },
  "output_variable": "file_result"
},
{
  "id": "step15",
  "name": "Share File",
  "action": "share_file_message",
  "params": {
    "file_id": "{{file_result.file_id}}"  ← Dependency
  },
  "output_variable": "share_result"
}
```

### Impact
- **Runtime Error:** `upload_file` will fail with "folder_id is undefined"
- **Race Condition:** Even if params exist, parallel execution has no guaranteed order

---

## Bug #4: Missing Data Flow (No drive_link Capture) ⚠️

### The Problem

```json
{
  "id": "step15",
  "name": "Share File",
  "action": "share_file_message",
  "output_variable": "share_result"  ← Produces drive_link
}
// ... but nothing captures share_result.web_view_link
```

**Issue:** The `share_file` action produces a `drive_link` (or `web_view_link`), but there's no transform step to add it to the data that goes to email/sheets.

### Expected Behavior

After each file is shared, capture the link and add it to the item:

```json
{
  "id": "step15",
  "name": "Share File",
  "action": "share_file_message",
  "output_variable": "share_result"
},
{
  "id": "step16",
  "name": "Capture Drive Link",
  "type": "transform",
  "operation": "map",
  "input": "{{current_data}}",
  "config": {
    "expression": "item.map(row => ({...row, drive_link: share_result.web_view_link}))"
  }
}
```

### Impact
- **Missing Data:** Email digest and Sheets will have empty `drive_link` column
- **User Confusion:** Users can't access the files stored in Drive

---

## Root Cause Analysis

### Why These Bugs Exist

1. **Compiler Pattern Detection is Naive**
   - Sees `multiple_destinations` → assumes parallel execution
   - Doesn't check for `{{step_result.*}}` dependencies in IR
   - Doesn't respect sequential markers from Phase 3

2. **Conditional Logic Not Fully Compiled**
   - IR has `post_ai_filters` with `amount > 50` condition
   - Compiler creates conditional step but doesn't populate `then`/`else` actions
   - Missing logic to convert filter into conditional routing

3. **No Step Ordering Validation**
   - Compiler places conditional (step7) before data exists (step12)
   - No validation that input data has required fields
   - No topological sort of dependencies

4. **Data Flow Not Tracked**
   - Compiler doesn't track which actions produce fields
   - Doesn't create capture steps for action outputs
   - Missing transform steps to merge results back into data

---

## Validation Results (Correct!)

The DSL validator **correctly identified** these issues:

| Issue | Validator Result | Correct? |
|-------|------------------|----------|
| Drive operations in parallel | ⚠️ Sequential dependency not preserved | ✅ YES - real bug |
| Conditional before data | (Not checked by current validators) | N/A |
| Empty conditional actions | ✅ Preserved (found conditional step) | ⚠️ False positive |
| Missing drive_link capture | ✅ Preserved (found share_file action) | ⚠️ False positive |

**Score: 83/100 (5/6 requirements)**
- 1 requirement correctly failing (R2: sequential)
- 2 requirements false positives (R3, R5 - they exist but won't work)

---

## Next Steps to Fix

### Immediate (High Priority)

1. **Fix Step Ordering**
   - Move conditional AFTER AI extraction (after step12)
   - Ensure data exists before being checked

2. **Fix Sequential Drive Operations**
   - Check IR for `{{step_result.*}}` references
   - If dependencies exist, compile as sequential steps
   - DO NOT wrap in parallel block

3. **Populate Conditional Actions**
   - Convert `post_ai_filters` into filter step OR
   - Add actions to conditional.then (append to Sheets)
   - Apply conditional selectively (only Sheets, not Drive/Email)

4. **Add Data Capture Steps**
   - After `share_file`, capture `web_view_link`
   - Add transform step to merge into data
   - Ensure drive_link available for email/sheets

### Medium Priority

5. **Add Compiler Validation**
   - Validate step input references exist before step runs
   - Validate action dependencies (folder_id, file_id)
   - Topological sort of steps based on dependencies

6. **Enhance DSL Validator**
   - Check conditional has non-empty actions
   - Check step input fields exist at that point in workflow
   - Check action dependencies are satisfied

---

## Current Status

**Pipeline Score: 94/100 ✅** (above 80% threshold)

However, **the workflow will FAIL at runtime** due to:
1. Conditional checks non-existent field
2. Drive operations have unmet dependencies
3. Missing data capture for drive_link

**Validator is working correctly** - it caught the main issue (parallel Drive ops). The other issues need additional validation rules.

---

## Recommended Action

**DO NOT deploy this workflow** - it will fail at runtime.

Priority:
1. Fix DeclarativeCompiler to respect sequential dependencies
2. Fix step ordering (conditional after extraction)
3. Add data capture steps
4. Re-test and re-validate

**Status:** ⚠️ **CRITICAL BUGS IDENTIFIED - DO NOT DEPLOY**
