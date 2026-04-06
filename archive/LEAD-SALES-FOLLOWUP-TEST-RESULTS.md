# Lead Sales Follow-up Workflow Test Results

**Date:** 2026-03-05
**Test:** Complete V6 Pipeline with Vocabulary Injection
**Workflow:** High-Quality Lead Checker + Sales Follow-up Agent

## ✅ SUCCESSES

### 1. Payload Field Now Working! ✅
**Issue Previously:** Step 1 was missing the `range` parameter for Google Sheets read_range
**Status:** **FIXED**

**Step 1 Config:**
```json
{
  "step_id": "step1",
  "type": "action",
  "plugin": "google-sheets",
  "operation": "read_range",
  "config": {
    "spreadsheet_id": "{{config.google_sheet_id}}",
    "range": "{{config.sheet_tab_name}}"           // ✅ NOW PRESENT!
  },
  "output_variable": "lead_rows"
}
```

**IntentContract (lines 72-80):**
```json
{
  "id": "fetch_lead_rows",
  "kind": "data_source",
  "payload": {                                      // ✅ LLM now uses payload!
    "spreadsheet_id": {"kind": "config", "key": "google_sheet_id"},
    "tab_name": {"kind": "config", "key": "sheet_tab_name"}
  }
}
```

**What Fixed It:**
1. ✅ Added payload processing to `buildDataSourceParams()` (IntentToIRConverter.ts:322-329)
2. ✅ Updated system prompt with generic guidance on `payload` vs `query` (intent-system-prompt-v2.ts:187-228)
3. ✅ LLM now correctly generates `payload` instead of `query` for structured parameters

### 2. Classify Step Handler Added ✅
**Status:** Classify steps now compile to AI processing operations

**Step 3 - AI Classification:**
```json
{
  "step_id": "step3",
  "type": "ai_processing",
  "prompt": "Classify each item into one of these categories: high_quality, low_quality...",
  "config": {
    "ai_type": "classify",
    "output_schema": {
      "type": "array",
      "items": {
        "properties": {
          "quality_classification": {
            "enum": ["high_quality", "low_quality"]
          }
        }
      }
    }
  }
}
```

**What Was Added:**
- IntentToIRConverter.ts:268 - Added case handler for 'classify'
- IntentToIRConverter.ts:1050-1095 - Implemented `convertClassify()` method

---

## ❌ CRITICAL ISSUES CONFIRMED

### Issue #1: AI Classification When Simple Filter Needed 🚨

**The Problem:**
The enhanced prompt says "**Classify** a lead as high-quality if its score is greater than or equal to the user-provided threshold value."

This is **MISLEADING** the LLM! The workflow should just **FILTER** rows where the **Stage column >= 4** (data already in spreadsheet), NOT use AI to classify anything.

**What Actually Happens:**
- **Step 3**: AI classification step added (UNNECESSARY - wastes tokens/time)
  ```json
  {
    "type": "ai_processing",
    "prompt": "Classify each item into one of these categories: high_quality, low_quality..."
  }
  ```
- **Step 4**: Filter based on AI classification result
  ```json
  {
    "type": "transform",
    "operation": "filter",
    "condition": {"field": "item.quality_classification", "operator": "eq", "value": "high_quality"}
  }
  ```

**What SHOULD Happen:**
- **Step 2**: Filter rows directly based on Stage column value
  ```json
  {
    "type": "transform",
    "operation": "filter",
    "condition": {
      "field": "item.Stage",
      "operator": "gte",
      "value": "{{config.score_threshold}}"
    }
  }
  ```

**Root Cause:**
- Enhanced prompt uses wrong terminology: "**Classify**" instead of "**Filter**"
- The Stage column already exists in the spreadsheet with numeric scores
- No AI classification is needed - it's just a comparison operation

**User's Correct Analysis:**
> "the stage is in the spreadsheet column so why using AI. IT will not understand in execution that high quality is above 4"

**Fix Required:**
Update [enhanced-prompt-lead-sales-followup.json](enhanced-prompt-lead-sales-followup.json) to change:
```json
"actions": [
  "- Classify a lead as high-quality if its score is greater than or equal to the user-provided threshold value."
]
```
To:
```json
"actions": [
  "- Filter lead rows to keep only those where the Stage column value is greater than or equal to 4 (high-quality leads)."
]
```

---

### Issue #2: Transform Steps with Custom Code (NOT EXECUTABLE) 🚨

**The Problem:**
Transform steps generate `custom_code` descriptions but the runtime has no mechanism to execute them.

#### Step 5 - Map Operation (NOT EXECUTABLE)
```json
{
  "step_id": "step5",
  "type": "transform",
  "operation": "map",
  "config": {
    "custom_code": "Add resolved_email field to each lead based on Sales Person column and mapping configuration"
    // ❌ Runtime cannot execute this string description
  }
}
```

**What This Step Needs To Do:**
1. Check if `config.sales_person_is_email` is true
2. If true: Use Sales Person column value directly as `resolved_email`
3. If false: Lookup Sales Person value in `config.sales_person_email_mapping` to get email

**Why It's Not Executable:**
- The description is just a string - runtime has no conditional logic interpreter
- No declarative syntax for "if sales_person_is_email then X else Y"
- No lookup operation syntax in transform schema

#### Step 9 - Group Operation (NOT EXECUTABLE)
```json
{
  "step_id": "step9",
  "type": "transform",
  "operation": "group",
  "config": {
    "custom_code": "Group leads by resolved_email field to create per-salesperson collections"
    // ❌ Runtime doesn't know which field to group by
  }
}
```

**What's Missing:**
- No `group_by` field specified (e.g., `"group_by": "resolved_email"`)
- Runtime cannot parse the description string to extract "resolved_email"

**Why This Happens:**
- V6 pipeline is designed to be **deterministic** (no custom code execution)
- IntentContract schema doesn't support declarative expressions for:
  - Conditional field computation
  - Dynamic field selection based on config
  - Lookup operations from config values

**User's Correct Analysis:**
> "deterministic will force us to use fuzzy logic which won't scale"

**Possible Solutions:**
1. **Add JS executor to runtime** (violates deterministic principle)
2. **Expand declarative schema** (major redesign to support conditionals, lookups)
3. **Use AI for these operations** (expensive, slower)
4. **Fix at IntentContract generation** (LLM should break down into executable primitive operations)

---

## 📊 Test Statistics

### Performance
- **Intent Generation (LLM):** 47,656ms (~48 seconds)
- **Deterministic Pipeline:** 183ms
  - Binding: 183ms
  - IR Conversion: 2ms
  - IR Compilation: N/A (included in binding)
- **Total Pipeline Time:** 47,839ms

### Binding Results
- **Intent Steps:** 8
- **Successful Bindings:** 1
  - ✅ fetch_lead_rows → google-sheets.read_range
- **Failed Bindings:** 7
  - ⚠️ classify_leads (kind: classify - no binding needed, internal AI)
  - ⚠️ filter_high_quality (kind: transform - no binding needed)
  - ⚠️ resolve_sales_person_emails (kind: transform - no binding needed)
  - ⚠️ split_resolvable_leads (kind: aggregate - no binding needed)
  - ⚠️ group_by_sales_person (kind: transform - no binding needed)
  - ⚠️ process_sales_person_groups (kind: loop - no binding needed)
  - ⚠️ check_unresolvable_leads (kind: decide - no binding needed)
- **Binding Success Rate:** 12.5% (only counting steps that need plugin binding)

### Compilation Results
- **IR Version:** 4.0
- **Total Nodes:** 18
- **PILOT Steps Generated:** 17
- **Warnings:** 2

---

## 🔍 Detailed PILOT DSL Analysis

### Steps Overview
1. **step1** - ✅ Action: google-sheets.read_range (EXECUTABLE)
2. **step2** - ✅ Transform: rows_to_objects (EXECUTABLE - auto-normalize)
3. **step3** - ⚠️ AI Processing: classify (UNNECESSARY - should be filter)
4. **step4** - ✅ Transform: filter by quality_classification (EXECUTABLE but depends on step3)
5. **step5** - ❌ Transform: map with custom_code (NOT EXECUTABLE)
6. **step6** - ✅ Transform: filter for resolvable_leads (EXECUTABLE)
7. **step7** - ✅ Transform: filter for unresolvable_leads (EXECUTABLE)
8. **step8** - ✅ Transform: reduce to count (EXECUTABLE)
9. **step9** - ❌ Transform: group with custom_code (NOT EXECUTABLE)
10. **step10** - ✅ Scatter/Gather: loop over grouped_leads (EXECUTABLE)
    - **step11** - ✅ AI Processing: generate HTML table (EXECUTABLE)
    - **step12** - ✅ AI Processing: generate email content (EXECUTABLE)
    - **step13** - ✅ Action: google-mail.send_email (EXECUTABLE)
11. **step14** - ✅ Conditional: check unresolvable_leads (EXECUTABLE)
    - **step15** - ✅ AI Processing: generate HTML table (EXECUTABLE)
    - **step16** - ✅ AI Processing: generate email content (EXECUTABLE)
    - **step17** - ✅ Action: google-mail.send_email (EXECUTABLE)

### Executability Summary
- **Fully Executable:** 13 steps (76%)
- **Not Executable:** 2 steps (12%) - step5, step9
- **Unnecessary AI:** 1 step (6%) - step3

---

## 📋 Next Steps

### Immediate Actions Required

1. **Update Enhanced Prompt** 🔴 PRIORITY 1
   - File: `enhanced-prompt-lead-sales-followup.json`
   - Change "Classify" to "Filter" in actions section
   - Make it clear Stage column exists in spreadsheet
   - Specify to filter where Stage >= 4

2. **Fix Transform Executability** 🔴 PRIORITY 2
   - **Option A (Quick Fix):** Update IntentContract generation prompt to break down map/group operations into declarative primitives
   - **Option B (Long-term):** Extend transform schema to support:
     - Conditional field computation: `{"if": condition, "then": value, "else": value}`
     - Config lookups: `{"lookup": {"from": "config.mapping", "key": "field_value"}}`
     - Group by field: `{"group_by": "field_name"}`

3. **Re-test After Fixes**
   - Update enhanced prompt
   - Re-run full pipeline test
   - Verify Step 3 becomes a simple filter operation
   - Verify Step 5 and Step 9 become executable (or broken down differently)

---

## 🎯 Key Learnings

### What's Working Well ✅
1. **Payload processing** - LLM now correctly uses `payload` for structured parameters
2. **Vocabulary guidance** - LLM selects correct domains/capabilities
3. **Schema-driven compilation** - Most operations compile cleanly to PILOT DSL
4. **Auto-normalization** - Compiler automatically adds rows_to_objects transform

### What Needs Improvement ❌
1. **Enhanced prompt terminology** - "Classify" is misleading when it's just a filter
2. **Transform executability gap** - custom_code strings are not executable
3. **Declarative schema limitations** - No support for conditionals, lookups, or complex transformations
4. **LLM guidance** - Need to guide LLM to use primitive operations instead of complex transforms

### Architectural Insights 💡
1. **Deterministic pipeline is strong** - 183ms for all deterministic phases is excellent
2. **LLM generation is the bottleneck** - 48 seconds for IntentContract generation
3. **Compiler is robust** - Handles 18 nodes cleanly with good error messages
4. **Runtime will fail on execution** - Steps 5 and 9 cannot execute with current runtime

---

## 🚨 Blocker Status

### Blocking Issues
1. **Enhanced prompt misleading LLM** - Causes unnecessary AI classification step
2. **Transform steps not executable** - Steps 5 and 9 will fail at runtime

### Non-Blocking Issues
- None currently

### Previously Fixed Issues ✅
1. ✅ Missing range parameter (FIXED - payload now processed)
2. ✅ Missing classify step handler (FIXED - convertClassify added)
3. ✅ LLM using query instead of payload (FIXED - prompt updated)
