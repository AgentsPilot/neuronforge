# Binding Phase Example: Complaint Logger Google Sheets Step

**Date:** 2026-03-06

---

## The Workflow

**Complaint Logger** workflow needs to append complaint emails to Google Sheets with these fields:
- sender_email
- subject
- date
- full_email_text
- gmail_message_id

---

## Phase-by-Phase Breakdown

### Phase 1: IntentContract Generation (LLM)

**Output**: Abstract workflow with generic payload

```json
{
  "kind": "deliver",
  "id": "step_10",
  "description": "Append complaint email to Google Sheets",
  "payload": {
    "spreadsheet_id": {"kind": "config", "key": "spreadsheet_id"},
    "tab_name": {"kind": "config", "key": "sheet_tab_name"}
  },
  "deliver": {
    "input": "extracted_fields",
    "mapping": [
      {"from": {"kind": "ref", "ref": "extracted_fields", "field": "sender_email"}, "to": "sender_email"},
      {"from": {"kind": "ref", "ref": "extracted_fields", "field": "subject"}, "to": "subject"},
      {"from": {"kind": "ref", "ref": "extracted_fields", "field": "date"}, "to": "date"},
      {"from": {"kind": "ref", "ref": "extracted_fields", "field": "full_email_text"}, "to": "full_email_text"},
      {"from": {"kind": "ref", "ref": "extracted_fields", "field": "gmail_message_id"}, "to": "gmail_message_id"}
    ]
  },
  "uses": [{
    "domain": "table",
    "capability": "write",
    "preferences": {
      "provider_family": "google"
    }
  }],
  "output": "sheet_row"
}
```

**Key Points**:
- ✅ Has `deliver.mapping` array specifying which fields to write
- ✅ Has `payload` with config references
- ❌ No `values` parameter yet (abstract format)

---

### Phase 2: Capability Binding (CapabilityBinderV2)

#### Step 2.1: Find Candidate Actions

**Input**: `domain: "table", capability: "write", provider_family: "google"`

**Candidates Found**:
1. `google-sheets.append_rows` (score: 1.5)
   - domain: "table" ✅
   - capability: "write" ✅
   - provider_family: "google" ✅

**Best Match**: `google-sheets.append_rows`

#### Step 2.2: Bind to Plugin Action

**BoundStep** (lines 300-305):
```json
{
  "kind": "deliver",
  "id": "step_10",
  "plugin_key": "google-sheets",         // ← ADDED
  "action": "append_rows",                // ← ADDED
  "binding_confidence": 1.0,              // ← ADDED
  "binding_method": "exact_match",        // ← ADDED
  "binding_reason": ["domain+capability", "provider_family"], // ← ADDED
  "payload": {...},  // Original payload preserved
  "deliver": {...}   // Original deliver preserved
}
```

#### Step 2.3: Map Parameters at Binding Time

**File**: `CapabilityBinderV2.ts` (lines 318-348)

**Called**: `mapPayloadToSchema(step, best.action, workflowConfig)`

**Google Sheets `append_rows` Schema**:
```json
{
  "parameters": {
    "type": "object",
    "required": ["spreadsheet_id", "range", "values"],
    "properties": {
      "spreadsheet_id": {
        "type": "string",
        "x-context-binding": {
          "source": "workflow_config",
          "key": "spreadsheet_id"
        }
      },
      "range": {
        "type": "string",
        "x-artifact-field": "tab_name",
        "x-context-binding": {
          "source": "workflow_config",
          "key": "range"
        }
      },
      "values": {
        "type": "array",
        "items": {
          "type": "array",
          "items": {"type": "string"}
        }
      }
    }
  }
}
```

**Workflow Config** (from IntentContract):
```json
[
  {"key": "user_email", "value": "offir.omer@gmail.com"},
  {"key": "spreadsheet_id", "value": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc"},
  {"key": "sheet_tab_name", "value": "UrgentEmails"},
  {"key": "gmail_scope", "value": "Inbox"},
  {"key": "data_time_window", "value": "last 7 days"}
]
```

#### Mapping Process

**Phase 2.1: x-from-artifact** (lines 402-424)
- Skipped (not an artifact step)

**Phase 2.2: x-variable-mapping** (lines 426-427)
- Skipped (variables don't exist yet)
- Comment says: "Variable references don't exist yet - this is handled at IR conversion time"

**Phase 2.3: x-context-binding** (lines 429-477)

For `spreadsheet_id`:
```typescript
// Schema has: x-context-binding: {key: "spreadsheet_id"}
// Exact match in config: spreadsheet_id ✅
// Result: spreadsheet_id = "{{config.spreadsheet_id}}"
```

For `range`:
```typescript
// Schema has: x-context-binding: {key: "range"}
// Exact match in config: range ❌ NOT FOUND
// Try fuzzy matching...
// No match found (range doesn't match any config key)
```

**Phase 2.4: Auto-inject required params** (lines 479-518)

For `range` (required, but not mapped):
```typescript
// Use x-artifact-field hint: "tab_name"
// Search for "tab_name" in workflow config
// Fuzzy match: "sheet_tab_name" (score: 0.67) ✅
// Result: range = "{{config.sheet_tab_name}}"
```

For `values` (required, but not mapped):
```typescript
// No x-artifact-field hint
// Search for "values" in workflow config
// No match found ❌
// Result: ERROR - "Required parameter 'values' not found in workflow config"
```

#### Mapping Result

**BoundStep.mapped_params** (line 321):
```json
{
  "spreadsheet_id": "{{config.spreadsheet_id}}",
  "range": "{{config.sheet_tab_name}}"
  // ❌ MISSING: "values" parameter
}
```

**Warnings** (line 334):
```
- "Required parameter 'range' auto-injected from 'sheet_tab_name' (fuzzy match)"
```

**Errors** (line 342):
```
- "Required parameter 'values' not found in workflow config"
```

---

### Why `values` Can't Be Mapped at Binding Time

**The Problem**:

1. **No source data**: The workflow config doesn't have a "values" key
2. **Needs semantic transformation**: The `values` parameter needs to be CONSTRUCTED from the `deliver.mapping` array
3. **Requires variable resolution**: `deliver.mapping` references `extracted_fields.sender_email`, etc., which are variables that don't exist yet

**The deliver.mapping array**:
```json
{
  "mapping": [
    {"from": {"ref": "extracted_fields", "field": "sender_email"}, "to": "sender_email"},
    {"from": {"ref": "extracted_fields", "field": "subject"}, "to": "subject"},
    ...
  ]
}
```

**What we NEED to create**:
```json
{
  "values": [[
    "{{extracted_fields.sender_email}}",
    "{{extracted_fields.subject}}",
    "{{extracted_fields.date}}",
    "{{extracted_fields.full_email_text}}",
    "{{extracted_fields.gmail_message_id}}"
  ]]
}
```

**Why binding time can't do this**:

1. ❌ **deliver.mapping** is NOT processed yet (handled at IR conversion)
2. ❌ **Variable references** like `extracted_fields` don't exist yet
3. ❌ **Field order** isn't determined (comes from mapping array order)
4. ❌ **Type conversion** (object → 2D array) requires semantic understanding

**Lines 520-524 explain this**:
```typescript
// TODO: Implement format transformations
// e.g., tab_name → range: "{{config.tab_name}}" (with A1 notation if needed)

// TODO: Implement structure conversions
// e.g., fields object → values: [[...]] array for Google Sheets
```

---

### Phase 3: IR Conversion (IntentToIRConverter)

**This is where the `values` parameter SHOULD be created.**

#### Step 3.1: Process deliver.mapping (lines 761-770)

**Input**: `deliver.mapping` array from IntentContract

**Code** (IntentToIRConverter.ts):
```typescript
// Add field mappings if present
if (step.deliver.mapping && step.deliver.mapping.length > 0) {
  genericParams.fields = step.deliver.mapping.reduce((acc: any, m: any) => {
    const value = typeof m.from === 'object' && 'ref' in m.from
      ? this.resolveRefName(m.from.ref, ctx) + (m.from.field ? `.${m.from.field}` : '')
      : this.resolveValueRef(m.from, ctx)

    acc[m.to] = value
    return acc
  }, {} as Record<string, any>)
}
```

**Result**: `fields` object created
```json
{
  "fields": {
    "sender_email": "{{extracted_fields.sender_email}}",
    "subject": "{{extracted_fields.subject}}",
    "date": "{{extracted_fields.date}}",
    "full_email_text": "{{extracted_fields.full_email_text}}",
    "gmail_message_id": "{{extracted_fields.gmail_message_id}}"
  }
}
```

#### Step 3.2: Call mapParamsToSchema (line 813)

**Input**:
- `genericParams.fields` (object)
- `schema` (Google Sheets append_rows schema)

**Conversion Logic** (lines 1430-1449):
```typescript
// STRUCTURE CONVERSION: Convert fields object → values array
if (genericParams.fields && !mappedParams.values && paramSchema.values) {
  const valuesSchema = paramSchema.values as any

  // Check if values parameter expects a 2D array
  if (valuesSchema.type === 'array' && valuesSchema.items?.type === 'array') {
    // Convert fields object to single row array
    const fieldValues = Object.values(genericParams.fields)
    mappedParams.values = [fieldValues]

    logger.debug(`  → Converted fields object to values array (${fieldValues.length} columns)`)

    // Remove fields from output
    delete mappedParams.fields
  }
}
```

**Result**: `values` parameter created
```json
{
  "values": [[
    "{{extracted_fields.sender_email}}",
    "{{extracted_fields.subject}}",
    "{{extracted_fields.date}}",
    "{{extracted_fields.full_email_text}}",
    "{{extracted_fields.gmail_message_id}}"
  ]]
}
```

#### Step 3.3: Merge with binding-time params

**Final IR config**:
```json
{
  "operation_type": "deliver",
  "deliver": {
    "plugin_key": "google-sheets",
    "action": "append_rows",
    "config": {
      "spreadsheet_id": "{{config.spreadsheet_id}}",  // From Phase 2
      "range": "{{config.sheet_tab_name}}",            // From Phase 2
      "values": [[                                      // From Phase 3
        "{{extracted_fields.sender_email}}",
        "{{extracted_fields.subject}}",
        "{{extracted_fields.date}}",
        "{{extracted_fields.full_email_text}}",
        "{{extracted_fields.gmail_message_id}}"
      ]]
    }
  }
}
```

✅ **ALL 3 REQUIRED PARAMETERS PRESENT!**

---

## Summary: Division of Responsibilities

### Phase 2 (Binding) CAN Do:
- ✅ x-from-artifact (from artifact.options)
- ✅ x-context-binding (from workflow config)
- ✅ Auto-inject required params (fuzzy matching workflow config)
- ❌ **CANNOT** create `values` parameter (no semantic transformation yet)

### Phase 3 (IR Conversion) MUST Do:
- ✅ Process deliver.mapping → create fields object
- ✅ x-variable-mapping (decompose variables)
- ✅ Structure conversion (fields → values array)
- ✅ Format transformations (A1 notation, etc.)

### Why This Division Makes Sense

**At Phase 2 (Binding)**:
- We have: plugin schema, workflow config
- We DON'T have: variable references, deliver.mapping processed

**At Phase 3 (IR Conversion)**:
- We have: plugin schema, workflow config, variables, processed deliver.mapping
- We CAN: Perform semantic transformations like fields → values

---

## The Invoice Extraction Problem

**The Invoice Extraction workflow** generated by the LLM has this structure:

```json
{
  "deliver": {
    "plugin_key": "google-sheets",
    "action": "append_rows",
    "config": {
      "range": "{{config.sheet_tab_name}}"
    }
    // ❌ NO deliver.mapping array!
  }
}
```

**Result**:
- Phase 2: Injects `spreadsheet_id` and `range` ✅
- Phase 3: No `deliver.mapping` → no `fields` object → no `values` conversion ❌

**This is an LLM generation problem**, not a conversion problem. The LLM should generate:

```json
{
  "deliver": {
    "input": "transaction",
    "mapping": [
      {"from": {"ref": "transaction", "field": "date"}, "to": "date"},
      {"from": {"ref": "transaction", "field": "vendor"}, "to": "vendor"},
      {"from": {"ref": "transaction", "field": "amount"}, "to": "amount"},
      ...
    ]
  }
}
```

Then the Phase 3 conversion would work correctly.

---

**Conclusion**: The binding phase (Phase 2) does what it CAN (inject config params), but it CANNOT create the `values` parameter because that requires semantic transformation of the `deliver.mapping` array, which happens at Phase 3 (IR Conversion).
