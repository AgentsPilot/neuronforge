# Data Flow Validation Status - V6 Pipeline

**Date:** 2026-03-06
**Issue:** step6 (google-mail.get_email_attachment) missing required `message_id` parameter

---

## Executive Summary

✅ **V6 Pipeline HAS comprehensive data flow validation via SchemaCompatibilityValidator**

❌ **But it's NOT catching the `message_id` issue because the LLM-generated flatten transform is missing the field in output_schema**

---

## What's Implemented: SchemaCompatibilityValidator

**File**: [lib/agentkit/v6/logical-ir/validation/SchemaCompatibilityValidator.ts](lib/agentkit/v6/logical-ir/validation/SchemaCompatibilityValidator.ts:1)

**Where It Runs**: IntentToIRConverter.convert() at line 141 (Phase 3 - IR Conversion)

**What It Does**:
1. **Builds variable output map** - Tracks which plugin/action produced each variable and what fields it provides
2. **Builds field requirements map** - Scans ALL downstream consumers to find what fields they need
3. **Cross-validates** - Checks if producer provides all fields that consumers need
4. **Auto-fixes mismatches** - Adds missing fields to transform output_schema

**Coverage**:
- ✅ Transform output → Action with x-variable-mapping (e.g., flatten → get_email_attachment)
- ✅ Transform output → Nested transform accessing fields (e.g., filter conditions)
- ✅ Transform output → Deliver mapping (e.g., append_rows with field mapping)
- ✅ Loop item variable → Actions/transforms inside loop body
- ✅ Action output → Downstream field access (e.g., drive_file.web_view_link)

**Plugin-Agnostic Design**:
- Uses x-variable-mapping metadata from plugin schemas (not hardcoded rules)
- Works with ANY plugin that declares field expectations
- Scales to custom plugins automatically

---

## Why It's NOT Catching message_id Issue

### Root Cause: LLM-Generated Schema is Incomplete

**The Problem Sequence**:

1. **Phase 1/2: Intent Generation (LLM)** - Generates IntentContract with flatten transform:
   ```json
   {
     "transform": {
       "op": "flatten",
       "output_schema": {
         "items": {
           "properties": {
             "id": {"type": "string"},
             "filename": {"type": "string"},
             "mimeType": {"type": "string"},
             "size": {"type": "number"},
             "sender": {"type": "string"},
             "subject": {"type": "string"}
             // ❌ MISSING: "message_id" field
           }
         }
       }
     }
   }
   ```

2. **Phase 3: IR Conversion** - IntentToIRConverter converts to ExecutionGraph, preserves the incomplete schema

3. **Phase 3: SchemaCompatibilityValidator runs** (line 141):

   **What it sees**:
   - ✅ `attachment` variable from flatten → filter → loop
   - ✅ `get_email_attachment` needs `message_id` (via x-variable-mapping)
   - ✅ Flatten output_schema declares: id, filename, mimeType, size, sender, subject
   - ❌ **`message_id` NOT in schema** → Should auto-fix!

4. **Expected Behavior**: SchemaCompatibilityValidator SHOULD:
   - Detect `message_id` is missing from flatten output_schema
   - Add `message_id` to flatten output_schema
   - Log: "AUTO-FIX: Added 'message_id' to node_1 output 'all_attachments' for google-mail.get_email_attachment.message_id"

5. **Actual Behavior**: ???
   - Need to check why auto-fix didn't trigger

---

## Investigation: Why Didn't Auto-Fix Trigger?

### Theory 1: x-variable-mapping Not Detected

SchemaCompatibilityValidator.buildFieldRequirementsMap() has method `extractActionVariableMappingRequirements()` (lines 351-386) that should:

```typescript
// Find input variables
const inputVars = node.inputs?.map((i) => i.variable.split('.')[0]) || []

for (const [paramName, paramDef] of Object.entries(schema.parameters.properties)) {
  const mapping = (paramDef as any)['x-variable-mapping']
  if (!mapping?.field_path) continue

  // This parameter expects a field from an input variable
  for (const inputVar of inputVars) {
    this.addFieldRequirement(requirements, inputVar, {
      field_name: mapping.field_path,  // ← "message_id"
      required_by_node: nodeId,
      required_by_operation: `${pluginKey}.${actionName}.${paramName}`,
      source: 'x-variable-mapping',
      is_required: schema.parameters.required?.includes(paramName) || false,
    })
  }
}
```

**Possible Issue**: The code looks for `node.inputs` to find input variables. Let me check if step6 (get_email_attachment) HAS inputs declared.

**Checking IR** (execution-graph-ir-v4.json, lines 132-156):
```json
{
  "id": "node_5",
  "type": "operation",
  "operation": {
    "operation_type": "fetch",
    "fetch": {
      "plugin_key": "google-mail",
      "action": "get_email_attachment",
      "config": {
        "attachment_id": {
          "kind": "ref",
          "ref": "attachment",
          "field": "id"
        }
      }
    }
  },
  "outputs": [{"variable": "attachment_content"}]
  // ❌ NO "inputs" ARRAY!
}
```

**AH HA!** Node_5 has NO `inputs` array declared! The validator can't detect which input variable to check!

### Root Cause Confirmed

**SchemaCompatibilityValidator line 369**:
```typescript
const inputVars = node.inputs?.map((i) => i.variable.split('.')[0]) || []
```

If `node.inputs` is undefined or empty, `inputVars = []`, so the loop at line 376 never executes, so no field requirements are added!

**The Fix Required**: IntentToIRConverter needs to populate `node.inputs` for fetch/deliver operations that reference variables in their config.

---

## How Gmail Plugin Schema Declares the Requirement

**File**: [lib/plugins/definitions/google-mail-plugin-v2.json](lib/plugins/definitions/google-mail-plugin-v2.json:694)

**get_email_attachment action** (lines 694-755):

```json
{
  "description": "Download email attachment content for processing",
  "required_params": ["message_id", "attachment_id"],
  "parameters": {
    "required": ["message_id", "attachment_id"],
    "properties": {
      "message_id": {
        "type": "string",
        "description": "Gmail message ID containing the attachment",
        "x-variable-mapping": {
          "field_path": "message_id",
          "description": "Extract message_id from attachment reference"
        }
      },
      "attachment_id": {
        "type": "string",
        "description": "Gmail attachment ID from search_emails result",
        "x-variable-mapping": {
          "field_path": "attachment_id",
          "description": "Extract attachment_id from attachment reference"
        }
      }
    }
  }
}
```

**search_emails output schema** (lines 409-432):
```json
{
  "attachments": {
    "description": "Attachment metadata (if include_attachments=true). Each item contains: filename, mimeType, size, attachment_id (use with get_email_attachment), message_id (email ID)",
    "items": {
      "properties": {
        "filename": {"type": "string"},
        "mimeType": {"type": "string"},
        "size": {"type": "integer"},
        "attachment_id": {
          "type": "string",
          "description": "Attachment ID (required for get_email_attachment action)"
        },
        "message_id": {
          "type": "string",
          "description": "Email message ID (required for get_email_attachment action)"
        }
      }
    }
  }
}
```

**The Schema is CLEAR**: Attachment objects from `search_emails` HAVE `message_id` field!

---

## The Actual Problem

**It's NOT a validation problem. It's a GENERATION problem.**

1. ✅ Gmail plugin schema correctly declares attachments HAVE `message_id`
2. ✅ SchemaCompatibilityValidator is implemented and working
3. ❌ **LLM (Phase 1/2) generates incomplete flatten output_schema** without `message_id`
4. ❌ **IntentToIRConverter doesn't populate node.inputs** for actions that reference variables
5. ❌ SchemaCompatibilityValidator can't detect the issue because it has no inputs to analyze

---

## The Fix

### Option 1: Fix IntentToIRConverter to Populate node.inputs

**Where**: IntentToIRConverter.buildOperationNode() or buildFetchOperation()

**What**: When building a fetch/deliver operation, scan the config for variable references and add them to node.inputs:

```typescript
private buildFetchOperation(step: BoundStep, ctx: ConversionContext): OperationConfig {
  const config = this.buildOperationConfig(step)

  // NEW: Extract input variables from config references
  const inputVars = this.extractVariableReferences(config)

  return {
    operation_type: 'fetch',
    fetch: {
      plugin_key: step.plugin_key,
      action: step.action,
      config
    },
    // ADD THIS:
    inputs: inputVars.map(v => ({ variable: v }))
  }
}

private extractVariableReferences(config: any): string[] {
  const vars = new Set<string>()

  function scan(obj: any) {
    if (typeof obj === 'object' && obj !== null) {
      if ('ref' in obj) {
        vars.add(obj.ref)
      }
      for (const value of Object.values(obj)) {
        scan(value)
      }
    }
  }

  scan(config)
  return Array.from(vars)
}
```

This would make SchemaCompatibilityValidator work as designed.

### Option 2: Fix SchemaCompatibilityValidator to Scan Config for Variable References

**Where**: SchemaCompatibilityValidator.extractActionVariableMappingRequirements()

**What**: If node.inputs is empty, scan operation config for variable references:

```typescript
// Find input variables from node.inputs OR scan config
let inputVars = node.inputs?.map((i) => i.variable.split('.')[0]) || []

// FALLBACK: If no inputs declared, scan config for variable references
if (inputVars.length === 0 && (op.fetch?.config || op.deliver?.config)) {
  const config = op.fetch?.config || op.deliver?.config
  inputVars = this.extractVariableReferencesFromConfig(config)
}
```

This is more defensive but adds complexity.

### Option 3: Fix LLM Prompt to Always Include Parent IDs in Flatten

**Where**: Phase 1/2 prompt (but you said we're NOT using formalization-system-v4.md anymore)

**What**: Ensure LLM includes parent entity IDs when flattening nested structures.

**Problem**: We're skipping Phases 1 & 2 now (V6PipelineOrchestrator lines 143-249), so there's no prompt to fix!

---

## Recommendation

**Implement Option 1: Fix IntentToIRConverter to populate node.inputs**

**Why**:
- ✅ Makes SchemaCompatibilityValidator work as designed
- ✅ Explicit is better than implicit (inputs should always be declared)
- ✅ Helps other validators too (ExecutionGraphValidator, FieldReferenceValidator)
- ✅ No complex config scanning needed
- ✅ Clean separation: IR Converter handles structure, Validator handles validation

**Implementation**:
1. Add `extractVariableReferences()` method to IntentToIRConverter
2. Call it in `buildFetchOperation()` and `buildDeliverOperation()`
3. Populate `operation.inputs` with extracted variable names
4. SchemaCompatibilityValidator will automatically detect the missing field and auto-fix it

**Expected Result**:
- SchemaCompatibilityValidator will detect `attachment.message_id` is required
- It will add `message_id` to flatten output_schema
- Workflow will have ALL required parameters

---

## Summary Table

| Component | Status | Notes |
|-----------|--------|-------|
| SchemaCompatibilityValidator | ✅ Implemented | Comprehensive, plugin-agnostic, auto-fixes |
| ExecutionGraphValidator | ✅ Implemented | Validates structure, data flow, control flow |
| FieldReferenceValidator | ✅ Implemented | Validates field paths against schemas |
| ValidationGates | ✅ Implemented | 5 gates across pipeline phases |
| **node.inputs population** | ❌ Missing | IntentToIRConverter doesn't extract input vars |
| **Flatten output_schema** | ❌ Incomplete | LLM doesn't include parent IDs |

**Conclusion**: V6 pipeline HAS excellent data flow validation infrastructure. The `message_id` issue is caused by missing `node.inputs` declarations, which prevents SchemaCompatibilityValidator from detecting the requirement.

---

**Next Step**: Implement Option 1 - Add input variable extraction to IntentToIRConverter.

