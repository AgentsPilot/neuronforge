# Executability Audit - Gmail Urgency Flagging Workflow

**Audit Date**: 2026-03-10
**Workflow**: Gmail Urgency Flagging Agent
**PILOT DSL File**: `output/vocabulary-pipeline/pilot-dsl-steps.json`

---

## Executive Summary

⚠️ **CRITICAL ISSUES FOUND: 3 blocking problems preventing execution**

The workflow passes compilation validation but has **3 critical runtime executability issues** that would cause failure:

1. ❌ **Step 6 & 7: Missing required parameters** - `mark_important` and `add_labels` not provided
2. ❌ **Step 1: Gmail query doesn't exclude labeled emails** - Will process same emails repeatedly
3. ⚠️ **Step 2: AI classification lacks keyword context** - May not detect urgency keywords correctly

---

## Step-by-Step Executability Analysis

### ✅ Step 1: Search Gmail Inbox

```json
{
  "plugin": "google-mail",
  "operation": "search_emails",
  "config": {
    "query": "in:inbox"
  }
}
```

**Schema Requirements** (from google-mail-plugin-v2.json):
- ✅ `query`: optional (defaults to empty = "in:inbox")
- ✅ `max_results`: optional (defaults to 10)
- ✅ `content_level`: optional (defaults to "snippet")

**CRITICAL ISSUE #1**: ❌ **Missing label exclusion in query**
- **Problem**: Query is `"in:inbox"` but should be `"in:inbox -label:AI-Reviewed"`
- **Impact**: Will process the same emails on every run (already marked emails will be marked again)
- **Enhanced Prompt Says**: "Exclude any email that already has the tracking label 'AI-Reviewed'"
- **Current Query Behavior**: Does NOT exclude labeled emails
- **Root Cause**: IntentContract has `filters` field but it's NOT being compiled into the Gmail query string

**CRITICAL ISSUE #2**: ⚠️ **Content level may be insufficient**
- **Problem**: Defaults to "snippet" (200 chars) but AI classification needs full email body
- **Impact**: May miss urgency keywords that appear later in email
- **Fix Required**: Add `"content_level": "full"` to config

**Executability Score**: 40% (runs but produces wrong results)

---

### ⚠️ Step 2: AI Classification

```json
{
  "type": "ai_processing",
  "input": "inbox_emails",
  "prompt": "Classify each item into one of these categories: urgent, not_urgent. Store the classification result in the 'urgency_classification' field for each item.",
  "config": {
    "ai_type": "classify",
    "labels": ["urgent", "not_urgent"]
  }
}
```

**Runtime Requirements**:
- ✅ Input variable `inbox_emails` will be available from step 1
- ✅ Output schema is well-defined
- ✅ AI executor can handle classification

**CRITICAL ISSUE #3**: ⚠️ **Missing keyword context in prompt**
- **Problem**: Prompt doesn't mention the urgency keywords: "today", "urgent", "immediately", "now", "sensitive"
- **Enhanced Prompt Says**: "Determine whether an email is urgent by checking whether the subject OR body contains any of these keywords/phrases (case-insensitive): 'today', 'urgent', 'immediately', 'now', 'sensitive'."
- **Current Prompt**: Generic classification without keyword guidance
- **Impact**: AI will use general reasoning instead of explicit keyword matching
- **Severity**: MODERATE - AI might still detect urgency, but not consistently

**Executability Score**: 70% (runs but may misclassify)

---

### ✅ Step 3: Filter for Urgent Emails

```json
{
  "type": "transform",
  "operation": "filter",
  "config": {
    "condition": {
      "field": "item.urgency_classification",
      "operator": "eq",
      "value": "urgent"
    }
  }
}
```

**Runtime Requirements**:
- ✅ Input variable `classified_emails` available from step 2
- ✅ Transform executor can handle filter operations
- ✅ Condition syntax is correct

**Executability Score**: 100% ✅

---

### ✅ Step 4: Count Urgent Emails

```json
{
  "type": "transform",
  "operation": "reduce",
  "config": {
    "reduce_operation": "count"
  }
}
```

**Runtime Requirements**:
- ✅ Input variable `urgent_emails` available from step 3
- ✅ Transform executor can handle reduce/count operations

**Executability Score**: 100% ✅

---

### ❌ Step 5: Loop Over Urgent Emails

```json
{
  "type": "scatter_gather",
  "scatter": {
    "input": "{{urgent_emails}}",
    "itemVariable": "urgent_email",
    "steps": [...]
  }
}
```

**Runtime Requirements**:
- ✅ Input variable `urgent_emails` available from step 3
- ✅ Loop executor can handle scatter-gather
- ✅ Item variable `urgent_email` will be created for each iteration

**BUT** - Inner steps 6 and 7 have critical issues (see below)

**Executability Score**: Depends on inner steps

---

### ❌ Step 6: Mark Email as Important (CRITICAL FAILURE)

```json
{
  "plugin": "google-mail",
  "operation": "modify_message",
  "config": {
    "message_id": "{{urgent_email.id}}"
  }
}
```

**Schema Requirements** (from google-mail-plugin-v2.json:725-761):
```json
{
  "required": ["message_id"],
  "properties": {
    "message_id": { "type": "string" },
    "add_labels": { "type": "array" },
    "remove_labels": { "type": "array" },
    "mark_important": { "type": "boolean" },
    "mark_read": { "type": "boolean" }
  }
}
```

**CRITICAL ISSUE #4**: ❌ **Missing `mark_important` parameter**
- **Problem**: Config only has `message_id`, but doesn't specify `"mark_important": true`
- **Impact**: **modify_message will do NOTHING** - no flags or labels will be changed
- **Required Fix**: Add `"mark_important": true` to config
- **Root Cause**: IntentContract deliver step has `mapping: [{ from: literal(true), to: "important" }]` but the compiler is NOT converting this to `mark_important: true` in the action config

**Expected Config**:
```json
{
  "message_id": "{{urgent_email.id}}",
  "mark_important": true
}
```

**Executability Score**: 0% ❌ (runs but does nothing)

---

### ❌ Step 7: Apply Tracking Label (CRITICAL FAILURE)

```json
{
  "plugin": "google-mail",
  "operation": "modify_message",
  "config": {
    "message_id": "{{important_email.id}}"
  }
}
```

**CRITICAL ISSUE #5**: ❌ **Missing `add_labels` parameter**
- **Problem**: Config only has `message_id`, but doesn't specify `"add_labels": ["{{config.tracking_label_name}}"]`
- **Impact**: **modify_message will do NOTHING** - the "AI-Reviewed" label will NOT be applied
- **Required Fix**: Add `"add_labels": ["{{config.tracking_label_name}}"]` to config
- **Root Cause**: Same as Step 6 - IntentContract deliver mapping not being compiled into action parameters

**Expected Config**:
```json
{
  "message_id": "{{important_email.id}}",
  "add_labels": ["{{config.tracking_label_name}}"]
}
```

**Executability Score**: 0% ❌ (runs but does nothing)

---

### ✅ Step 8: AI Generate Summary Email

```json
{
  "type": "ai_processing",
  "input": {
    "processed_urgent_emails": "{{processed_urgent_emails}}",
    "urgent_count": "{{urgent_count}}"
  },
  "prompt": "Create an email summary listing all urgent emails that were marked important. For each email include: sender, subject, received date/time, and which urgency keywords were detected. If no urgent emails were found (count is 0), state explicitly that no urgent emails were found. Format as a clear, readable HTML email body.",
  "config": {
    "ai_type": "generate",
    "output_schema": {
      "properties": {
        "subject": { "type": "string" },
        "body": { "type": "string" }
      },
      "required": ["subject", "body"]
    }
  }
}
```

**Runtime Requirements**:
- ✅ Input variables available (processed_urgent_emails, urgent_count)
- ✅ Output schema is well-defined
- ✅ Prompt is clear and actionable
- ✅ AI executor can handle generation

**Executability Score**: 100% ✅

---

### ✅ Step 9: Send Summary Email

```json
{
  "plugin": "google-mail",
  "operation": "send_email",
  "config": {
    "recipients": {
      "to": ["{{config.user_email}}"]
    },
    "content": {
      "subject": "{{summary_content.subject}}",
      "html_body": "{{summary_content.body}}"
    }
  }
}
```

**Schema Requirements** (from google-mail-plugin-v2.json:62-144):
```json
{
  "required": ["recipients", "content"],
  "properties": {
    "recipients": {
      "required": ["to"],
      "properties": {
        "to": { "type": "array" }
      }
    },
    "content": {
      "required": ["subject"],
      "properties": {
        "subject": { "type": "string" },
        "html_body": { "type": "string" }
      }
    }
  }
}
```

**Validation**:
- ✅ `recipients.to` is an array with config variable
- ✅ `content.subject` and `content.html_body` reference step 8 outputs
- ✅ All required fields present

**Executability Score**: 100% ✅

---

## Overall Executability Assessment

### By Step

| Step | Status | Executability | Critical Issues |
|------|--------|---------------|-----------------|
| 1. Search Inbox | ⚠️ PARTIAL | 40% | Missing label exclusion, wrong content_level |
| 2. AI Classify | ⚠️ PARTIAL | 70% | Missing keyword guidance in prompt |
| 3. Filter Urgent | ✅ PASS | 100% | None |
| 4. Count Urgent | ✅ PASS | 100% | None |
| 5. Loop | ⚠️ DEPENDS | - | Depends on inner steps |
| 6. Mark Important | ❌ FAIL | 0% | Missing mark_important parameter |
| 7. Apply Label | ❌ FAIL | 0% | Missing add_labels parameter |
| 8. Generate Summary | ✅ PASS | 100% | None |
| 9. Send Email | ✅ PASS | 100% | None |

### Overall Scores

| Metric | Score | Details |
|--------|-------|---------|
| Compilation Validation | 100% | Passes all schema checks |
| Parameter Completeness | 22% | 2/9 steps missing required params |
| Business Logic Correctness | 33% | 3/9 steps have logic errors |
| Runtime Executability | 40% | Will run but fail silently on steps 6-7 |

**OVERALL EXECUTABILITY: 40% ❌**

---

## Root Cause Analysis

### Issue #1: Deliver Step Mapping Not Compiled to Action Parameters

**IntentContract (intent-contract.json:164-173)**:
```json
{
  "kind": "deliver",
  "deliver": {
    "domain": "email",
    "intent": "update",
    "mapping": [
      {
        "from": { "kind": "literal", "value": true },
        "to": "important"
      }
    ]
  }
}
```

**Expected PILOT DSL**:
```json
{
  "plugin": "google-mail",
  "operation": "modify_message",
  "config": {
    "message_id": "{{urgent_email.id}}",
    "mark_important": true  // ❌ MISSING!
  }
}
```

**Root Cause**: ExecutionGraphCompiler is NOT processing the `deliver.mapping` field to add parameters to the action config. The mapping is being ignored during compilation.

**Where to Fix**: [ExecutionGraphCompiler.ts](lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts) - `compileDeliverNode()` function needs to process `mapping` array and add mapped values to config.

---

### Issue #2: IntentContract Filters Not Compiled to Gmail Query

**IntentContract (intent-contract.json:54-63)**:
```json
{
  "query": "in:inbox",
  "filters": [
    {
      "field": "label",
      "op": "ne",
      "value": {
        "kind": "config",
        "key": "tracking_label_name"
      }
    }
  ]
}
```

**Expected PILOT DSL**:
```json
{
  "config": {
    "query": "in:inbox -label:{{config.tracking_label_name}}"  // ❌ MISSING FILTER!
  }
}
```

**Root Cause**: IntentToIRConverter or ExecutionGraphCompiler is NOT converting the `filters` array into Gmail query operators. The filter is being dropped during compilation.

**Where to Fix**:
- [IntentToIRConverter.ts](lib/agentkit/v6/compiler/IntentToIRConverter.ts) - `convertDataSourceStep()` should merge filters into query string
- OR plugin-specific query builders needed

---

### Issue #3: AI Classification Prompt Missing Keyword Context

**IntentContract (intent-contract.json:72-85)**:
```json
{
  "kind": "classify",
  "classify": {
    "input": "inbox_emails",
    "labels": ["urgent", "not_urgent"],
    "output_field": "urgency_classification"
  }
}
```

**Problem**: No reference to urgency keywords from enhanced prompt or config

**Expected Prompt**:
```
"Classify each email as urgent or not_urgent based on whether the subject or body contains any of these keywords (case-insensitive): {{config.urgency_keywords}}. Store the result in 'urgency_classification' field."
```

**Root Cause**: IntentContract generation didn't include keyword-specific instructions. The LLM generated a generic classification step without referencing the urgency_keywords config.

**Where to Fix**: This is an **LLM generation issue**, not a compiler issue. The enhanced prompt needs to be clearer about keyword-based classification, OR the IntentContract schema should support rule-based classification with explicit keyword matching.

---

## What Would Actually Happen If We Run This?

### Execution Flow

1. **Step 1**: ✅ Searches inbox, returns 10 emails (including previously processed ones)
2. **Step 2**: ⚠️ AI classifies some emails as urgent (but may miss keyword-based urgency)
3. **Step 3**: ✅ Filters to urgent emails (e.g., 3 emails)
4. **Step 4**: ✅ Counts urgent emails (urgent_count = 3)
5. **Step 5**: ✅ Loop starts, iterates 3 times
6. **Step 6**: ❌ Calls `modify_message` with ONLY `message_id` → **Gmail API does NOTHING**
7. **Step 7**: ❌ Calls `modify_message` with ONLY `message_id` → **Gmail API does NOTHING**
8. **Step 8**: ✅ AI generates summary email (lists 3 emails as "marked important")
9. **Step 9**: ✅ Sends summary email to user

### User Experience

**User receives email**: "3 urgent emails were marked as important!"

**Reality**:
- ❌ Emails were NOT marked as important
- ❌ "AI-Reviewed" label was NOT applied
- ❌ On next run, same emails will be processed again
- ❌ User thinks workflow is working but nothing is actually happening

**This is the WORST kind of bug**: Silent failure with false positive reporting.

---

## Required Fixes

### Fix #1: ExecutionGraphCompiler - Process Deliver Mappings (CRITICAL)

**Location**: `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`

**Current Code** (approximate):
```typescript
compileDeliverNode(node: DeliverNode): PilotStep {
  return {
    plugin: node.binding.plugin,
    operation: node.binding.action,
    config: {
      // Only extracts message_id from x-variable-mapping
      // MISSING: mapping values from deliver.mapping
    }
  };
}
```

**Required Fix**:
```typescript
compileDeliverNode(node: DeliverNode): PilotStep {
  const config: any = { /* extract message_id */ };

  // Process deliver.mapping array
  if (node.deliver.mapping) {
    for (const map of node.deliver.mapping) {
      const targetParam = map.to; // e.g., "important" or "add_label"
      const sourceValue = resolveValue(map.from); // e.g., true or "AI-Reviewed"

      // Map to plugin parameter names
      if (targetParam === 'important') {
        config.mark_important = sourceValue;
      } else if (targetParam === 'add_label') {
        config.add_labels = [sourceValue];
      } else {
        config[targetParam] = sourceValue;
      }
    }
  }

  return { plugin, operation, config };
}
```

---

### Fix #2: IntentToIRConverter - Compile Filters to Query String (HIGH PRIORITY)

**Location**: `lib/agentkit/v6/compiler/IntentToIRConverter.ts`

**Current Code** (approximate):
```typescript
convertDataSourceStep(step: DataSourceStep): FetchNode {
  return {
    query: step.query, // Just copies query as-is
    // MISSING: filters not being processed
  };
}
```

**Required Fix**:
```typescript
convertDataSourceStep(step: DataSourceStep): FetchNode {
  let query = step.query || '';

  // Process filters and append to query string
  if (step.filters && step.filters.length > 0) {
    for (const filter of step.filters) {
      if (filter.field === 'label' && filter.op === 'ne') {
        const labelValue = resolveConfigValue(filter.value);
        query += ` -label:${labelValue}`;
      }
      // Add more filter types as needed
    }
  }

  return {
    query: query.trim(),
    ...
  };
}
```

---

### Fix #3: Improve AI Classification Prompt (MEDIUM PRIORITY)

**Location**: LLM prompt generation in IntentGenerator OR ExecutionGraphCompiler

**Option A**: Fix in IntentContract generation
- Update IntentGenerator system prompt to include keyword-specific instructions when classification is based on keyword matching

**Option B**: Fix in PILOT DSL compilation
- ExecutionGraphCompiler should inject keyword context into AI classification prompts when `config.urgency_keywords` exists

**Recommended**: Option B (compiler fix) - more deterministic and scalable

---

## Testing Recommendations

### Unit Tests Needed

1. **Test ExecutionGraphCompiler.compileDeliverNode()**
   - Input: DeliverNode with mapping `[{ from: literal(true), to: "important" }]`
   - Expected: `config.mark_important = true`

2. **Test IntentToIRConverter.convertDataSourceStep()**
   - Input: DataSourceStep with filters `[{ field: "label", op: "ne", value: "AI-Reviewed" }]`
   - Expected: `query = "in:inbox -label:AI-Reviewed"`

3. **Test AI Classification Prompt Generation**
   - Input: ClassifyStep with config.urgency_keywords
   - Expected: Prompt mentions specific keywords

### Integration Tests Needed

1. **End-to-End Test with Real Gmail API**
   - Run workflow with test Gmail account
   - Verify emails actually get marked as important
   - Verify labels actually get applied
   - Verify second run doesn't re-process same emails

2. **Mock API Test**
   - Mock google-mail.modify_message calls
   - Assert it's called with correct parameters
   - Assert add_labels contains tracking label
   - Assert mark_important is true

---

## Comparison to Enhanced Prompt Requirements

| Requirement | Implemented | Working | Notes |
|------------|-------------|---------|-------|
| Search Gmail Inbox | ✅ Yes | ⚠️ Partial | Missing label exclusion filter |
| Read email subject/body | ✅ Yes | ⚠️ Partial | May use snippet instead of full |
| Exclude "AI-Reviewed" label | ✅ Yes (Intent) | ❌ No | Filter not compiled to query |
| Classify urgent by keywords | ✅ Yes | ⚠️ Partial | Keywords not in prompt |
| Mark urgent as important | ✅ Yes (Intent) | ❌ No | Parameter not compiled |
| Apply "AI-Reviewed" label | ✅ Yes (Intent) | ❌ No | Parameter not compiled |
| Generate summary list | ✅ Yes | ✅ Yes | Working correctly |
| Send summary email | ✅ Yes | ✅ Yes | Working correctly |

**Requirements Met: 3/8 (37%)**

---

## Conclusion

### Validation vs. Executability

The workflow **passes all validation checks** because:
- ✅ Plugin bindings are correct
- ✅ Variable references exist
- ✅ Data types match
- ✅ Required parameters (message_id) are present

BUT it **fails executability** because:
- ❌ Deliver mappings not compiled to action parameters
- ❌ Filters not compiled to query strings
- ❌ Business logic requirements not fully met

### The Core Problem

**The pipeline validates STRUCTURE but not COMPLETENESS.**

The ExecutionGraphCompiler successfully:
- ✅ Binds plugins
- ✅ Extracts x-variable-mapping fields (message_id)
- ✅ Wraps variables in {{}}

But FAILS to:
- ❌ Process deliver.mapping to add action parameters
- ❌ Compile filters into provider-specific query syntax
- ❌ Inject context (keywords) into AI prompts

### Recommended Actions

1. **CRITICAL (Do First)**: Fix ExecutionGraphCompiler to process deliver.mapping
2. **HIGH PRIORITY**: Fix IntentToIRConverter to compile filters to query strings
3. **MEDIUM PRIORITY**: Improve AI classification prompt generation
4. **TESTING**: Add integration tests with real API calls

**Until these fixes are made, the workflow is NOT production-ready despite passing validation.**

---

## Final Executability Rating

| Category | Rating | Explanation |
|----------|--------|-------------|
| Compilation Validation | ✅ 100% | Passes all schema checks |
| Structural Correctness | ✅ 90% | Plugins bound, variables resolved |
| **Parameter Completeness** | **❌ 22%** | **Missing critical action parameters** |
| **Business Logic** | **❌ 33%** | **Core email modification doesn't work** |
| **Overall Executability** | **❌ 40%** | **Runs but produces incorrect results** |

**VERDICT: NOT EXECUTABLE as intended. Requires 3 compiler fixes before production deployment.**
