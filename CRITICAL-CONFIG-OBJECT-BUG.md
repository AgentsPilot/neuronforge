# CRITICAL BUG: Config Objects Not Resolved at Runtime

**Date:** 2026-03-06
**Severity:** 🔴 CRITICAL - Workflows will FAIL to execute
**Discovered By:** User analysis of PILOT DSL

---

## The Bug

**PILOT DSL contains config as objects instead of strings:**

```json
{
  "step_id": "step1",
  "type": "action",
  "plugin": "google-sheets",
  "operation": "read_range",
  "config": {
    "spreadsheet_id": {
      "kind": "config",           // ❌ OBJECT, not string!
      "key": "google_sheet_id"
    },
    "range": "{{config.sheet_tab_name}}"  // ✅ String format (correct)
  }
}
```

---

## What Happens at Runtime

### Step 1: StepExecutor calls resolveAllVariables()

```typescript
// Line 271: StepExecutor.ts
resolvedParams = context.resolveAllVariables(step.params || {});
```

### Step 2: resolveAllVariables() processes the config

```typescript
// ExecutionContext.ts lines 320-326
if (typeof obj === 'object') {
  const resolved: any = {};
  for (const [key, value] of Object.entries(obj)) {
    resolved[key] = this.resolveAllVariables(value);  // Recursive
  }
  return resolved;
}
```

**For `spreadsheet_id` value:**
- Input: `{kind: "config", key: "google_sheet_id"}`
- Type check: `typeof {kind: "config", ...} === 'object'` → TRUE
- Recursively calls on `"kind"` and `"key"` (both strings)
- Returns: `{kind: "config", key: "google_sheet_id"}` (UNCHANGED!)

### Step 3: Plugin receives object instead of spreadsheet ID

```typescript
// PluginExecuterV2 tries to call Google Sheets API
await googleSheets.spreadsheets.values.get({
  spreadsheetId: {"kind": "config", "key": "google_sheet_id"},  // ❌ API expects string!
  range: "Leads tab"
})
```

### Step 4: Google Sheets API rejects request

```
Error: Invalid value at 'spreadsheet_id': Expected string, got object
```

**WORKFLOW FAILS** 🔴

---

## Root Cause

### Where Objects Are Created: IntentToIRConverter

```typescript
// IntentToIRConverter.ts line 1237
case 'config':
  return `{{config.${valueRef.key}}}`  // ✅ Returns STRING
```

**This is CORRECT** - IntentToIRConverter creates `"{{config.key}}"` strings.

### Where Objects Appear: ExecutionGraph IR

Checking the ExecutionGraph IR:

```bash
$ cat output/vocabulary-pipeline/execution-graph-ir-v4.json | jq '.execution_graph.nodes.node_0.operation.fetch.config'
```

```json
{
  "spreadsheet_id": {
    "kind": "config",
    "key": "google_sheet_id"
  },
  "range": {
    "kind": "config",
    "key": "sheet_tab_name"
  }
}
```

**AH HA!** The ExecutionGraph IR ALREADY has objects, NOT strings!

### Real Root Cause: IntentToIRConverter NOT Being Used

Looking at the code flow:

1. ✅ BoundIntentContract has `mapped_params` from CapabilityBinderV2
2. ✅ IntentToIRConverter should call `mapParamsToSchema()` to convert to strings
3. ❌ **BUT** - It's using the RAW `mapped_params` without calling `resolveValueRef()`!

**The Fix from earlier (`resolveValueRef` wrapping in `{{}}`) only affects NEW conversions.**

**The `mapped_params` from CapabilityBinderV2 are ALREADY objects and never get converted!**

---

## Where The Bug Actually Is

### CapabilityBinderV2 Creates Objects

```typescript
// CapabilityBinderV2.ts lines 577-583
if (contextBinding) {
  const configValue = this.findConfigValue(contextBinding.key, this.workflowConfig)
  if (configValue !== undefined) {
    result.params[paramName] = {
      kind: 'config',
      key: contextBinding.key
    }
  }
}
```

**CapabilityBinderV2 creates objects with `{kind: "config", key: "..."}` format.**

### IntentToIRConverter Uses These Objects Directly

```typescript
// IntentToIRConverter.ts lines 291-302
if (boundStep.mapped_params && Object.keys(boundStep.mapped_params).length > 0) {
  logger.debug(`Using pre-mapped parameters from binding phase`)

  // Apply x-variable-mapping
  if (schema) {
    finalParams = this.mapParamsToSchema(boundStep.mapped_params, schema, ctx)
  } else {
    finalParams = boundStep.mapped_params  // ❌ DIRECT COPY OF OBJECTS!
  }
}
```

**If there's no schema (or x-variable-mapping skip), objects are copied AS-IS!**

### ExecutionGraphCompiler Copies Objects to PILOT DSL

The compiler just passes config through:

```typescript
// ExecutionGraphCompiler.ts
config: operation.fetch.config  // Direct copy from IR
```

**Objects flow through unchanged: CapabilityBinderV2 → IR → PILOT DSL**

---

## The Fix

### Option 1: Fix CapabilityBinderV2 to Create Strings

```typescript
// CapabilityBinderV2.ts
if (contextBinding) {
  const configValue = this.findConfigValue(contextBinding.key, this.workflowConfig)
  if (configValue !== undefined) {
    // CREATE STRING FORMAT, NOT OBJECT
    result.params[paramName] = `{{config.${contextBinding.key}}}`
  }
}
```

**Pro:** Fixes at source
**Con:** Changes CapabilityBinderV2 behavior

### Option 2: Fix IntentToIRConverter to Convert Objects

```typescript
// IntentToIRConverter.ts in convertDataSource()
if (boundStep.mapped_params) {
  // Convert any {kind: "config"} objects to {{config.key}} strings
  finalParams = this.normalizeConfigObjects(boundStep.mapped_params)

  // Then apply x-variable-mapping
  if (schema) {
    finalParams = this.mapParamsToSchema(finalParams, schema, ctx)
  }
}

private normalizeConfigObjects(params: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = {}
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'object' && value.kind === 'config') {
      normalized[key] = `{{config.${value.key}}}`
    } else if (typeof value === 'object' && value.kind === 'ref') {
      const ref = value.field ? `${value.ref}.${value.field}` : value.ref
      normalized[key] = `{{${ref}}}`
    } else {
      normalized[key] = value
    }
  }
  return normalized
}
```

**Pro:** Defensive - handles objects from any source
**Con:** More code in IntentToIRConverter

### Option 3: Fix ExecutionGraphCompiler to Normalize Objects

```typescript
// ExecutionGraphCompiler.ts
private normalizeConfigReferences(config: any): any {
  if (!config) return config

  const normalized: any = {}
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'object' && value.kind === 'config') {
      normalized[key] = `{{config.${value.key}}}`
    } else if (typeof value === 'object' && value.kind === 'ref') {
      const ref = value.field ? `${value.ref}.${value.field}` : value.ref
      normalized[key] = `{{${ref}}}`
    } else if (typeof value === 'object' && value !== null) {
      normalized[key] = this.normalizeConfigReferences(value)  // Recursive
    } else {
      normalized[key] = value
    }
  }
  return normalized
}

// Use it when compiling action steps
const normalizedConfig = this.normalizeConfigReferences(operation.fetch.config)
```

**Pro:** Fixes right before PILOT DSL generation (last chance)
**Con:** Fixes symptom, not root cause

---

## Recommendation

**Implement Option 2: Fix in IntentToIRConverter**

**Why:**
1. ✅ IR should have string format (not objects) - this is the canonical representation
2. ✅ Defensive against objects from any source (CapabilityBinderV2, manual creation, etc.)
3. ✅ Centralized fix - all conversions go through IntentToIRConverter
4. ✅ Doesn't change CapabilityBinderV2 API (other code may depend on it)

**Implementation:**
1. Add `normalizeConfigObjects()` method to IntentToIRConverter
2. Call it in `convertDataSource()`, `convertDeliver()`, `convertArtifact()`, `convertExtract()`
3. Normalize BEFORE calling `mapParamsToSchema()`
4. Test with all 5 workflows

---

## Impact

**ALL 5 workflows are affected:**

1. **invoice-extraction:** `spreadsheet_id`, `folder_name` as objects
2. **complaint-logger:** `spreadsheet_id` as object
3. **expense-extractor:** No Google Sheets (may be OK)
4. **lead-sales-followup:** `spreadsheet_id` as object
5. **leads-filter:** `spreadsheet_id` as object ← **Discovered here**

**Current Status:** 🔴 0% of workflows will execute successfully

---

## Testing After Fix

```bash
# 1. Apply fix
# 2. Regenerate all PILOT DSLs
for workflow in complaint-logger expense-extractor invoice-extraction lead-sales-followup leads-filter; do
  npx tsx scripts/test-complete-pipeline-with-vocabulary.ts enhanced-prompt-$workflow.json
done

# 3. Verify PILOT DSL has strings, not objects
cat output/vocabulary-pipeline/pilot-dsl-steps.json | jq '.[] | select(.type=="action") | .config'

# Expected: ALL config values should be strings like "{{config.key}}"
# NOT objects like {"kind": "config", "key": "..."}
```

---

**USER WAS RIGHT: This step will never run as-is.**

**The "100% validation" completely missed this because it only checked parameter PRESENCE, not parameter FORMAT.**
