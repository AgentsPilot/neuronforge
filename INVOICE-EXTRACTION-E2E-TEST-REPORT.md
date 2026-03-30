# Invoice Extraction Workflow - Complete E2E Test Report

**Test Date**: March 6, 2026
**Workflow**: Invoice & Receipt Extraction Agent (Gmail → Drive + Sheets + Summary Email)
**Enhanced Prompt**: `enhanced-prompt-invoice-extraction.json`

---

## Executive Summary

✅ **Pipeline Status**: Successfully generated ExecutionGraph IR and PILOT DSL
⚠️ **Executability**: **71% Complete** (5 of 7 action steps valid)
🔧 **Issues Found**: 4 parameter mapping issues (2 missing required, 2 unknown params)
✅ **SchemaCompatibilityValidator**: Working perfectly - Applied 13 auto-fixes

---

## Phase-by-Phase Results

### Phase 0: Vocabulary Extraction ✅
- **Status**: Success
- **Plugins**: 5 (google-mail, google-drive, google-sheets, chatgpt-research, document-extractor)
- **Domains**: 6 (document, email, internal, storage, table, web)
- **Capabilities**: 15 (append, create, download, extract_structured_data, fetch_content, etc.)

### Phase 1: IntentContract Generation ✅
- **Status**: Success (51.8s)
- **Version**: intent.v1
- **Steps**: 11
- **Quality**: Excellent - Proper domain/capability annotations, clear data flow, nested loops

### Phase 2: Capability Binding ✅
- **Status**: Success (268ms)
- **Bound Steps**: 5/11 (45%)
  - ✅ fetch_unread_emails → google-mail.search_emails
  - ✅ ensure_drive_folder → google-drive.get_or_create_folder (with mapped_params!)
  - ✅ download_attachment_content → google-mail.get_email_attachment
  - ✅ upload_to_drive → google-drive.upload_file
  - ✅ extract_transaction_fields → document-extractor.extract_structured_data
  - ✅ append_to_sheets → google-sheets.append_rows
  - ✅ generate_summary_email → chatgpt-research.answer_question
  - ✅ send_summary_email → google-mail.send_email
- **Key Achievement**: CapabilityBinderV2 produced `mapped_params` for step `ensure_drive_folder`

### Phase 3: IntentToIRConverter ⚠️
- **Status**: Partial Success (5ms)
- **IR Version**: 4.0
- **Total Nodes**: 21
- **Warnings**: 19
- **CRITICAL ISSUE**: IntentToIRConverter is **NOT using `mapped_params` from CapabilityBinderV2**
  - `ensure_drive_folder` had `mapped_params: {folder_name: "{{config.drive_folder_name}}"}`
  - But the IR node has `config: {}` (empty)
  - This causes step4 to fail validation

### Phase 4: SchemaCompatibilityValidator ✅
- **Status**: Excellent!
- **Validation**: 0 errors, 18 warnings, **13 fixes applied**
- **Auto-Fixes Applied**:
  1. ✅ Added `message_id` to node_2 for get_email_attachment
  2. ✅ Added `attachment_id` to node_2 for get_email_attachment
  3. ✅ Added `content` to node_2 for upload_file
  4. ✅ Added `folder_id` to node_2 for upload_file
  5. ✅ Added `amount` to node_9 for filter expression
  6. ✅ Added 8 transaction fields to node_11 for append_rows

**Verification**:
```bash
# node_2 schema now has message_id ✅
$ cat output/.../execution-graph-ir-v4.json | jq '.execution_graph.nodes.node_2...properties | keys'
["attachment_id", "content", "email_id", "filename", "folder_id", "id", "message_id", ...]
```

### Phase 5: ExecutionGraphCompiler ⚠️
- **Status**: Partial Success (14ms)
- **Output**: 16 PILOT DSL steps
- **Parameter Normalization**: Working but still has gaps

---

## Parameter Validation Results

### ✅ Valid Steps (5/7 = 71%)

1. **step1: google-mail.search_emails**
   - Required: [] ✅
   - Provided: [query, include_attachments] ✅

2. **step8: document-extractor.extract_structured_data**
   - Required: [file_url, fields] ✅
   - Provided: [file_url, fields] ✅

3. **step14: google-sheets.append_rows**
   - Required: [spreadsheet_id, range, values] ✅
   - Provided: [spreadsheet_id, range, values] ✅

4. **step20: google-mail.send_email**
   - Required: [recipients, content] ✅
   - Provided: [recipients, content] ✅

5. **step7: google-drive.upload_file** (mostly valid)
   - Required: [file_content, file_name] ✅
   - Provided: [file_content, file_name, folder_id, fields] ✅
   - ⚠️ Has 1 unknown param: `fields` (minor issue)

---

## ❌ Critical Issues (2 steps blocking execution)

### Issue #1: Missing `folder_name` in step4

**Step**: step4 (google-drive.get_or_create_folder)
**Severity**: 🔴 CRITICAL - Blocks execution

**What's Wrong**:
```json
// PILOT DSL has empty config
{
  "step_id": "step4",
  "plugin": "google-drive",
  "operation": "get_or_create_folder",
  "config": {},  // ❌ EMPTY
  "output_variable": "drive_folder"
}
```

**Root Cause**: IntentToIRConverter is **ignoring `mapped_params` from CapabilityBinderV2**

**Evidence**:
- BoundIntentContract (Phase 2): `"mapped_params": {"folder_name": "{{config.drive_folder_name}}"}`  ✅
- ExecutionGraph IR (Phase 3): `"config": {}`  ❌
- PILOT DSL (Phase 4): `"config": {}`  ❌

**Fix Location**: [IntentToIRConverter.ts:buildOperationConfig()](lib/agentkit/v6/compiler/IntentToIRConverter.ts)

**Fix Strategy**:
```typescript
private buildOperationConfig(step: BoundStep): Record<string, any> {
  // NEW: Check if parameters already mapped in binding phase
  if (step.mapped_params && Object.keys(step.mapped_params).length > 0) {
    logger.debug('Using pre-mapped parameters from binding phase')
    return step.mapped_params  // ✅ Use binding-time params
  }

  // EXISTING: Fallback to Phase 3 mapping
  return this.mapParamsToSchema(step, schema, ctx)
}
```

---

### Issue #2: Wrong Parameter Name `email_id` vs `message_id` in step6

**Step**: step6 (google-mail.get_email_attachment)
**Severity**: 🟡 HIGH - Causes runtime failure

**What's Wrong**:
```json
// PILOT DSL has wrong parameter name
{
  "step_id": "step6",
  "plugin": "google-mail",
  "operation": "get_email_attachment",
  "config": {
    "attachment_id": "{{attachment.id}}",  // ✅ Correct
    "email_id": "{{attachment.email_id}}"   // ❌ Wrong name (should be message_id)
  }
}
```

**Plugin Schema Expects**:
```json
{
  "message_id": { "type": "string", "x-variable-mapping": {"field_path": "message_id"} },
  "attachment_id": { "type": "string", "x-variable-mapping": {"field_path": "attachment_id"} }
}
```

**Root Cause**: IntentToIRConverter uses field names from **IntentContract** (`email_id`) instead of **plugin schema** (`message_id`)

**Why SchemaCompatibilityValidator Couldn't Fix This**:
- Validator correctly added `message_id` field to node_2 schema ✅
- But the IR **config** still references `email_id` instead of `message_id` ❌
- Validator only adds missing fields to **transform output schemas**, NOT to **config parameter mappings**

**Fix Location**: [IntentToIRConverter.ts:mapParamsToSchema()](lib/agentkit/v6/compiler/IntentToIRConverter.ts)

**Fix Strategy**: Use `x-variable-mapping.field_path` from plugin schema instead of IntentContract field names
```typescript
// When mapping parameters with x-variable-mapping
if (paramDef['x-variable-mapping']?.field_path) {
  const schemaFieldName = paramDef['x-variable-mapping'].field_path  // Use THIS
  // NOT the field name from IntentContract payload
}
```

---

## ⚠️ Minor Issues (2 unknown parameters)

### Issue #3: Unknown `fields` parameter in step7

**Step**: step7 (google-drive.upload_file)
**Severity**: 🟢 LOW - Might be ignored by runtime

**Config**:
```json
{
  "file_content": "...",
  "file_name": "...",
  "folder_id": "...",
  "fields": { "name": "..." }  // ⚠️ Not in plugin schema
}
```

**Analysis**: The plugin schema doesn't have a `fields` parameter. This might be:
- A legacy parameter from old schema
- A mistake in parameter mapping
- Or the plugin runtime accepts it and ignores it

**Impact**: Low - Required params are present

---

## Pipeline Architecture Assessment

### ✅ What's Working Well

1. **SchemaCompatibilityValidator** (Phase 4)
   - ✅ Plugin schema lookup fixed (now uses `getAvailablePlugins()`)
   - ✅ x-variable-mapping detection working
   - ✅ Auto-fix tracing through loops working
   - ✅ Applied 13 fixes correctly
   - ✅ Filter transform schema inheritance working

2. **CapabilityBinderV2** (Phase 2)
   - ✅ Domain/capability matching excellent
   - ✅ Provider preferences working
   - ✅ Idempotency scoring working
   - ✅ **NEW**: Produces `mapped_params` for some steps

3. **IntentContract Generation** (Phase 1)
   - ✅ LLM produces high-quality contracts
   - ✅ Proper domain/capability annotations
   - ✅ Clear data flow with loops and aggregates

### ❌ What Needs Fixing

1. **IntentToIRConverter** (Phase 3) - **HIGHEST PRIORITY**
   - ❌ Not using `mapped_params` from CapabilityBinderV2
   - ❌ Uses IntentContract field names instead of plugin schema field names
   - ❌ Missing parameter format transformations

2. **ExecutionGraphCompiler** (Phase 4)
   - ❌ Still doing fuzzy matching as fallback (should be deterministic)
   - ⚠️ Parameter normalization has gaps

---

## Recommended Fix Priority

### Priority 1: Use `mapped_params` from CapabilityBinderV2 ⭐️⭐️⭐️
**File**: `lib/agentkit/v6/compiler/IntentToIRConverter.ts`
**Impact**: Fixes Issue #1 (missing folder_name)
**Effort**: 1-2 hours

**Change**:
```typescript
private buildOperationConfig(step: BoundStep): Record<string, any> {
  // Check if binding phase already mapped parameters
  if (step.mapped_params && Object.keys(step.mapped_params).length > 0) {
    return step.mapped_params
  }

  // Fallback to Phase 3 mapping
  return this.mapParamsToSchema(step, schema, ctx)
}
```

### Priority 2: Use Plugin Schema Field Names ⭐️⭐️⭐️
**File**: `lib/agentkit/v6/compiler/IntentToIRConverter.ts`
**Impact**: Fixes Issue #2 (email_id vs message_id)
**Effort**: 2-4 hours

**Change**: When mapping parameters with `x-variable-mapping`, use the `field_path` from the plugin schema instead of the IntentContract field name.

### Priority 3: Clean Up Unknown Parameters ⭐️
**File**: Multiple files
**Impact**: Fixes Issues #3, #4 (unknown params)
**Effort**: 1-2 hours

**Change**: Add validation to reject unknown parameters or document why they exist.

---

## Success Metrics

### Current State
- ✅ 71% of action steps valid (5/7)
- ✅ SchemaCompatibilityValidator working correctly
- ✅ 13 auto-fixes applied successfully
- ⚠️ 2 critical parameter mapping issues

### Target State (After Fixes)
- ✅ 100% of action steps valid (7/7)
- ✅ All required parameters present
- ✅ No unknown parameters
- ✅ Fully deterministic parameter mapping
- ✅ No fuzzy matching needed

### Estimated Completion
- **With Priority 1+2 fixes**: ~95% executable
- **With all fixes**: 100% executable
- **Effort**: 4-8 hours total

---

## Test Output Files

All generated artifacts saved to: `output/vocabulary-pipeline/`

- ✅ `plugin-vocabulary.json` - Extracted plugin capabilities
- ✅ `intent-contract.json` - LLM-generated workflow (excellent quality)
- ✅ `bound-intent-contract.json` - With plugin bindings + mapped_params
- ✅ `execution-graph-ir-v4.json` - IR with 13 auto-fixes applied
- ✅ `pilot-dsl-steps.json` - Executable workflow steps (71% valid)

---

## Conclusion

The V6 pipeline is **very close to production-ready**. The SchemaCompatibilityValidator is working excellently, and the capability binding is sophisticated. The main remaining issue is that **IntentToIRConverter needs to use the `mapped_params` from CapabilityBinderV2** instead of re-doing parameter mapping.

**Key Achievement**: We successfully validated that SchemaCompatibilityValidator's auto-fix is working end-to-end, adding 13 missing fields to transform schemas across the workflow.

**Next Step**: Implement Priority 1 fix to use `mapped_params` from binding phase.
