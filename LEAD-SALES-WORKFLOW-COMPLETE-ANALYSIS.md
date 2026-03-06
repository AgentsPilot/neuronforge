# Lead Sales Follow-up Workflow - Complete End-to-End Analysis

**Date:** 2026-03-05
**Test:** V6 Pipeline with Updated System Prompt
**Workflow:** High-Quality Lead Checker + Sales Follow-up Agent

---

## Executive Summary

### 🎯 KEY FINDINGS

| Metric | Before (Original) | After (Improved) | Status |
|--------|-------------------|------------------|--------|
| **AI Classification Step** | ✅ Present (Step 3) | ❌ **STILL PRESENT** | 🔴 **NOT FIXED** |
| **Step Type** | `kind: "classify"` | `kind: "transform"` | 🟡 **PARTIAL** |
| **Transform Custom Code** | 2 steps | **4 steps** | 🔴 **WORSE** |
| **Range Parameter** | ✅ Present | ✅ Present | ✅ **GOOD** |
| **Payload Processing** | ✅ Working | ✅ Working | ✅ **GOOD** |
| **Total PILOT Steps** | 17 | 10 | ✅ **BETTER** |
| **Executability Rate** | 76% (13/17) | **60% (6/10)** | 🔴 **WORSE** |

### 🚨 CRITICAL ISSUE: LLM Did NOT Follow New Guidance

The system prompt improvements **did NOT achieve the desired outcome**:

1. ❌ **Still using AI for field comparison** - Step 2 (`classify_leads_by_score`) uses transform/map instead of simple filter
2. ❌ **More custom_code, not less** - Increased from 2 to 4 non-executable transforms
3. ❌ **Executability decreased** - From 76% to 60%

---

## Phase-by-Phase Analysis

### Phase 0: Vocabulary Extraction ✅

**Status:** SUCCESS
- **Domains extracted:** 6 (document, email, internal, storage, table, web)
- **Capabilities extracted:** 15
- **Plugins in vocabulary:** 5 (google-sheets, google-mail, google-drive, chatgpt-research, document-extractor)
- **Performance:** ~280ms

**Assessment:** Working as expected

---

### Phase 1: IntentContract Generation 🟡

**Status:** PARTIAL SUCCESS
- **Generation time:** 58.1 seconds (vs 47.6 seconds before)
- **Steps generated:** 8 (vs 8 before)
- **JSON validation:** PASSED
- **Contract version:** intent.v1 ✅

#### Step-by-Step Breakdown

**Step 1: fetch_lead_rows** ✅ CORRECT
```json
{
  "kind": "data_source",
  "payload": {
    "spreadsheet_id": {"kind": "config", "key": "google_sheet_id"},
    "tab_name": {"kind": "config", "key": "sheet_tab_name"}
  }
}
```
**Analysis:**
- ✅ Correct use of `payload` for structured parameters
- ✅ Binds to google-sheets.read_range
- ✅ Will compile with `range` parameter

---

**Step 2: classify_leads_by_score** 🔴 WRONG
```json
{
  "id": "classify_leads_by_score",
  "kind": "transform",               // ❌ Should be "transform" with filter
  "summary": "Add high_quality field based on score threshold comparison",
  "transform": {
    "op": "map",                      // ❌ Should be "filter" not "map"
    "description": "Add high_quality boolean field by comparing score column to threshold",
    "output_schema": {...}            // ❌ Has schema but NO executable logic
  }
}
```

**Problems:**
1. ❌ **Wrong operation** - Uses `map` to add a field, should use `filter` to select existing rows
2. ❌ **Misunderstanding the task** - Thinks it needs to ADD high_quality field, when it should just FILTER by existing score field
3. ❌ **No executable logic** - Has description but no transformation expression
4. ❌ **AI alternative not considered** - Could use GENERATE if map needed, but didn't

**What LLM Should Have Generated:**
```json
{
  "kind": "transform",
  "transform": {
    "op": "filter",
    "where": {
      "op": "test",
      "left": {"kind": "ref", "ref": "lead_rows", "field": "score"},
      "comparator": "gte",
      "right": {"kind": "config", "key": "score_threshold"}
    }
  }
}
```

**Why It Failed:**
- LLM interpreted "classify" from step name as needing to add categorization field
- Didn't check if score field exists in data source
- New system prompt guidance didn't override this interpretation

---

**Step 3: filter_high_quality_leads** 🟡 PARTIAL
```json
{
  "kind": "transform",
  "transform": {
    "op": "filter",
    "where": {
      "op": "test",
      "left": {"kind": "ref", "ref": "classified_leads", "field": "high_quality"},
      "comparator": "eq",
      "right": {"kind": "literal", "value": true}
    }
  }
}
```

**Analysis:**
- ✅ Correct use of filter with structured where condition
- ✅ Has executable configuration
- ⚠️ But filtering on **wrong field** - should filter on `score`, not `high_quality`
- ⚠️ Depends on Step 2 which is non-executable

---

**Step 4: resolve_sales_person_emails** 🔴 WRONG
```json
{
  "kind": "transform",
  "transform": {
    "op": "map",
    "description": "Add resolved_email field using sales_person_is_email flag and mapping config",
    "output_schema": {...}
  }
}
```

**Problems:**
- ❌ **Custom_code only** - Has description, no executable logic
- ❌ **Conditional logic needed** - Requires if/else (not supported declaratively)
- ❌ **Didn't decompose** - Should have broken into:
  1. Filter subset where sales_person_is_email = true
  2. Filter subset where sales_person_is_email = false
  3. Map first subset (direct assignment)
  4. Map second subset with GENERATE (lookup from config)
  5. Merge subsets
- ❌ **Didn't use GENERATE** - Could have used single GENERATE step as alternative

**Why New Guidance Didn't Help:**
- Guidance said "break into primitives OR use GENERATE"
- LLM chose neither approach
- Still generated description-only transform

---

**Steps 5-8: Other Steps** 🟡 MIXED
- **Step 5:** aggregate (subset splitting) - ✅ Correct
- **Step 6:** transform/group - 🔴 Has custom_code, no group_by field
- **Step 7:** loop with 4 sub-steps - ✅ Structure correct
- **Step 8:** decide (conditional) with 4 sub-steps - ✅ Structure correct

---

### Phase 2: Capability Binding ✅

**Status:** SUCCESS
- **Binding time:** 223ms
- **Steps bound:** 8/15 = 53%
- **Key bindings:**
  - ✅ fetch_lead_rows → google-sheets.read_range
  - ✅ generate_* steps → chatgpt-research.answer_question
  - ✅ send_* steps → google-mail.send_email

**Assessment:** Binding working correctly for steps with capability requirements

---

### Phase 3: IR Conversion ✅

**Status:** SUCCESS
- **Conversion time:** 2ms
- **Nodes generated:** 19
- **Warnings:** 2
- **Schema fixes:** 0

**Assessment:** Conversion fast and error-free

---

### Phase 4: PILOT DSL Compilation 🔴

**Status:** FAILURE (Executability Issues)
- **Compilation time:** ~30ms
- **Steps generated:** 10 (vs 17 before)
- **Steps with custom_code:** 4 (vs 2 before) ← **WORSE**

#### PILOT DSL Steps Analysis

**Step 1:** ✅ Action - google-sheets.read_range
- **Config:** ✅ Has `spreadsheet_id` and `range`
- **Executable:** YES

**Step 2:** ✅ Transform - rows_to_objects (auto-normalize)
- **Executable:** YES

**Step 3:** ❌ Transform - map with custom_code
```json
{
  "operation": "map",
  "config": {
    "custom_code": "Add high_quality boolean field by comparing score column to threshold"
  }
}
```
- **Executable:** NO
- **Problem:** Runtime cannot execute description string

**Step 4:** ❌ Transform - filter with custom_code
```json
{
  "operation": "filter",
  "config": {
    "custom_code": "Keep only leads where high_quality is true",
    "condition": {"operator": "eq", "field": "item.high_quality", "value": true}
  }
}
```
- **Executable:** PARTIAL (has condition but also has conflicting custom_code)
- **Problem:** Condition references `high_quality` field that doesn't exist (Step 3 didn't create it)

**Step 5:** ❌ Transform - map with custom_code
```json
{
  "operation": "map",
  "config": {
    "custom_code": "Add resolved_email field using sales_person_is_email flag and mapping config"
  }
}
```
- **Executable:** NO
- **Problem:** Requires conditional logic, lookups - not supported

**Step 6-7:** ✅ Transform - filter (subset splitting)
- **Executable:** YES

**Step 8:** ❌ Transform - group with custom_code
```json
{
  "operation": "group",
  "config": {
    "custom_code": "Group leads by resolved_email field to create per-salesperson collections"
  }
}
```
- **Executable:** NO
- **Problem:** No `group_by` field specified

**Step 9:** ✅ Scatter/Gather - loop with 5 sub-steps
- Sub-steps are all AI/action operations
- **Executable:** YES

**Step 10:** ✅ Conditional - decide with 4 sub-steps
- **Executable:** YES

---

## Detailed Comparison: Before vs After

### IntentContract Quality

| Aspect | Before | After | Change |
|--------|--------|-------|--------|
| Step type for classification | `classify` | `transform` | 🟡 Improvement but not enough |
| Use of AI for field comparison | Yes (classify) | Yes (map) | 🔴 Same problem, different form |
| Payload for data_source | ✅ Present | ✅ Present | ✅ Same (good) |
| Transform with structured config | Some | Some | 🟢 Slight improvement |
| Transform with custom_code only | 2 | 3 | 🔴 Worse |

### PILOT DSL Quality

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Total steps | 17 | 10 | ✅ Simpler workflow |
| Steps with custom_code | 2 (12%) | 4 (40%) | 🔴 Much worse |
| Fully executable steps | 13 (76%) | 6 (60%) | 🔴 Worse |
| AI processing steps | 7 | 5 | ✅ Fewer (but not for right reason) |
| Action steps | 3 | 1 | ⚠️ Simpler but less functional |

### Executability Issues

**Before:**
- Step 3: flatten with custom_code (❌)
- Step 10: filter with custom_code (❌)
- **2 non-executable steps out of 17 (12%)**

**After:**
- Step 3: map with custom_code (❌)
- Step 4: filter with custom_code (partially ❌)
- Step 5: map with custom_code (❌)
- Step 8: group with custom_code (❌)
- **4 non-executable steps out of 10 (40%)**

---

## Root Cause Analysis

### Why Didn't the System Prompt Improvements Work?

#### 1. LLM Misinterpreted the Task
**Problem:** LLM saw step name "classify_leads_by_score" in enhanced prompt and thought:
- "I need to ADD a high_quality field by comparing score to threshold"
- Instead of: "I need to FILTER existing rows where score >= threshold"

**Why:** The enhanced prompt has this action:
```json
"actions": [
  "- Classify a lead as high-quality if its score is greater than or equal to the user-provided threshold value."
]
```

The word **"Classify"** is still misleading, even though system prompt added guidance.

#### 2. System Prompt Guidance Was Too Weak
**What We Added:**
- "Check if field exists before choosing step type"
- "Use filter for comparisons"
- "Don't use classify for field comparisons"

**Why It Failed:**
- LLM prioritizes **user prompt language** ("classify") over **system prompt guidance**
- Enhanced prompt is more specific and concrete than system guidance
- System guidance was advisory, not imperative

#### 3. Map vs Filter Confusion
**Problem:** LLM generated `transform/map` to "add high_quality field"

**Why:** LLM interpreted the task as:
1. Read leads (has score field)
2. Add new field (high_quality = score >= threshold)
3. Filter by new field

Instead of:
1. Read leads (has score field)
2. Filter by score field directly

**Root Cause:** LLM didn't understand that filtering can be done on existing fields without adding computed fields first.

#### 4. Decomposition Guidance Not Applied
**Problem:** Step 5 (resolve_sales_person_emails) still has custom_code

**Why:**
- System prompt says "break into primitives OR use GENERATE"
- LLM didn't apply either approach
- Possible reasons:
  - Didn't recognize the complexity
  - Doesn't know HOW to decompose
  - Didn't want to create many steps (trying to be concise)

---

## What Actually Needs to Change

### Option 1: Fix the Enhanced Prompt (User Content)
**Problem:** User provided "Classify a lead as high-quality..."
**Solution:** Change to "Filter lead rows where Stage >= 4"

**Pros:**
- Would fix this specific workflow immediately
- Clear and unambiguous

**Cons:**
- ❌ You explicitly said "I do not want to make any changes to the enhanced prompt creation"
- ❌ Doesn't solve the general problem
- ❌ Users will still write "classify" when they mean "filter"

### Option 2: Strengthen System Prompt (More Imperative)
**Current guidance:** "Before choosing CLASSIFY, ask: Does the field exist?"
**Stronger version:** "NEVER use CLASSIFY or transform/map for field comparisons. ALWAYS use transform/filter when comparing field values."

**Pros:**
- More forceful
- Could override user language

**Cons:**
- Might be too restrictive
- What if user genuinely wants to compute a derived field?

### Option 3: Add Pre-Processing Step
**Idea:** Before sending to LLM, analyze enhanced prompt for misleading language
- Detect patterns like "classify X if field Y comparator value"
- Auto-translate to "filter where field Y comparator value"

**Pros:**
- Fixes at source
- Transparent to LLM

**Cons:**
- Adds complexity
- Hard to make generic
- Might misinterpret user intent

### Option 4: Post-Processing / Auto-Fix in Compiler
**Idea:** During IR conversion or compilation:
- Detect transform/map that adds boolean field based on comparison
- Auto-convert to filter operation

**Pros:**
- Deterministic fix
- Happens after LLM, so no prompt engineering needed

**Cons:**
- ❌ Violates "don't fix semantic issues in compiler" principle
- ❌ Hard to detect all patterns
- ❌ Might misinterpret intent

### Option 5: Use Two-Pass LLM Generation
**Idea:**
1. First pass: Generate intent contract
2. Analyze: Check for patterns like map-then-filter
3. Second pass: Ask LLM to optimize/refactor

**Pros:**
- LLM can correct its own mistakes
- More intelligent than rules

**Cons:**
- Expensive (2x LLM calls)
- Slower
- Might not converge

---

## Recommendations

### Immediate Actions

#### 1. Strengthen System Prompt Language (DO THIS)
Make the guidance more imperative and add examples:

**Add to Section 4.5 (Data Flow Analysis):**
```markdown
**CRITICAL RULE: Field Comparison Operations**

If a task involves comparing a field value against a threshold or condition:
- The field MUST already exist in the data
- You MUST use TRANSFORM with op="filter"
- You MUST NOT use CLASSIFY
- You MUST NOT use TRANSFORM with op="map" to add a computed boolean field first

WRONG Pattern:
Step 1: transform/map → add "is_high_value" field by comparing "amount >= threshold"
Step 2: transform/filter → keep where "is_high_value = true"

CORRECT Pattern:
Step 1: transform/filter → where "amount >= threshold"
```

#### 2. Add Negative Examples to CLASSIFY Section
**Current:** Shows what TO do
**Add:** Show what NOT to do with clear "WRONG" markers

#### 3. Add Validation in IR Converter (SAFETY NET)
Detect and warn about suspicious patterns:
```typescript
// In convertTransform method
if (step.transform.op === 'map' &&
    step.transform.description.includes('comparing') &&
    nextStep?.transform?.op === 'filter') {
  warnings.push(`Step ${step.id}: Suspicious pattern - map with comparison followed by filter. Consider using filter directly.`)
}
```

### Medium-Term Actions

#### 4. Add Schema Introspection Guidance
Teach LLM to explicitly reason about data schemas:
```markdown
Before creating transform steps, explicitly state:
1. What fields exist in my input data?
2. What fields do I need for my condition?
3. Do all needed fields already exist?
4. If yes → use filter
5. If no → explain why field needs to be computed
```

#### 5. Consider Reflection/Validation Pass
After generating IntentContract, run a quick validation:
- Check for map-followed-by-filter patterns
- Check for transforms without executable config
- Return validation errors to LLM for correction

---

## Conclusion

### What Worked ✅
1. **Payload processing** - Range parameter present, working correctly
2. **Step structure** - Loop, conditional, aggregate steps well-formed
3. **Capability binding** - Correct plugin selection

### What Didn't Work ❌
1. **AI operation reduction** - Still using AI-like logic (map) for deterministic comparison
2. **Transform executability** - More custom_code, not less
3. **System prompt effectiveness** - Guidance didn't override misleading user prompt language

### Key Insight 💡
**The problem isn't that the LLM doesn't understand the guidance.**
**The problem is that misleading language in the enhanced prompt ("Classify") is more concrete and specific than the system prompt's general guidance.**

**User prompt** says: "Classify a lead..."
**System prompt** says: "Check if field exists before using classify"
**LLM thinks:** "User wants classify, let me check... hmm, maybe I can use transform/map instead, that's close enough"

The LLM is **trying to follow both**, resulting in a compromise that doesn't work.

### Next Step Decision Point

**Question for you:** Given that:
- System prompt improvements alone were insufficient
- You don't want to change enhanced prompt creation
- Current output is WORSE than before (40% non-executable vs 12%)

**What approach would you like to take?**

A) Strengthen system prompt language further (more imperative, add validation examples)
B) Add compiler-level detection and warnings (safety net)
C) Implement two-pass generation (expensive but more intelligent)
D) Accept that some workflows will need manual refinement
E) Something else?
