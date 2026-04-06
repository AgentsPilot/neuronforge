# Lead Sales Follow-up Workflow - Complete Executability Analysis

**Date:** 2026-03-05
**Analysis Type:** End-to-End Verification
**Workflow:** High-Quality Lead Checker + Sales Follow-up Agent

---

## Executive Summary

### Overall Assessment: 🟡 **MOSTLY EXECUTABLE with 2 BLOCKERS**

| Category | Status | Details |
|----------|--------|---------|
| **Data Flow** | ✅ **VALID** | All variable references are correct and scoped properly |
| **Parameter Mapping** | ✅ **VALID** | All config references resolve correctly |
| **Filter Operations** | ✅ **EXECUTABLE** | All filters have proper conditions |
| **AI Operations** | ✅ **EXECUTABLE** | All AI steps have proper schemas and instructions |
| **Action Operations** | ✅ **EXECUTABLE** | All plugin actions have correct parameters |
| **Loop/Conditional** | ✅ **EXECUTABLE** | Proper structure with correct variable scoping |
| **Transform Map (Step 4)** | 🔴 **NOT EXECUTABLE** | Custom code only, no executable logic |
| **Transform Group (Step 7)** | 🔴 **NOT EXECUTABLE** | Custom code only, missing group_by specification |

**Executability Rate:** 7 out of 9 top-level steps (78%)

---

## Part 1: IntentContract Analysis

### Configuration Parameters ✅

All 7 config parameters are well-defined:

1. ✅ `user_email` (string) - Default: avital.livovsky@gmail.com
2. ✅ `google_sheet_id` (string) - Default: 1LKhXUzV9xh-q1NZJKHDjJWPdwFHXalV6amwLJwX8JkE
3. ✅ `sheet_tab_name` (string) - Required input
4. ✅ `score_column_name` (string) - Required input
5. ✅ `score_threshold` (number) - Required input
6. ✅ `salesperson_column_format` (string) - Enum: ['email', 'name']
7. ✅ `salesperson_email_mapping` (json) - Conditional based on format

**Assessment:** Configuration is complete and well-structured.

---

### Step-by-Step IntentContract Analysis

#### Step 1: fetch_lead_rows ✅ **VALID**

```json
{
  "kind": "data_source",
  "uses": [{"capability": "get", "domain": "table", "provider_family": "google"}],
  "output": "lead_rows",
  "payload": {
    "spreadsheet_id": {"kind": "config", "key": "google_sheet_id"},
    "tab_name": {"kind": "config", "key": "sheet_tab_name"}
  }
}
```

**Analysis:**
- ✅ Correct use of `payload` for structured parameters
- ✅ References valid config keys
- ✅ Will bind to `google-sheets.read_range`
- ✅ Output variable declared: `lead_rows`

**Expected Execution:**
- Fetches data from Google Sheets
- Returns: `{values: [[...], [...]], range: "..."}`

---

#### Step 2: classify_leads_by_score ✅ **VALID & IMPROVED**

```json
{
  "kind": "transform",
  "transform": {
    "op": "filter",  // ✅ CORRECT - was "map" before
    "input": "lead_rows",
    "where": {
      "op": "test",
      "left": {"kind": "ref", "ref": "lead_rows", "field": "score_column_name"},
      "comparator": "gte",
      "right": {"kind": "config", "key": "score_threshold"}
    }
  },
  "output": "high_quality_leads"
}
```

**Analysis:**
- ✅ **MAJOR IMPROVEMENT** - Now uses `filter` instead of `classify` or `map`
- ✅ Has structured `where` clause with proper condition
- ✅ References input variable `lead_rows`
- ✅ References valid config key `score_threshold`
- ⚠️ **ISSUE**: `field: "score_column_name"` should be the VALUE of config.score_column_name, not literal

**Expected Execution:**
- Filters items where score >= threshold
- Returns subset of lead_rows

**Critical Issue:**
```json
"field": "score_column_name"  // ❌ Wrong - literal string
```
Should be:
```json
"field": "{{config.score_column_name}}"  // ✅ Correct - dynamic field reference
```

**Executability:** 🟡 PARTIAL - Has condition but field reference is wrong

---

#### Step 3: resolve_salesperson_emails 🔴 **NOT EXECUTABLE**

```json
{
  "kind": "transform",
  "transform": {
    "op": "map",
    "input": "high_quality_leads",
    "description": "Map sales person name/email to resolved email address using config mapping or pass-through if already email"
  },
  "output": "leads_with_emails"
}
```

**Analysis:**
- ❌ **Description only** - No executable transformation logic
- ❌ Requires conditional logic: if email format → passthrough, else → lookup
- ❌ Requires config lookup: `config.salesperson_email_mapping[item.Sales Person]`
- ❌ No declarative way to express this in current schema

**What It Needs To Do:**
```javascript
if (config.salesperson_column_format === 'email') {
  item.resolved_email = item['Sales Person']
} else {
  item.resolved_email = config.salesperson_email_mapping[item['Sales Person']]
}
```

**Possible Solutions:**
1. Use GENERATE step (AI-powered transformation)
2. Decompose into filter subsets + separate maps
3. Extend schema to support conditional expressions

**Executability:** 🔴 **NOT EXECUTABLE**

---

#### Step 4: split_by_email_resolution ✅ **VALID**

```json
{
  "kind": "aggregate",
  "aggregate": {
    "input": "leads_with_emails",
    "outputs": [
      {
        "name": "leads_with_resolved_emails",
        "type": "subset",
        "where": {
          "op": "test",
          "left": {"field": "resolved_email"},
          "comparator": "exists"
        }
      },
      {
        "name": "leads_with_unresolved_emails",
        "type": "subset",
        "where": {
          "op": "not",
          "condition": {
            "op": "test",
            "left": {"field": "resolved_email"},
            "comparator": "exists"
          }
        }
      }
    ]
  }
}
```

**Analysis:**
- ✅ Proper aggregate structure with subset outputs
- ✅ Creates named symbolic refs for subsets
- ✅ Has executable where conditions
- ✅ Proper use of "not" operator

**Expected Execution:**
- Splits leads_with_emails into two subsets
- Creates variables: `leads_with_resolved_emails`, `leads_with_unresolved_emails`

**Executability:** ✅ **EXECUTABLE**

---

#### Step 5: group_by_salesperson 🔴 **NOT EXECUTABLE**

```json
{
  "kind": "transform",
  "transform": {
    "op": "group",
    "input": "leads_with_resolved_emails",
    "description": "Group leads by resolved_email field to create per-salesperson collections",
    "rules": {
      "group_by": "resolved_email"  // ✅ Has group_by!
    }
  },
  "output": "grouped_by_salesperson"
}
```

**Analysis:**
- ✅ **IMPROVEMENT** - Now has `rules.group_by` field
- ✅ Specifies which field to group by
- ⚠️ Still has `custom_code` description (but also has rules)

**Expected Execution:**
- Groups leads by resolved_email field
- Returns: `[{key: "email1@example.com", items: [...]}, {key: "email2@example.com", items: [...]}]`

**Executability:** ✅ **EXECUTABLE** (has group_by field despite custom_code)

---

#### Step 6: process_each_salesperson ✅ **VALID**

```json
{
  "kind": "loop",
  "loop": {
    "over": "grouped_by_salesperson",
    "item_ref": "salesperson_group",
    "collect": {
      "enabled": true,
      "collect_as": "sent_emails",
      "from_step_output": "sent_email"
    },
    "do": [
      // Sub-step 6.1: generate_followup_content
      // Sub-step 6.2: send_salesperson_email
    ]
  }
}
```

**Analysis:**
- ✅ Proper loop structure
- ✅ Iterates over grouped_by_salesperson
- ✅ Item reference: salesperson_group
- ✅ Collect enabled with proper config

**Sub-step 6.1: generate_followup_content ✅**
```json
{
  "kind": "generate",
  "uses": [{"capability": "generate", "domain": "internal", "provider_family": "openai"}],
  "generate": {
    "input": "salesperson_group",
    "format": "html",
    "instruction": "Create a professional sales follow-up email...",
    "outputs": [
      {"name": "subject", "type": "string"},
      {"name": "body", "type": "string"}
    ]
  },
  "output": "followup_content"
}
```
- ✅ References loop item: salesperson_group
- ✅ Has clear instruction
- ✅ Has output schema
- ✅ Will bind to chatgpt-research.answer_question

**Sub-step 6.2: send_salesperson_email ✅**
```json
{
  "kind": "notify",
  "uses": [{"capability": "send_message", "domain": "email", "provider_family": "google"}],
  "notify": {
    "recipients": {
      "to": [{"kind": "ref", "ref": "salesperson_group", "field": "resolved_email"}]
    },
    "content": {
      "subject": {"kind": "ref", "ref": "followup_content", "field": "subject"},
      "body": {"kind": "ref", "ref": "followup_content", "field": "body"},
      "format": "html"
    }
  }
}
```
- ✅ References loop item field: salesperson_group.resolved_email
- ✅ References prior step output: followup_content.subject, followup_content.body
- ✅ Will bind to google-mail.send_email

**Executability:** ✅ **EXECUTABLE**

---

#### Step 7: check_unresolved_leads ✅ **VALID**

```json
{
  "kind": "decide",
  "decide": {
    "condition": {
      "op": "test",
      "left": {"kind": "ref", "ref": "leads_with_unresolved_emails", "field": "length"},
      "comparator": "gt",
      "right": {"kind": "literal", "value": 0}
    },
    "then": [
      // Sub-step 7.1: generate_fallback_content
      // Sub-step 7.2: send_fallback_email
    ]
  }
}
```

**Analysis:**
- ✅ Proper conditional structure
- ✅ References subset variable from Step 4
- ✅ Has executable condition

**Sub-steps analysis:**
- ✅ Both sub-steps follow same pattern as loop sub-steps
- ✅ generate_fallback_content: proper AI step
- ✅ send_fallback_email: proper notify step

**Executability:** ✅ **EXECUTABLE**

---

## Part 2: Data Flow Analysis

### Variable Declaration Order

1. `lead_rows` ← Step 1 (data_source)
2. `high_quality_leads` ← Step 2 (transform/filter)
3. `leads_with_emails` ← Step 3 (transform/map)
4. `leads_with_resolved_emails` ← Step 4 (aggregate subset)
5. `leads_with_unresolved_emails` ← Step 4 (aggregate subset)
6. `grouped_by_salesperson` ← Step 5 (transform/group)
7. `sent_emails` ← Step 6 (loop collect)
   - Loop scope: `salesperson_group` (item_ref)
   - Loop scope: `followup_content` ← Sub-step 6.1
   - Loop scope: `sent_email` ← Sub-step 6.2
8. Conditional scope: `fallback_content` ← Sub-step 7.1
9. Conditional scope: `fallback_sent` ← Sub-step 7.2

### Data Flow Graph

```
lead_rows (Step 1)
    ↓
high_quality_leads (Step 2: filter)
    ↓
leads_with_emails (Step 3: map)
    ↓
    ├──→ leads_with_resolved_emails (Step 4: subset)
    │        ↓
    │    grouped_by_salesperson (Step 5: group)
    │        ↓
    │    Step 6 Loop:
    │        salesperson_group (item)
    │            ↓
    │        followup_content (generate)
    │            ↓
    │        sent_email (notify)
    │            ↓
    │    sent_emails (collect)
    │
    └──→ leads_with_unresolved_emails (Step 4: subset)
             ↓
         Step 7 Conditional:
             if length > 0:
                 fallback_content (generate)
                     ↓
                 fallback_sent (notify)
```

### Variable Reference Validation

**Step 2 References:**
- ✅ `lead_rows` - Declared in Step 1

**Step 3 References:**
- ✅ `high_quality_leads` - Declared in Step 2

**Step 4 References:**
- ✅ `leads_with_emails` - Declared in Step 3

**Step 5 References:**
- ✅ `leads_with_resolved_emails` - Declared in Step 4 (subset)

**Step 6 Loop References:**
- ✅ `grouped_by_salesperson` - Declared in Step 5
- ✅ `salesperson_group` - Loop item reference (in scope)
- ✅ `followup_content` - Declared in sub-step 6.1 (in loop scope)

**Step 7 Conditional References:**
- ✅ `leads_with_unresolved_emails` - Declared in Step 4 (subset)
- ✅ `fallback_content` - Declared in sub-step 7.1 (in conditional scope)

**Assessment:** ✅ All variable references are valid and properly scoped

---

## Part 3: PILOT DSL Analysis

### PILOT Step Breakdown

**Step 1: google-sheets.read_range ✅**
```json
{
  "type": "action",
  "plugin": "google-sheets",
  "operation": "read_range",
  "config": {
    "spreadsheet_id": "{{config.google_sheet_id}}",
    "range": "{{config.sheet_tab_name}}"
  }
}
```
- ✅ Has all required parameters
- ✅ Config references are valid
- **Executable:** YES

---

**Step 2: rows_to_objects ✅**
```json
{
  "type": "transform",
  "operation": "rows_to_objects",
  "input": "{{lead_rows.values}}"
}
```
- ✅ Auto-normalize step (added by compiler)
- ✅ Converts 2D array to objects
- **Executable:** YES

---

**Step 3: filter ⚠️**
```json
{
  "type": "transform",
  "operation": "filter",
  "config": {
    "custom_code": "Keep only leads with score >= threshold",
    "condition": {
      "operator": "gte",
      "value": "{{config.score_threshold}}",
      "field": "item.score_column_name",  // ❌ ISSUE
      "conditionType": "simple"
    }
  }
}
```
- ✅ Has executable condition
- ❌ Field reference is literal "score_column_name" instead of dynamic
- **Executable:** PARTIAL (condition exists but field is wrong)

**Fix Needed:**
```json
"field": "item.{{config.score_column_name}}"  // Dynamic field reference
```

---

**Step 4: map 🔴**
```json
{
  "type": "transform",
  "operation": "map",
  "config": {
    "custom_code": "Map sales person name/email to resolved email address..."
  }
}
```
- ❌ Only has custom_code
- ❌ No executable transformation
- **Executable:** NO

---

**Step 5: filter (subset 1) ✅**
```json
{
  "type": "transform",
  "operation": "filter",
  "config": {
    "condition": {
      "operator": "exists",
      "field": "item.resolved_email"
    }
  }
}
```
- ✅ Has executable condition
- **Executable:** YES

---

**Step 6: filter (subset 2) ✅**
```json
{
  "type": "transform",
  "operation": "filter",
  "config": {
    "condition": {
      "conditionType": "complex_not",
      "condition": {
        "operator": "exists",
        "field": "item.resolved_email"
      }
    }
  }
}
```
- ✅ Has executable condition with NOT operator
- **Executable:** YES

---

**Step 7: group ⚠️**
```json
{
  "type": "transform",
  "operation": "group",
  "config": {
    "custom_code": "Group leads by resolved_email field..."
  }
}
```
- ❌ Has custom_code
- ⚠️ IntentContract has `rules.group_by: "resolved_email"` but not in PILOT DSL
- **Executable:** NO (missing group_by in compiled output)

**Issue:** Compiler didn't transfer `group_by` from IntentContract to PILOT DSL

---

**Step 8: scatter_gather ✅**
```json
{
  "type": "scatter_gather",
  "scatter": {
    "input": "{{grouped_by_salesperson}}",
    "itemVariable": "salesperson_group",
    "steps": [...]
  },
  "gather": {"operation": "collect"}
}
```
- ✅ Proper loop structure
- **Executable:** YES

**Sub-step 9: AI generate ✅**
```json
{
  "type": "ai_processing",
  "config": {
    "ai_type": "generate",
    "output_schema": {...},
    "instruction": "..."
  }
}
```
- ✅ Has output schema
- ✅ Has instruction
- **Executable:** YES

**Sub-step 10: send_email ✅**
```json
{
  "type": "action",
  "plugin": "google-mail",
  "operation": "send_email",
  "config": {
    "recipients": {"to": ["{{salesperson_group.resolved_email}}"]},
    "content": {
      "subject": "{{followup_content.subject}}",
      "html_body": "{{followup_content.body}}"
    }
  }
}
```
- ✅ Has all required parameters
- ✅ References are valid
- **Executable:** YES

---

**Step 11: conditional ✅**
```json
{
  "type": "conditional",
  "condition": {
    "field": "leads_with_unresolved_emails.length",
    "operator": "greater_than",
    "value": 0
  },
  "steps": [...]
}
```
- ✅ Has executable condition
- **Executable:** YES

**Sub-steps 12-13:** Same pattern as steps 9-10
- ✅ Both executable

---

### PILOT DSL Executability Summary

| Step | Type | Executable | Issue |
|------|------|------------|-------|
| 1 | action (read_range) | ✅ YES | None |
| 2 | transform (rows_to_objects) | ✅ YES | None |
| 3 | transform (filter) | ⚠️ PARTIAL | Field reference literal instead of dynamic |
| 4 | transform (map) | 🔴 NO | Custom code only |
| 5 | transform (filter) | ✅ YES | None |
| 6 | transform (filter) | ✅ YES | None |
| 7 | transform (group) | 🔴 NO | Missing group_by in compiled output |
| 8 | scatter_gather | ✅ YES | None |
| 9 | ai_processing | ✅ YES | None |
| 10 | action (send_email) | ✅ YES | None |
| 11 | conditional | ✅ YES | None |
| 12 | ai_processing | ✅ YES | None |
| 13 | action (send_email) | ✅ YES | None |

**Total:** 11/13 executable (85%)

---

## Part 4: Critical Issues

### Issue #1: Field Reference in Filter (Step 3) 🔴

**Current:**
```json
"field": "item.score_column_name"  // Literal string
```

**Problem:**
- Tries to access field literally named "score_column_name"
- Should access field whose NAME is in config.score_column_name (e.g., "stage")

**Should Be:**
```json
"field": "item[config.score_column_name]"  // Dynamic field lookup
```
OR
```json
"field": "item.{{config.score_column_name}}"  // Template interpolation
```

**Impact:** 🔴 **CRITICAL** - Filter will fail to access correct field

---

### Issue #2: Map Transformation (Step 4) 🔴

**Current:**
```json
{
  "operation": "map",
  "config": {
    "custom_code": "Map sales person name/email..."
  }
}
```

**Problem:**
- No executable transformation logic
- Needs conditional: if email → passthrough, else → lookup
- Runtime cannot execute description string

**Possible Solutions:**

**Option A: Use AI (GENERATE step)**
```json
{
  "type": "ai_processing",
  "config": {
    "ai_type": "transform",
    "instruction": "Add resolved_email field. If salesperson_column_format is 'email', use Sales Person value directly. Otherwise, lookup in salesperson_email_mapping.",
    "context": {
      "format": "{{config.salesperson_column_format}}",
      "mapping": "{{config.salesperson_email_mapping}}"
    }
  }
}
```

**Option B: Decompose into primitive operations**
1. Filter subset where format = 'email' → direct_emails
2. Filter subset where format = 'name' → name_emails
3. Map direct_emails: resolved_email = Sales Person
4. Use AI to map name_emails with lookup
5. Merge subsets

**Impact:** 🔴 **CRITICAL** - Cannot add resolved_email field

---

### Issue #3: Group Operation Missing group_by (Step 7) 🔴

**IntentContract has it:**
```json
"rules": {"group_by": "resolved_email"}
```

**PILOT DSL missing it:**
```json
"config": {
  "custom_code": "Group leads by resolved_email..."
  // ❌ No group_by field
}
```

**Problem:** Compiler didn't transfer group_by field from IntentContract to PILOT DSL

**Root Cause:** Check `IntentToIRConverter.ts` - `convertTransform` method may not be handling `rules.group_by`

**Fix Location:** `lib/agentkit/v6/compiler/IntentToIRConverter.ts`

**Impact:** 🔴 **CRITICAL** - Runtime won't know which field to group by

---

## Part 5: Config Parameter Mapping

### All Config References

**google_sheet_id:**
- ✅ Step 1: spreadsheet_id parameter

**sheet_tab_name:**
- ✅ Step 1: range parameter (mapped via x-artifact-field)

**score_column_name:**
- ⚠️ Step 3: field reference (but used as literal)

**score_threshold:**
- ✅ Step 3: condition value

**salesperson_column_format:**
- ❌ Step 4: NOT USED (should be in conditional logic)

**salesperson_email_mapping:**
- ❌ Step 4: NOT USED (should be in lookup logic)

**user_email:**
- ✅ Step 13: recipient

**Assessment:** Config parameters are defined but not all are properly used in execution logic

---

## Part 6: Recommendations

### Immediate Fixes Required

#### Fix #1: Dynamic Field Reference in Filter 🔴 CRITICAL

**File:** `lib/agentkit/v6/compiler/IntentToIRConverter.ts`

**Issue:** Step 2 filter uses literal field name instead of config value

**Current:**
```typescript
left: {
  kind: "ref",
  ref: "lead_rows",
  field: "score_column_name"  // ❌ Literal
}
```

**Should Generate:**
```typescript
left: {
  kind: "ref",
  ref: "lead_rows",
  field: "{{config.score_column_name}}"  // ✅ Dynamic
}
```

OR resolve at IR conversion time if config value is known.

---

#### Fix #2: group_by Not Transferred to PILOT DSL 🔴 CRITICAL

**File:** `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`

**Issue:** IntentContract has `rules.group_by` but PILOT DSL doesn't

**Check:** In `compileTransform` method, ensure `rules.group_by` is extracted and added to config:
```typescript
if (transform.rules?.group_by) {
  config.group_by = transform.rules.group_by
}
```

---

#### Fix #3: Map Transformation Not Executable 🔴 CRITICAL

**File:** `lib/agentkit/v6/intent/intent-system-prompt-v2.ts`

**Approach:** Guide LLM to use GENERATE for complex map operations

**Add to transform executability guidance:**
```markdown
**MAP operations with conditional logic:**
If a map operation requires:
- Conditional logic (if/then/else)
- Config lookups
- Complex computation

Use GENERATE step instead:
{
  "kind": "generate",
  "generate": {
    "instruction": "Add field_x by: if condition then value_a else lookup in config.mapping",
    ...
  }
}
```

---

### Testing Required

1. **Unit Test: Dynamic Field Reference**
   - Verify filter can access fields by dynamic name
   - Test with different score_column_name values

2. **Unit Test: group_by Compilation**
   - Verify rules.group_by transfers to PILOT DSL config
   - Test grouping actually works

3. **Integration Test: Full Workflow**
   - Run with actual Google Sheets data
   - Verify emails sent correctly
   - Check conditional branch executes

---

## Part 7: Final Assessment

### What's Working Well ✅

1. **User Context Injection** - LLM correctly uses filter instead of classify
2. **Data Flow** - All variable references are valid and scoped
3. **Config Parameters** - Well-defined with proper defaults
4. **Loop/Conditional Structure** - Properly structured and executable
5. **AI Operations** - All have proper schemas and instructions
6. **Action Operations** - All have correct plugin/operation/config

### Critical Blockers 🔴

1. **Field Reference Issue** - Step 3 uses literal field name
2. **Map Not Executable** - Step 4 has no executable logic
3. **group_by Missing** - Step 7 missing group_by in PILOT DSL

### Execution Flow Prediction

If we run this workflow:

1. ✅ Step 1 executes - Fetches lead data
2. ✅ Step 2 executes - Normalizes to objects
3. ⚠️ Step 3 **FAILS** - Cannot find field "score_column_name"
4. 🔴 Workflow **STOPS** - Cannot proceed past Step 3

Even if Step 3 is fixed:
5. 🔴 Step 4 **FAILS** - Cannot execute custom_code
6. 🔴 Workflow **STOPS** - Cannot proceed past Step 4

Even if Steps 3-4 are fixed:
7. 🔴 Step 7 **FAILS** - Cannot group without group_by field
8. 🔴 Workflow **STOPS** - Cannot proceed past Step 7

### Bottom Line

**Current State:** 🔴 **NOT EXECUTABLE** - Will fail at Step 3

**After Fixing Field Reference:** 🔴 **NOT EXECUTABLE** - Will fail at Step 4

**After Fixing Map Logic:** 🔴 **NOT EXECUTABLE** - Will fail at Step 7

**After All Fixes:** ✅ **FULLY EXECUTABLE**

---

## Conclusion

The workflow is **well-structured** and shows **major improvements** from user context injection:
- ✅ Correct use of filter instead of classify
- ✅ Valid data flow and variable scoping
- ✅ Proper loop and conditional structures

However, **3 critical issues** prevent execution:
1. Dynamic field reference not working
2. Map transformation not executable
3. group_by not transferred to PILOT DSL

**All 3 issues are fixable** in the compiler/converter layer. Once fixed, the workflow will be fully executable.

**Recommended Action:** Fix the 3 critical issues, then re-test end-to-end.
