# Parameter Mapping Root Cause Analysis

**Date**: 2026-03-04
**Status**: 🔴 **TWO-PART ISSUE**

---

## Summary

The missing `range` parameter issue has **two root causes**:

1. ✅ **FIXED**: IntentToIRConverter wasn't processing `payload` field from IntentContract
2. 🔴 **STILL BROKEN**: IntentGenV2 LLM generates `query` instead of `payload` for data_source steps

---

## Issue #1: IntentToIRConverter Not Processing Payload (FIXED)

### The Problem
`buildDataSourceParams()` method (line 322) didn't extract fields from `step.payload`.

### The Fix
Added payload processing at the beginning of the method:

```typescript
// Process payload fields (e.g., spreadsheet_id, tab_name from IntentContract)
if ((step as any).payload) {
  for (const [key, value] of Object.entries((step as any).payload)) {
    params[key] = this.normalizeValueReference(value, ctx)
  }
}
```

**Status**: ✅ **COMPLETE** - Will work once LLM generates correct IntentContract

---

## Issue #2: LLM Generating Wrong Field Structure (BLOCKER)

### Current Behavior (WRONG)

**File**: `output/vocabulary-pipeline/intent-contract.json` (from test run)

The LLM generates:
```json
{
  "id": "fetch_lead_rows",
  "kind": "data_source",
  "query": {  // ❌ WRONG FIELD
    "kind": "config",
    "key": "sheet_tab_name"
  }
}
```

### Expected Behavior (CORRECT)

Should generate:
```json
{
  "id": "fetch_lead_rows",
  "kind": "data_source",
  "payload": {  // ✅ CORRECT FIELD
    "spreadsheet_id": {
      "kind": "config",
      "key": "google_sheet_id"
    },
    "tab_name": {  // Will be mapped to 'range' by x-artifact-field
      "kind": "config",
      "key": "sheet_tab_name"
    }
  }
}
```

---

## Root Cause: IntentGenV2 System Prompt

**File**: `lib/agentkit/v6/intent/intent-system-prompt-v2.ts` (or similar)

The LLM prompt doesn't properly explain how to structure data_source step parameters.

### What the Prompt Should Say

```markdown
## DataSource Steps

When creating a `data_source` step to fetch data from external sources:

### Parameter Structure

Use the `payload` field to specify all parameters required by the data source:

```json
{
  "kind": "data_source",
  "payload": {
    "parameter_name": {
      "kind": "config",  // or "literal", "ref"
      "key": "config_key"
    }
  }
}
```

### Common Patterns

**Google Sheets - Read Data:**
```json
{
  "kind": "data_source",
  "uses": [{"capability": "get", "domain": "table"}],
  "payload": {
    "spreadsheet_id": {"kind": "config", "key": "google_sheet_id"},
    "tab_name": {"kind": "config", "key": "sheet_tab_name"}
  }
}
```

**Gmail - Search Emails:**
```json
{
  "kind": "data_source",
  "uses": [{"capability": "search", "domain": "email"}],
  "payload": {
    "query": {"kind": "literal", "value": "is:unread has:attachment"}
  }
}
```

**NEVER use the `query` field directly at the step level - parameters must be in `payload`.**
```

---

## Why `query` Field Exists

The `query` field is a semantic concept in the IntentContract schema for search-type operations. But it should NOT be used as the parameter structure for plugin actions.

**Correct Flow:**
1. LLM generates semantic `payload` with parameter names that match plugin semantics
2. IntentToIRConverter extracts payload fields to `genericParams`
3. `mapParamsToSchema()` maps semantic names to plugin-specific names using x-artifact-field

**Current (Broken) Flow:**
1. LLM generates `query` at step level
2. IntentToIRConverter doesn't know what to do with it (no payload)
3. Empty config gets passed to plugin

---

## The Real Test

Let me check what the ORIGINAL expense extractor IntentContract (that worked) used:

**File**: Need to check a working example

If the expense extractor worked, it means either:
- A) The LLM generated proper `payload` for that workflow
- B) The workflow didn't use Google Sheets read operation

---

## Solution

### Option 1: Fix IntentGenV2 System Prompt (RECOMMENDED)

**Why**: Root cause fix - teaches LLM the correct structure

**Steps**:
1. Find IntentGenV2 system prompt file
2. Add clear guidance on `payload` field structure for data_source steps
3. Provide examples of common patterns (Google Sheets, Gmail, etc.)
4. Explicitly state NOT to use `query` directly for parameters

### Option 2: Handle `query` Field in buildDataSourceParams (HACK)

**Why**: Backward compatibility with existing broken IntentContracts

**Code**:
```typescript
// HACK: If query exists and no payload, treat query as a generic search parameter
if (step.query && !step.payload) {
  const isStructuredRef = typeof step.query === 'object' && step.query !== null && 'kind' in step.query
  if (isStructuredRef) {
    // It's a config/ref, resolve it
    params.query = this.normalizeValueReference(step.query, ctx)
  } else {
    params.query = step.query
  }
}
```

**Problem**: This is still hardcoding - doesn't solve the root issue

---

## User's Valid Concern

> "this is a problem that the fuzzy logic find a match what if it won't find a match?"

**You're absolutely right!** The fuzzy matching we saw in the logs is a FALLBACK mechanism in the ExecutionGraphCompiler. It's NOT the proper solution.

The proper flow should be:
1. LLM generates correct parameter names in `payload`
2. `mapParamsToSchema()` uses `x-artifact-field` to map semantic → plugin names
3. No fuzzy matching needed

**Fuzzy matching should only be used for:**
- Minor variations (snake_case vs camelCase)
- NOT for finding completely different parameter names

---

## Next Steps

1. ✅ Keep the `buildDataSourceParams` payload fix (it's correct)
2. 🔴 Find IntentGenV2 system prompt and add proper guidance on `payload` structure
3. 🔴 Re-test lead sales workflow after prompt fix

---

## Bottom Line

The classification fix was real and necessary. The payload processing fix is also correct. But there's a THIRD issue: **the LLM isn't being told how to structure data_source parameters properly**.

**This is still following CLAUDE.md principles**:
- ✅ Fix at root cause (IntentGenV2 prompt, not compiler)
- ✅ Schema-driven (using x-artifact-field mappings)
- ✅ No hardcoding (teaching LLM, not adding plugin-specific logic)
