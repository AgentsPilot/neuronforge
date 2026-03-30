# Binding Phase Root Cause Analysis

**Date**: 2026-03-09
**Status**: Investigation Complete - Root Causes Identified
**Context**: Invoice extraction workflow validation failed with 3 parameter mapping errors

---

## Executive Summary

The validation errors are **NOT caused by binding phase logic** - the binding phase is working correctly. The root causes are:

1. **Error #1 & #2**: **IntentContract field name mismatch** - Phase 1 (LLM) generated incorrect field names
2. **Error #3**: **Config key aliasing issue** - Phase 3/4 can't map `google_sheet_id_candidate` to `spreadsheet_id`

---

## Investigation Findings

### Phase 2 (Binding) Works Correctly

**File**: `lib/agentkit/v6/capability-binding/CapabilityBinderV2.ts`

The `mapPayloadToSchema()` method (lines 370-658) implements comprehensive parameter mapping:

✅ **PHASE 2.1**: x-from-artifact handling (lines 402-424)
✅ **PHASE 2.2**: x-variable-mapping **explicitly skipped** (lines 426-427) - "Variable references don't exist yet"
✅ **PHASE 2.3**: x-context-binding injection (lines 429-477)
✅ **PHASE 2.4**: Auto-inject missing required parameters (lines 479-518)
✅ **PHASE 2.5**: Structure conversions (deliver.mapping → values array) (lines 520-574)
✅ **PHASE 2.6**: Format transformations (lines 576-622)

**Key Design Decision**: x-variable-mapping is deferred to Phase 3 (IR Conversion) because:
- Loop item variables don't exist at binding time
- Variable references are created during IR graph construction
- This is the correct architectural choice

---

## Root Cause #1 & #2: Field Name Mismatch in IntentContract

### The Problem

**IntentContract** (Phase 1 output):
```json
{
  "id": "download_attachment_content",
  "payload": {
    "attachment_id": {
      "kind": "ref",
      "ref": "attachment",
      "field": "id"          // ❌ WRONG: should be "attachment_id"
    },
    "email_id": {
      "kind": "ref",
      "ref": "attachment",
      "field": "email_id"    // ❌ WRONG: should be "message_id"
    }
  }
}
```

**Plugin Schema** (`google-mail-plugin-v2.json` lines 731-745):
```json
{
  "message_id": {
    "type": "string",
    "x-variable-mapping": {
      "field_path": "message_id"  // Expects "message_id"
    }
  },
  "attachment_id": {
    "type": "string",
    "x-variable-mapping": {
      "field_path": "attachment_id"  // Expects "attachment_id"
    }
  }
}
```

### Why This Happens

**Phase 1 (IntentContract Generation)** - LLM-powered
- LLM generates abstract payload with field names
- LLM chose `email_id` and `id` instead of `message_id` and `attachment_id`
- The LLM doesn't have context that plugin expects specific field names

**Phase 3 (IntentToIRConverter)** - Handles x-variable-mapping (lines 1561-1587)
```typescript
// Lines 1561-1587: Handle structured refs that need x-variable-mapping application
for (const [paramName, paramDef] of Object.entries(paramSchema)) {
  const mapping = (paramDef as ActionParameterProperty)['x-variable-mapping']
  if (!mapping?.field_path) continue

  // Look for a structured ref that has the right variable
  for (const [genericKey, genericValue] of Object.entries(genericParams)) {
    if (typeof genericValue === 'object' && genericValue?.kind === 'ref' && genericValue?.ref) {
      // Apply x-variable-mapping: use the field_path from schema
      mappedParams[paramName] = {
        kind: 'ref',
        ref: genericValue.ref,
        field: mapping.field_path  // ✅ Uses field_path from schema
      }
      break
    }
  }
}
```

**The Issue**:
- This code **overwrites** the `field` from IntentContract with `field_path` from schema
- BUT it only works if there's a genericParam key that matches
- The IntentContract has keys `attachment_id` and `email_id` (payload param names)
- The schema expects keys `message_id` and `attachment_id` (plugin param names)
- **Mismatch**: IntentContract `email_id` ≠ Plugin schema `message_id`

### The Fix

**Option A**: Fix Phase 1 (IntentContract Generation) - LLM prompt
- Update IRFormalizer system prompt to emphasize using field names from plugin schemas
- For data_source steps, payload field names should match plugin parameter names

**Option B**: Fix Phase 3 (IntentToIRConverter) - Smarter matching
- When applying x-variable-mapping, match ANY structured ref (not just matching param names)
- Loop through ALL genericParams with structured refs, apply field_path from schema

**Recommended**: **Option B** (more robust, doesn't rely on LLM consistency)

---

## Root Cause #3: Config Key Aliasing Issue

### The Problem

**Enhanced Prompt** (`enhanced-prompt-invoice-extraction.json` line 58):
```json
{
  "key": "google_sheet_id_candidate",
  "value": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc"
}
```

**Plugin Schema** (`google-sheets-plugin-v2.json`):
```json
{
  "spreadsheet_id": {
    "type": "string",
    "x-context-binding": {
      "source": "workflow_config",
      "key": "spreadsheet_id"  // ❌ Expects "spreadsheet_id", not "google_sheet_id_candidate"
    }
  }
}
```

**Validation Error**:
```
step14.step15: Missing required parameter 'spreadsheet_id' for google-sheets.append_rows
```

### Why This Happens

**Phase 2 (CapabilityBinderV2)** - Tries to inject (lines 429-477):
1. Exact match: `spreadsheet_id` ≠ `google_sheet_id_candidate` ❌
2. Fuzzy match with threshold 0.33:
   - Token overlap: `spreadsheet_id` vs `google_sheet_id_candidate`
   - Score: ~0.20 (below threshold) ❌
3. Result: Parameter not injected

**Phase 3 (IntentToIRConverter)** - Tries again (lines 1621-1642):
1. x-context-binding exact match fails ❌
2. No fuzzy matching fallback in this phase

**Phase 4 (ExecutionGraphCompiler)** - Tries auto-injection (lines 3521, 3570):
1. Fuzzy match with threshold 0.5 (after our fix)
2. Score: ~0.20 (below threshold) ❌
3. Result: Parameter still not injected

### The Fix

**Option A**: Fix Enhanced Prompt - Use exact key name
- Change `google_sheet_id_candidate` → `spreadsheet_id`
- Requires regenerating all prompts (not scalable)

**Option B**: Add config key alias mapping
- Create alias map: `google_sheet_id_candidate` → `spreadsheet_id`
- Apply aliases during config parameter injection
- More robust, handles variations

**Option C**: Lower fuzzy matching threshold for config keys
- Change threshold from 0.33 to 0.20
- Risk: May cause false positives

**Recommended**: **Option B** (most robust, prevents future issues)

---

## Summary: What Works, What Doesn't

### ✅ What Works Correctly

1. **Phase 2 (Binding)**: Correctly binds steps to plugin actions
2. **Phase 2 (Binding)**: Correctly injects x-context-binding params (when keys match)
3. **Phase 2 (Binding)**: Correctly handles x-from-artifact params
4. **Phase 2 (Binding)**: Correctly converts deliver.mapping → values arrays
5. **Phase 3 (IR Conversion)**: Correctly handles x-variable-mapping (when field names match)
6. **Phase 3 (IR Conversion)**: Correctly converts fields → values
7. **Phase 3 (IR Conversion)**: Correctly transforms tab_name → range with A1 notation
8. **Phase 5 (Validation)**: Successfully detects missing parameters ✅

### ❌ What Doesn't Work

1. **Phase 1 (IntentContract)**: LLM generates incorrect field names
   - `email_id` instead of `message_id`
   - `id` instead of `attachment_id`

2. **Phase 3 (IR Conversion)**: x-variable-mapping doesn't handle field name mismatches
   - Only applies field_path when param name already matches
   - Doesn't search across ALL structured refs

3. **Phases 2-4 (All)**: Config key aliases not handled
   - `google_sheet_id_candidate` vs `spreadsheet_id`
   - Fuzzy matching score too low (0.20 < 0.33)

---

## Recommended Fix Order

### Priority 1: Fix x-variable-mapping Field Name Mismatch

**File**: `lib/agentkit/v6/compiler/IntentToIRConverter.ts`
**Lines**: 1561-1587 (x-variable-mapping structured refs)

**Current Logic**:
```typescript
// Only applies if genericKey exists in genericParams
for (const [genericKey, genericValue] of Object.entries(genericParams)) {
  if (typeof genericValue === 'object' && genericValue?.kind === 'ref') {
    mappedParams[paramName] = {
      kind: 'ref',
      ref: genericValue.ref,
      field: mapping.field_path  // Overwrites field with schema field_path
    }
    break
  }
}
```

**Fixed Logic**:
```typescript
// Try to find ANY structured ref in genericParams, regardless of key name
let foundRef = false
for (const [genericKey, genericValue] of Object.entries(genericParams)) {
  // Skip generic control params
  if (genericKey === 'data' || genericKey === 'destination' || genericKey === 'input_ref') continue

  // Check if this is a structured ref with the loop variable
  if (typeof genericValue === 'object' && genericValue?.kind === 'ref' && genericValue?.ref) {
    // Apply x-variable-mapping: use the field_path from schema
    mappedParams[paramName] = {
      kind: 'ref',
      ref: genericValue.ref,
      field: mapping.field_path
    }
    logger.debug(`  → Applied x-variable-mapping: ${paramName} = {{${genericValue.ref}.${mapping.field_path}}}`)
    foundRef = true
    break
  }
}

// Fallback: If still not found, check if ANY genericParam is a simple variable reference
if (!foundRef) {
  for (const [genericKey, genericValue] of Object.entries(genericParams)) {
    if (typeof genericValue === 'string' && genericValue.includes('{{') && genericValue.includes('}}')) {
      // Extract variable name from {{variable}} format
      const varMatch = genericValue.match(/\{\{([^}]+)\}\}/)
      if (varMatch) {
        const varName = varMatch[1]
        mappedParams[paramName] = `{{${varName}.${mapping.field_path}}}`
        logger.debug(`  → Applied x-variable-mapping (string ref): ${paramName} = {{${varName}.${mapping.field_path}}}`)
        break
      }
    }
  }
}
```

**Impact**: Fixes Error #1 & #2 (message_id, attachment_id)

---

### Priority 2: Add Config Key Alias Mapping

**File**: `lib/agentkit/v6/compiler/IntentToIRConverter.ts`
**Lines**: 1621-1642 (x-context-binding injection)

**Add Config Alias Map**:
```typescript
// Common config key aliases (add at top of file or as class property)
const CONFIG_KEY_ALIASES: Record<string, string[]> = {
  'spreadsheet_id': ['google_sheet_id', 'sheet_id', 'google_sheet_id_candidate'],
  'sheet_tab_name': ['tab_name', 'sheet_name'],
  'drive_folder_name': ['folder_name'],
  'user_email': ['email', 'recipient_email']
}

// Reverse map for quick lookup
const ALIAS_TO_CANONICAL: Record<string, string> = {}
for (const [canonical, aliases] of Object.entries(CONFIG_KEY_ALIASES)) {
  for (const alias of aliases) {
    ALIAS_TO_CANONICAL[alias] = canonical
  }
}
```

**Enhanced x-context-binding Logic**:
```typescript
// Lines 1621-1642: Enhanced version
for (const [paramName, paramDef] of Object.entries(paramSchema)) {
  if (mappedParams[paramName]) continue

  const contextBinding = (paramDef as any)['x-context-binding']
  if (contextBinding) {
    const configKey = contextBinding.key

    // Try exact match first
    let configParam = ctx.config?.find(c => c.key === configKey)

    // If not found, try aliases
    if (!configParam) {
      // Check if configKey has aliases
      const aliases = CONFIG_KEY_ALIASES[configKey] || []
      for (const alias of aliases) {
        configParam = ctx.config?.find(c => c.key === alias)
        if (configParam) {
          logger.debug(`  → Found config alias: ${alias} → ${configKey}`)
          break
        }
      }

      // Also check reverse: if config has alias, map to canonical
      if (!configParam) {
        for (const configItem of ctx.config || []) {
          const canonical = ALIAS_TO_CANONICAL[configItem.key]
          if (canonical === configKey) {
            configParam = configItem
            logger.debug(`  → Found canonical mapping: ${configItem.key} → ${configKey}`)
            break
          }
        }
      }
    }

    if (configParam) {
      mappedParams[paramName] = `{{config.${configParam.key}}}`
      logger.debug(`  → Injected ${paramName} from workflow config: {{config.${configParam.key}}}`)
    } else {
      if (contextBinding.required) {
        logger.warn(`  → Required config parameter '${configKey}' not found for '${paramName}'`)
      }
    }
  }
}
```

**Impact**: Fixes Error #3 (spreadsheet_id)

---

## Testing Plan

### Test 1: Invoice Extraction (Current Failing Case)

**Expected Before Fix**:
- ❌ step5.step6: Missing `message_id` parameter
- ❌ step5.step6: Missing `attachment_id` parameter
- ❌ step14.step15: Missing `spreadsheet_id` parameter

**Expected After Fix**:
- ✅ step5.step6: Has `message_id: "{{attachment.message_id}}"`
- ✅ step5.step6: Has `attachment_id: "{{attachment.attachment_id}}"`
- ✅ step14.step15: Has `spreadsheet_id: "{{config.google_sheet_id_candidate}}"`

### Test 2: Validate No Regressions

Run all existing workflows:
1. Lead Sales Follow-up ✅ (should still pass)
2. Expense Extraction ✅ (should still pass)
3. Expense Summary ✅ (should still pass)
4. Complaint Logger ✅ (should now pass)

---

## Bottom Line

**The binding phase (Phase 2) is working correctly.** The issues are:

1. ❌ **Phase 1 (LLM)**: Generates incorrect field names in IntentContract payload
2. ❌ **Phase 3 (IR Conversion)**: x-variable-mapping logic too strict, doesn't handle field name mismatches
3. ❌ **Phase 3 (IR Conversion)**: No config key alias handling

**Recommended Fixes**:
1. ✅ Fix IntentToIRConverter x-variable-mapping to search ALL structured refs (Priority 1)
2. ✅ Add config key alias mapping to IntentToIRConverter (Priority 2)

**Effort**: 4-6 hours total
**Impact**: Fixes all 3 validation errors + prevents future field name mismatch issues
