# Schema-Aware Normalization Issue Analysis

## Problem Statement

The schema-aware normalization implemented in Phase 1 is **partially working** but has a fundamental limitation that prevents it from fully utilizing plugin schema metadata.

## Current Status

### What's Working ✅

1. **Plugin schemas are being loaded**: Confirmed by logs showing "Using plugin schema for google-drive.upload_file"
2. **Context binding detection**: Successfully detecting parameters that can be bound from workflow_config
3. **Field path mapping logic**: The code to apply x-variable-mapping is implemented correctly
4. **Type system extensions**: All TypeScript interfaces for x-* extension fields are in place
5. **Plugin enhancement**: 95.9% of actions across 12 plugins have enhanced schemas

### What's NOT Working ❌

The schema-aware normalization cannot rename/translate generic parameter names to schema-specific names.

## Root Cause Analysis

### The Parameter Name Mismatch

**IR Output (from IntentToIRConverter)**:
```json
{
  "plugin_key": "google-drive",
  "action": "upload_file",
  "config": {
    "data": "attachment",
    "destination": "drive_folder"
  }
}
```

**Plugin Schema Expects**:
```json
{
  "file_content": {
    "type": "string",
    "x-variable-mapping": {
      "from_type": "file_attachment",
      "field_path": "content"
    }
  },
  "file_name": {
    "type": "string",
    "x-variable-mapping": {
      "from_type": "file_attachment",
      "field_path": "filename"
    }
  },
  "folder_id": {
    "type": "string",
    "x-variable-mapping": {
      "from_type": "folder",
      "field_path": "folder_id"
    }
  }
}
```

### PILOT DSL Output (Current - Broken)

```json
{
  "step_id": "step7",
  "type": "action",
  "plugin": "google-drive",
  "operation": "upload_file",
  "config": {
    "data": "attachment",           // ❌ Should be file_content, file_name
    "destination": "drive_folder"   // ❌ Should be folder_id
  }
}
```

### Code Location: IntentToIRConverter.ts:566-618

```typescript
private convertDeliver(step: DeliverStep & BoundStep, ctx: ConversionContext): string {
  const params: Record<string, any> = {}

  // Add input data
  const inputVar = this.resolveRefName(step.deliver.input, ctx)
  params.data = inputVar  // ❌ HARDCODED generic name

  // Add destination if present
  if (step.deliver.destination) {
    params.destination = this.resolveRefName(step.deliver.destination, ctx) // ❌ HARDCODED generic name
  }

  const operation: OperationConfig = {
    operation_type: 'deliver',
    deliver: {
      plugin_key: step.plugin_key || 'unknown',
      action: step.action || 'unknown',
      config: params,  // ❌ Uses generic parameter names
    }
  }
}
```

### Why Compiler Normalization Can't Fix This

The compiler's `normalizeActionConfigWithSchema()` method iterates over parameters that ARE IN THE CONFIG:

```typescript
for (const [paramName, paramDef] of Object.entries(parameterSchema)) {
  const configValue = config[paramName]  // ❌ Looking for "file_content", but config has "data"

  if (configValue === undefined) {
    continue  // ❌ Skips because parameter not in config
  }

  // Apply x-variable-mapping...
}
```

The normalization can only:
- ✅ Map field paths WITHIN existing parameters: `{{folder}}` → `{{folder.folder_id}}`
- ❌ Rename/translate parameter names themselves: `data` → `file_content`

## Impact Assessment

### Affected Operations

Any plugin operation where the Intent schema uses generic parameter names that don't match the plugin schema:

1. **Google Drive upload_file**
   - `data` → should be `file_content`, `file_name`, `mime_type`
   - `destination` → should be `folder_id`

2. **Document Extractor extract_structured_data**
   - `input` → should be `file_url` (with x-input-mapping to extract web_view_link)

3. **Google Sheets append_rows**
   - `data` → should be properly mapped row data
   - `destination` → should be `spreadsheet_id`, `range`

4. **Any deliver/artifact step** that uses generic Intent parameter names

### Why This Matters

The PILOT DSL output has parameter names that **don't match the plugin execution API**, which means:
- The runtime executor will fail to execute these steps
- Plugin implementations won't receive the correct parameters
- Workflow execution will break

## Solution Options

Following CLAUDE.md principles ("Can the compiler detect and fix this automatically?"):

### Option A: Make IR Converter Schema-Aware (Recommended)

**Approach**: Inject plugin schemas into IntentToIRConverter so it generates IR with correct parameter names from the start.

**Changes Required**:
1. Add PluginManager dependency to IntentToIRConverter constructor
2. In `convertDeliver()`, look up the plugin action schema
3. Instead of hardcoding `params.data` and `params.destination`, map Intent step properties to actual schema parameter names
4. Use schema metadata to determine how to decompose composite inputs (e.g., `attachment` object → `file_content` + `file_name`)

**Pros**:
- ✅ Fixes the root cause at the source
- ✅ IR becomes directly executable (matches plugin APIs)
- ✅ Compiler normalization becomes simpler (just field path mapping)
- ✅ Follows schema-driven architecture principles

**Cons**:
- ⚠️ Requires IntentToIRConverter to understand plugin schemas
- ⚠️ More complex conversion logic
- ⚠️ Need to handle cases where schema isn't available

**Implementation Complexity**: Medium (2-3 hours)

### Option B: Add Parameter Translation Layer in Compiler

**Approach**: Add a pre-normalization step in ExecutionGraphCompiler that translates generic parameter names to schema-specific names.

**Changes Required**:
1. Add `translateGenericParameterNames()` method before `normalizeActionConfigWithSchema()`
2. Build a translation map: `{data: [...], destination: [...]}`
3. For each generic parameter in config, determine target schema parameters and translate
4. Handle object decomposition (e.g., `attachment` → multiple parameters)

**Pros**:
- ✅ Doesn't require changing IR converter
- ✅ Keeps IR converter simple and generic

**Cons**:
- ⚠️ Adds complexity to compiler
- ⚠️ Creates two-phase normalization (translate, then map fields)
- ⚠️ Doesn't fix the fact that IR has wrong parameter names
- ⚠️ May be harder to debug (parameter names change between IR and PILOT DSL)

**Implementation Complexity**: Medium (2-3 hours)

### Option C: Define Standard Generic Parameter Vocabulary

**Approach**: Don't translate - instead make plugin schemas accept generic parameter names.

**Changes Required**:
1. Add `x-generic-aliases` to plugin parameter schemas
2. Plugin implementations must handle both generic and specific parameter names
3. Document standard generic vocabulary (`data`, `destination`, `input`, etc.)

**Pros**:
- ✅ No code changes to converters or compiler
- ✅ Simpler short-term fix

**Cons**:
- ❌ Violates plugin API contracts
- ❌ Adds ambiguity to plugin schemas
- ❌ Pushes complexity to plugin implementations
- ❌ Doesn't scale to plugins with complex parameter requirements
- ❌ Goes against schema-driven design principles

**Implementation Complexity**: Low (1 hour) but HIGH maintenance cost

## Recommendation

**Implement Option A: Make IR Converter Schema-Aware**

This is the architecturally correct solution that:
1. Fixes the root cause at its source
2. Makes the IR directly executable (matches plugin APIs)
3. Aligns with the schema-driven architecture vision
4. Reduces compiler complexity (no need for parameter translation)
5. Provides better error messages (schema mismatch caught early)

## Implementation Plan

### Phase 1: Core Schema Integration
1. Add PluginManager injection to IntentToIRConverter
2. Implement `getPluginActionSchema()` helper
3. Update `convertDeliver()` to use schema parameter names
4. Handle basic parameter mapping (1:1 name translation)

### Phase 2: Advanced Parameter Decomposition
5. Implement object decomposition (e.g., `attachment` → `file_content` + `file_name`)
6. Use x-variable-mapping to determine field extraction paths
7. Handle optional parameters and defaults from schema

### Phase 3: Testing & Validation
8. Update test cases to verify correct parameter names in IR
9. Run end-to-end pipeline test
10. Verify PILOT DSL has correct parameter names

### Phase 4: Error Handling
11. Handle cases where plugin schema isn't available (fallback to generic names)
12. Add warnings for schema mismatches
13. Document parameter mapping rules

## Expected Outcome

**Before (Current - Broken)**:
```json
{
  "plugin": "google-drive",
  "operation": "upload_file",
  "config": {
    "data": "attachment",
    "destination": "drive_folder"
  }
}
```

**After (Fixed)**:
```json
{
  "plugin": "google-drive",
  "operation": "upload_file",
  "config": {
    "file_content": "{{attachment.content}}",
    "file_name": "{{attachment.filename}}",
    "folder_id": "{{drive_folder.folder_id}}"
  }
}
```

## Alignment with CLAUDE.md Principles

This solution follows the core principle: **"Can the compiler detect and fix this automatically?"**

- ✅ Uses plugin schemas as source of truth (not hardcoded rules)
- ✅ Applies generic principles (parameter name mapping) not specific fixes
- ✅ Self-documenting through schemas
- ✅ Self-correcting through schema validation
- ✅ Scales to any plugin without prompt changes

## Next Steps

1. Review this analysis
2. Approve Option A approach
3. Implement Phase 1: Core Schema Integration
4. Test with invoice extraction workflow
5. Iterate based on results
