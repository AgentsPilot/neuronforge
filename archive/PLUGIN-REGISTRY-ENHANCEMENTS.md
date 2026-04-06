# Plugin Registry Schema Enhancements

## Overview

Based on the OpenAI review of the generated PILOT DSL workflow, this document outlines necessary enhancements to the plugin registry schema. These enhancements will enable more accurate LLM-generated workflows and better compiler validation without hardcoding rules.

**Key Principle**: All enhancements follow the data-driven, schema-based approach outlined in [CLAUDE.md](CLAUDE.md) - no hardcoded rules in system prompts.

---

## Current Schema Capabilities

The plugin registry currently supports (examining [google-sheets-plugin-v2.json](lib/plugins/definitions/google-sheets-plugin-v2.json)):

✅ **Already Available**:
- `idempotent: boolean` - Flags whether action can be safely re-run
- `idempotent_alternative: string` - Points to idempotent version (e.g., `get_or_create_folder`)
- `required_params: string[]` - Lists required parameter names
- `optional_params: string[]` - Lists optional parameter names
- `output_fields: string[]` - Lists field names present in output
- `output_schema: JSONSchema` - Full output structure with types
- `parameters: JSONSchema` - Input parameter schema with validation
- `domain: string` - Plugin domain (e.g., "table", "storage", "email")
- `capability: string` - Action capability (e.g., "get", "create", "append")

---

## Issues from OpenAI Review

### Category Breakdown

| Category | Count | Status |
|----------|-------|--------|
| Compiler Enhancement | 1 | In progress |
| Registry/Schema Enhancements | 5 | **This document** |
| LLM/Prompt Issues | 1 | Separate work |

---

## Proposed Registry Enhancements

### Enhancement 1: Output Field Guarantees

**Problem**: Compiler doesn't know that `read_range` returns `.values` field for downstream normalization.

**Example from pilot_steps.json (step14-15)**:
```json
{
  "step_id": "step14",
  "operation": "read_range",
  "output_variable": "expense_sheet"
},
{
  "step_id": "step15",
  "operation": "rows_to_objects",
  "input": "{{expense_sheet.values}}"  // ← How do we know .values exists?
}
```

**Current Schema** ([google-sheets-plugin-v2.json:40-45](lib/plugins/definitions/google-sheets-plugin-v2.json#L40-L45)):
```json
"output_fields": [
  "range",
  "values",
  "row_count",
  "column_count"
]
```

**Limitation**: List of field names, but no type information or guaranteed presence.

**Proposed Enhancement**:
```json
"output_schema": {
  "type": "object",
  "properties": {
    "range": { "type": "string" },
    "values": {
      "type": "array",
      "items": { "type": "array", "items": { "type": "string" } },
      "x-guaranteed": true  // ← NEW: Always present
    },
    "row_count": { "type": "integer", "x-guaranteed": true },
    "column_count": { "type": "integer", "x-guaranteed": true }
  },
  "required": ["range", "values", "row_count", "column_count"]
}
```

**Benefits**:
- Compiler can validate `expense_sheet.values` exists before normalization
- LLM knows which fields are safe to use downstream
- Runtime validation can warn if plugin violates contract

**Implementation**:
- Add `x-guaranteed: boolean` to output schema properties
- ExecutionGraphCompiler checks field paths against guaranteed fields
- Vocabulary extractor includes guaranteed fields in action descriptions

---

### Enhancement 2: Parameter Field Mapping

**Problem**: Upload operations don't specify how to map input data to config parameters.

**Example from pilot_steps.json (step5)**:
```json
{
  "step_id": "step5",
  "operation": "upload_file",
  "config": {
    "data": "{{attachment}}",
    "destination": "{{drive_folder}}",
    "fields": {
      "file_content": "{{attachment.content}}",
      "file_name": "{{attachment.filename}}"
    }
  }
}
```

**Issues**:
1. Config has both `data` and `fields` - which one to use?
2. `destination: "{{drive_folder}}"` is a folder object, but param needs `folder_id` string
3. No schema guidance on how to extract `folder_id` from folder object

**Current Schema** ([google-drive-plugin-v2.json:919-981](lib/plugins/definitions/google-drive-plugin-v2.json#L919-L981)):
```json
"parameters": {
  "type": "object",
  "required": ["file_content", "file_name"],
  "properties": {
    "file_content": {
      "type": "string",
      "description": "File content (base64 encoded for binary files, or plain text)"
    },
    "file_name": {
      "type": "string",
      "description": "Name for the uploaded file"
    },
    "folder_id": {
      "type": "string",
      "description": "ID of the folder to upload to. If not provided, uploads to root"
    }
  }
}
```

**Proposed Enhancement**:
```json
"parameters": {
  "type": "object",
  "required": ["file_content", "file_name"],
  "properties": {
    "file_content": {
      "type": "string",
      "description": "File content (base64 encoded for binary files, or plain text)",
      "x-variable-mapping": {
        "from_type": "file_attachment",
        "field_path": "content",
        "description": "Extract content from attachment object"
      }
    },
    "file_name": {
      "type": "string",
      "description": "Name for the uploaded file",
      "x-variable-mapping": {
        "from_type": "file_attachment",
        "field_path": "filename",
        "description": "Extract filename from attachment object"
      }
    },
    "folder_id": {
      "type": "string",
      "description": "ID of the folder to upload to",
      "x-variable-mapping": {
        "from_type": "folder",
        "field_path": "id",
        "description": "Extract folder ID from folder object"
      }
    }
  }
}
```

**Benefits**:
- LLM learns to extract `folder_id` from folder objects automatically
- Compiler can validate and auto-fix incorrect mappings
- Clear documentation of expected input structure

**Implementation**:
- Add `x-variable-mapping` to parameter schema properties
- IntentToIRConverter uses mappings to generate correct config
- ExecutionGraphCompiler normalizes based on mappings

---

### Enhancement 3: Input Type Specifications

**Problem**: document-extractor doesn't specify what input type it expects.

**Example from pilot_steps.json (step6)**:
```json
{
  "step_id": "step6",
  "operation": "extract_structured_data",
  "config": {
    "fields": [...],
    "input": "{{uploaded_file}}"  // ← Is this a file object or file URL?
  }
}
```

**Current Schema** ([document-extractor-plugin-v2.json:52-110](lib/plugins/definitions/document-extractor-plugin-v2.json#L52-L110)):
```json
"parameters": {
  "type": "object",
  "required": ["file_url", "fields"],
  "properties": {
    "file_url": {
      "type": "string",
      "description": "URL or path to the document file (PDF, JPG, PNG)"
    }
  }
}
```

**Issue**: Parameter is `file_url` but config uses `input`. No guidance on how to convert file object → URL.

**Proposed Enhancement**:
```json
"parameters": {
  "type": "object",
  "required": ["file_url", "fields"],
  "properties": {
    "file_url": {
      "type": "string",
      "description": "URL or path to the document file (PDF, JPG, PNG)",
      "x-input-mapping": {
        "accepts": ["file_object", "url_string"],
        "from_file_object": "web_view_link",
        "description": "Can accept file object (extracts web_view_link) or direct URL string"
      }
    },
    "fields": {
      "type": "array",
      "description": "List of fields to extract"
    }
  }
}
```

**Benefits**:
- Compiler knows to extract `web_view_link` from file objects
- LLM learns proper input format
- Runtime can validate input types

**Implementation**:
- Add `x-input-mapping` to parameters
- Compiler auto-converts based on input type
- Vocabulary extractor includes input requirements

---

### Enhancement 4: Default Config Values

**Problem**: read_range has empty config `{}` - needs defaults for required parameters.

**Example from pilot_steps.json (step14)**:
```json
{
  "step_id": "step14",
  "operation": "read_range",
  "config": {}  // ← Missing spreadsheet_id and range
}
```

**Current Schema** ([google-sheets-plugin-v2.json:46-49](lib/plugins/definitions/google-sheets-plugin-v2.json#L46-L49)):
```json
"required_params": ["spreadsheet_id", "range"]
```

**Issue**: No guidance on how to provide missing required params - should come from runtime context or previous step?

**Proposed Enhancement**:
```json
"parameters": {
  "type": "object",
  "required": ["spreadsheet_id", "range"],
  "properties": {
    "spreadsheet_id": {
      "type": "string",
      "description": "The ID of the spreadsheet to read from",
      "x-context-binding": {
        "source": "workflow_config",
        "key": "expense_sheet_id",
        "required": true,
        "description": "Must be provided in workflow configuration"
      }
    },
    "range": {
      "type": "string",
      "description": "The A1 notation range to read",
      "x-context-binding": {
        "source": "workflow_config",
        "key": "expense_sheet_range",
        "default": "Sheet1!A:Z",
        "description": "Defaults to entire first sheet if not specified"
      }
    }
  }
}
```

**Benefits**:
- Compiler knows which params come from workflow config
- Clear error messages for missing required config
- Defaults prevent empty configs

**Implementation**:
- Add `x-context-binding` to required parameters
- Compiler injects from workflow config or defaults
- Validation checks required context is available

---

### Enhancement 5: Operation Semantics Metadata

**Problem**: Filter operations on lists need special handling - item-level semantics vs list-level.

**Example from pilot_steps.json (step10)**:
```json
{
  "step_id": "step10",
  "operation": "filter",
  "input": "{{valid_transactions}}",
  "config": {
    "condition": {
      "field": "valid_transactions.amount",  // ← Should be "item.amount"
      "operator": "gt",
      "value": "{{config.amount_threshold_usd}}"
    }
  }
}
```

**Issue**: When filtering a list, condition should reference item, not list. No schema guidance on this.

**Proposed Enhancement** (new transform operation metadata):
```json
{
  "transform_operations": {
    "filter": {
      "description": "Filter items in a collection based on condition",
      "input_cardinality": "collection",
      "output_cardinality": "collection",
      "semantics": "item_level",  // ← NEW: Indicates per-item operation
      "condition_scope": "item",   // ← NEW: Condition evaluates against each item
      "example": {
        "input": "{{transactions}}",
        "condition": {
          "field": "item.amount",  // ← Use 'item' not 'transactions'
          "operator": "gt",
          "value": 100
        }
      }
    },
    "reduce": {
      "description": "Aggregate collection to single value",
      "input_cardinality": "collection",
      "output_cardinality": "single",
      "semantics": "collection_level",  // ← Operates on entire collection
      "required_config": ["reduce_operation"],
      "field_requirement": {
        "operations": ["sum", "avg", "min", "max"],
        "description": "These operations require a 'field' parameter"
      }
    }
  }
}
```

**Benefits**:
- Compiler can rewrite filter conditions automatically
- LLM learns correct semantics from examples
- Clear documentation of transform operation behavior

**Implementation**:
- Add `transform_operations.json` metadata file
- Compiler uses semantics to normalize conditions
- Vocabulary extractor includes examples in prompts

---

## Implementation Priority

### Phase 1: Critical (Enables current workflow)
1. ✅ **Parameter Field Mapping** - Fixes upload_file config issues
2. ✅ **Input Type Specifications** - Fixes document-extractor input
3. ✅ **Default Config Values** - Fixes empty read_range config

### Phase 2: Validation Enhancement
4. ✅ **Output Field Guarantees** - Enables better validation
5. ✅ **Operation Semantics** - Enables filter/transform improvements

---

## Migration Strategy

### Backward Compatibility

All enhancements use `x-*` extension fields (following JSON Schema conventions):
- Existing schemas remain valid
- New features opt-in via extension fields
- Gradual migration per plugin

### Rollout Plan

1. **Add Extension Schema** (1 day)
   - Define `x-guaranteed`, `x-variable-mapping`, `x-input-mapping`, `x-context-binding`
   - Update type definitions in [plugin-types.ts](lib/types/plugin-types.ts)

2. **Update Core Plugins** (2 days)
   - google-sheets: Add output guarantees, context bindings
   - google-drive: Add variable mappings for upload/folder actions
   - document-extractor: Add input type specifications

3. **Update Compiler** (2 days)
   - ExecutionGraphCompiler uses mappings for normalization
   - IntentToIRConverter respects input/output specs
   - Add validation for guaranteed fields

4. **Update Vocabulary Extractor** (1 day)
   - Include mapping guidance in action descriptions
   - Generate examples from metadata

5. **Update Remaining Plugins** (3 days)
   - google-mail, google-docs, hubspot, etc.
   - Test each plugin with enhanced metadata

---

## Testing Strategy

### Test Cases

For each enhancement, verify:

1. **LLM Generation**: Intent includes correct config based on metadata
2. **IR Conversion**: IntentToIRConverter generates proper IR v4 format
3. **Compilation**: ExecutionGraphCompiler normalizes correctly
4. **Validation**: Missing required fields caught early
5. **Runtime**: Actual plugin output matches guaranteed schema

### Test Workflow

Use the invoice extraction workflow as the test case:
- Upload attachments → needs variable mapping
- Extract fields → needs input type specs
- Read sheet → needs context binding
- Filter transactions → needs operation semantics
- Generate summary → needs output guarantees

### Success Criteria

- ✅ All 19 steps compile without warnings
- ✅ All required configs present and correct
- ✅ Variable references properly mapped
- ✅ Filter conditions use item-level scope
- ✅ No hardcoded rules in prompts

---

## Long-Term Vision

### Transform Operation DSL

Eventually replace `custom_code` with structured transform language:

```json
{
  "operation": "transform",
  "transform_type": "map",
  "input": "{{extracted_fields}}",
  "mapping": {
    "date": "source.date",
    "vendor": "source.vendor",
    "amount": "source.amount",
    "drive_link": "context.uploaded_file.web_view_link",
    "email_sender": "context.attachment.sender"
  }
}
```

**Benefits**:
- Fully deterministic (no LLM needed)
- Easy to validate and debug
- Clear data lineage

### Schema-Based Validation

Build validation engine that checks:
- Input types match output types across steps
- Required fields present before use
- Variable scope respects loop boundaries
- Config parameters match plugin schemas

### Plugin Marketplace

With rich metadata, enable:
- Auto-generated plugin documentation
- Type-safe plugin development
- Runtime capability discovery
- Workflow templates based on plugin combinations

---

## Conclusion

These registry enhancements follow the core principle from [CLAUDE.md](CLAUDE.md):

> **The platform should be self-documenting through schemas and self-correcting through validation, NOT dependent on an ever-growing prompt with hardcoded rules.**

By encoding knowledge in plugin metadata:
- ✅ LLM learns from schemas, not hardcoded examples
- ✅ Compiler fixes issues automatically
- ✅ Validation provides clear error messages
- ✅ Platform scales to any plugin without prompt changes

**Next Steps**: Begin Phase 1 implementation with critical enhancements for google-sheets, google-drive, and document-extractor plugins.
