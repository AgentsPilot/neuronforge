# OpenAI Feedback - Systematic Fix Plan

## Issue Summary

9 critical issues identified in PILOT DSL output from OpenAI review:

### 🔴 **Critical Runtime Failures**

1. **Step 5: Empty config for `get_email_attachment`**
   - **Phase**: IntentToIRConverter
   - **Root Cause**: Not mapping `step.inputs` array to operation config
   - **Fix**: buildDataSourceParams() must process inputs[] and inject loop item variables

2. **Step 7: Wrong `file_url` source**
   - **Phase**: IntentToIRConverter / ExecutionGraphCompiler
   - **Root Cause**: Using `attachment_content.web_view_link` instead of `drive_file.web_view_link`
   - **Fix**: Schema-aware x-input-mapping should detect Drive file upload output

3. **Step 16: Missing sheet destination**
   - **Phase**: IntentToIRConverter
   - **Root Cause**: Not using `sheet_tab` artifact output in deliver step
   - **Fix**: convertDeliver() must use destination parameter from deliver.destination

### ⚠️ **Schema/Output Issues**

4. **Step 4: Ambiguous gather output**
   - **Phase**: ExecutionGraphCompiler
   - **Root Cause**: Duplicate `gather.outputKey` and `output_variable`
   - **Fix**: Compiler should only use ONE output field

5. **Step 14: Operation mismatch (spreadsheet vs tab)**
   - **Phase**: CapabilityBinderV2
   - **Root Cause**: Bound to `get_or_create_spreadsheet` instead of sheet tab operation
   - **Fix**: Binder needs to understand table/sheet type distinction

6. **Step 18: Duplicate email body fields**
   - **Phase**: ExecutionGraphCompiler
   - **Root Cause**: Both `content` and `body` fields in config
   - **Fix**: Dedup parameters based on schema

### 📋 **LLM Prompt Issues**

7. **Steps 2, 8, 9: Non-deterministic custom_code**
   - **Phase**: IntentContract LLM Prompt
   - **Root Cause**: Using custom_code instead of declarative transforms
   - **Fix**: Add prompt guidance to avoid custom_code, use structured operations

8. **Step 16: Undefined `transaction.drive_link` field**
   - **Phase**: IntentContract LLM Prompt
   - **Root Cause**: custom_code merge doesn't guarantee field names
   - **Fix**: Enforce schema for transaction_record output

9. **Config key mismatch: `amount_threshold_usd` vs `amount_threshold`**
   - **Phase**: IntentContract LLM Prompt / ExecutionGraphCompiler
   - **Fix**: Add config key normalization in compiler

---

## Detailed Fix Plans

### FIX 1: Step 5 Empty Config (IntentToIRConverter)

**File**: `lib/agentkit/v6/compiler/IntentToIRConverter.ts`

**Current Code** (lines 277-307):
```typescript
private buildDataSourceParams(step: DataSourceStep, ctx: ConversionContext): Record<string, any> {
  const params: Record<string, any> = {}

  // Add query if present
  if (step.query) {
    params.query = step.query
  }

  // Add filters if present
  if (step.filters && step.filters.length > 0) {
    // ...
  }

  // Add retrieval options if present
  if (step.retrieval) {
    // ...
  }

  return params
}
```

**Problem**: Never processes `step.inputs` array!

**IntentContract shows**:
```json
{
  "id": "download_attachment",
  "kind": "data_source",
  "inputs": ["attachment_ref"],  // ← THIS IS NOT BEING USED!
  "output": "attachment_content"
}
```

**Fix**:
```typescript
private buildDataSourceParams(step: DataSourceStep, ctx: ConversionContext): Record<string, any> {
  const params: Record<string, any> = {}

  // NEW: Process inputs array (for operations like get_email_attachment)
  if (step.inputs && step.inputs.length > 0) {
    for (const input of step.inputs) {
      const inputVar = this.resolveRefName(input, ctx)

      // For download operations, the input is typically the item being downloaded
      // Schema-aware mapping will convert this to the correct parameter name
      params.input_ref = inputVar
    }
  }

  // Add query if present
  if (step.query) {
    params.query = step.query
  }

  // ... rest of method

  return params
}
```

**Better Approach** (schema-aware):
The inputs should be mapped using schema. For `get_email_attachment`, the schema likely expects:
- `message_id`: ID of the email
- `attachment_id`: ID of the attachment

The `attachment_ref` loop item should contain both. We need schema-aware input mapping.

---

### FIX 2: Step 7 Wrong file_url Source

**File**: `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` OR `IntentToIRConverter.ts`

**Current PILOT DSL**:
```json
{
  "step_id": "step7",
  "plugin": "document-extractor",
  "operation": "extract_structured_data",
  "config": {
    "file_url": "{{attachment_content.web_view_link}}"  // ❌ WRONG - Gmail doesn't return web_view_link
  }
}
```

**Should be**:
```json
{
  "config": {
    "file_url": "{{drive_file.web_view_link}}"  // ✅ Correct - Drive returns web_view_link
  }
}
```

**Root Cause**: IntentContract says:
```json
{
  "id": "extract_transaction_fields",
  "inputs": ["attachment_content"],  // ← LLM thinks this has web_view_link
  "extract": {
    "input": "attachment_content"
  }
}
```

**Fix Location**: This is actually an **IntentContract LLM issue**. The LLM should understand that:
1. `upload_to_drive` produces `drive_file` with `web_view_link`
2. `extract_transaction_fields` should use `drive_file`, not `attachment_content`

**Alternative Fix** (Compiler):
ExecutionGraphCompiler could detect when extract operation needs a file_url and trace back to find the Drive upload output. But this is plugin-specific logic (violates principles).

**Recommended Fix**: Update IntentContract system prompt Pattern 5 to clarify that extracted/uploaded files should be used by their destination output, not source.

---

### FIX 3: Step 16 Missing Sheet Destination

**File**: `lib/agentkit/v6/compiler/IntentToIRConverter.ts`

**Current PILOT DSL**:
```json
{
  "step_id": "step16",
  "plugin": "google-sheets",
  "operation": "append_rows",
  "config": {
    "spreadsheet_id": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc",  // ❌ Hardcoded
    "fields": { ... }
    // ❌ Missing: tab_name or reference to sheet_tab from Step 14
  }
}
```

**IntentContract shows**:
```json
{
  "id": "append_to_sheet",
  "inputs": ["transaction", "sheet_tab"],  // ← sheet_tab IS in inputs!
  "deliver": {
    "destination": "sheet_tab"  // ← destination IS specified!
  }
}
```

**Problem**: convertDeliver() converts `destination` to a generic param but doesn't extract spreadsheet_id/tab_name from the artifact.

**Fix**:
```typescript
private convertDeliver(step: DeliverStep & BoundStep, ctx: ConversionContext): string {
  // ...existing code...

  // Add destination if present
  if (step.deliver.destination) {
    const destVar = this.resolveRefName(step.deliver.destination, ctx)
    genericParams.destination = destVar

    // NEW: If destination is an artifact (sheet, spreadsheet, folder), extract its ID/name
    // This will be handled by schema-aware mapping in mapParamsToSchema()
  }

  // ...
}
```

The schema-aware `mapParamsToSchema()` should detect that `destination` is a sheet_tab artifact and extract:
- `spreadsheet_id` from `sheet_tab.spreadsheet_id`
- `tab_name` from `sheet_tab.tab_name`

---

### FIX 4: Step 4 Ambiguous Gather Output

**File**: `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`

**Current PILOT DSL**:
```json
{
  "step_id": "step4",
  "scatter": { ... },
  "gather": {
    "operation": "collect",
    "outputKey": "all_transactions"  // ← Duplicate
  },
  "output_variable": "all_transactions"  // ← Duplicate
}
```

**Fix**: Remove `gather.outputKey`, only use `output_variable`:
```typescript
// In compileLoopNode() method
const pilotStep = {
  step_id: stepId,
  type: 'scatter_gather',
  scatter: {
    input: loopInput,
    steps: bodySteps,
    itemVariable: loopConfig.item_variable
  },
  gather: {
    operation: 'collect'
    // ❌ Remove outputKey - redundant with output_variable
  },
  output_variable: loopConfig.output_variable,  // ✅ Only this
  id: stepId
}
```

---

### FIX 5: Step 14 Operation Mismatch

**File**: `lib/agentkit/v6/capability-binding/CapabilityBinderV2.ts`

**Current Binding**:
```json
{
  "plugin": "google-sheets",
  "operation": "get_or_create_spreadsheet"  // ❌ Wrong - this is for SPREADSHEET
}
```

**IntentContract says**:
```json
{
  "artifact": {
    "domain": "table",
    "type": "sheet",  // ← This is a SHEET/TAB, not SPREADSHEET
    "strategy": "get_or_create",
    "options": {
      "spreadsheet_id": {...},  // ← Wants to create TAB in existing spreadsheet
      "tab_name": {...}
    }
  }
}
```

**Problem**: Binder matched `capability: upsert` + `domain: table` and picked `get_or_create_spreadsheet`, but it should understand the difference between:
- **Spreadsheet** (top-level document)
- **Sheet/Tab** (within a spreadsheet)

**Fix**: Enhance scoring to consider artifact.type and artifact.options:
```typescript
private scoreByArtifactStrategy(candidates, artifact) {
  // ... existing code ...

  // NEW: For table domain, distinguish spreadsheet vs sheet
  if (artifact.domain === 'table') {
    for (const candidate of candidates) {
      // If artifact has spreadsheet_id option → looking for sheet/tab operation
      if (artifact.options?.spreadsheet_id && candidate.action.includes('sheet') || candidate.action.includes('tab')) {
        candidate.score += 0.5
        candidate.reasons.push('✅ Matched sheet/tab operation (has spreadsheet_id option)')
      }
      // If no spreadsheet_id → looking for spreadsheet operation
      else if (!artifact.options?.spreadsheet_id && candidate.action.includes('spreadsheet')) {
        candidate.score += 0.5
        candidate.reasons.push('✅ Matched spreadsheet operation (no spreadsheet_id)')
      }
    }
  }
}
```

---

### FIX 6: Step 18 Duplicate Body Fields

**File**: `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`

**Current PILOT DSL**:
```json
{
  "config": {
    "content": "{{email_content.body}}",  // ❌ Duplicate
    "to": [...],
    "subject": "{{email_content.subject}}",
    "body": "{{email_content.body}}"  // ❌ Duplicate
  }
}
```

**Fix**: Add parameter deduplication in `buildParamsFromSchema()`:
```typescript
private buildParamsFromSchema(params, schema) {
  const normalized = {}
  const seenValues = new Map<string, string>()  // value → first_param_name

  for (const [key, value] of Object.entries(params)) {
    // Check if this value was already added under a different key
    if (seenValues.has(value)) {
      const firstKey = seenValues.get(value)
      logger.warn(`Duplicate parameter: ${key} and ${firstKey} both have value ${value}, keeping ${firstKey}`)
      continue  // Skip duplicate
    }

    normalized[key] = value
    if (typeof value === 'string') {
      seenValues.set(value, key)
    }
  }

  return normalized
}
```

---

### FIX 7-8: Custom_code Transform Issues

**File**: `lib/agentkit/v6/intent/intent-system-prompt-v2.ts`

**Add new pattern** to discourage custom_code:

```markdown
### Pattern 6: Avoid Custom Code - Use Declarative Operations

**CRITICAL: Transforms must be deterministic and compiler-verifiable**

NEVER use `custom_code` for transforms. Instead, use explicit declarative operations:

❌ BAD - Non-deterministic custom_code:
```json
{
  "kind": "transform",
  "transform": {
    "op": "flatten",
    "custom_code": "Extract attachments preserving sender and subject"
  }
}
```

✅ GOOD - Declarative with explicit field mapping:
```json
{
  "kind": "transform",
  "transform": {
    "op": "flatten",
    "input": "emails",
    "extract_field": "attachments",
    "preserve_fields": ["sender", "subject", "message_id"]
  }
}
```

For merging/combining data:
```json
{
  "kind": "transform",
  "transform": {
    "op": "merge",
    "inputs": ["extracted_fields", "attachment_ref", "drive_file"],
    "output_schema": {
      "date": {"from": "extracted_fields.date"},
      "vendor": {"from": "extracted_fields.vendor"},
      "amount": {"from": "extracted_fields.amount"},
      "email_sender": {"from": "attachment_ref.sender"},
      "drive_link": {"from": "drive_file.web_view_link"}
    }
  }
}
```

This ensures:
- Compiler knows exact output schema
- No runtime ambiguity
- Type-safe field references
```

---

### FIX 9: Config Key Mismatch

**File**: `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`

**Add normalization** in `normalizeValueReference()`:
```typescript
private normalizeValueReference(value: any, workflowConfig?: any): any {
  if (typeof value === 'string' && value.startsWith('{{config.')) {
    const keyMatch = value.match(/{{config\.(\w+)}}/)
    if (keyMatch && workflowConfig) {
      const requestedKey = keyMatch[1]  // e.g., "amount_threshold_usd"

      // Check if key exists
      if (!(requestedKey in workflowConfig)) {
        // Try fuzzy match by removing suffixes
        const normalized = requestedKey.replace(/_usd|_eur|_amount|_value|_threshold$/i, '')
        const matchedKey = Object.keys(workflowConfig).find(k =>
          k === normalized || k.startsWith(normalized)
        )

        if (matchedKey) {
          logger.warn(`Config key '${requestedKey}' not found, normalized to '${matchedKey}'`)
          return `{{config.${matchedKey}}}`
        } else {
          logger.warn(`Config key '${requestedKey}' not found and no match for '${normalized}'`)
        }
      }
    }
  }

  return value
}
```

---

## Implementation Order

1. **IntentToIRConverter fixes** (Issues 1, 3)
2. **ExecutionGraphCompiler fixes** (Issues 4, 6, 9)
3. **CapabilityBinderV2 fixes** (Issue 5)
4. **IntentContract prompt fixes** (Issues 7, 8)
5. **Full pipeline test** to verify all fixes

---

## Test Validation

After all fixes, verify:
- ✅ Step 5 has `message_id` and `attachment_id` parameters
- ✅ Step 7 uses `drive_file.web_view_link` not `attachment_content.web_view_link`
- ✅ Step 14 binds to sheet/tab operation, not spreadsheet
- ✅ Step 16 references `sheet_tab` artifact with correct params
- ✅ Step 18 has only `body` field, not duplicate `content`
- ✅ Step 4 has only `output_variable`, not duplicate `gather.outputKey`
- ✅ No `custom_code` in transforms (Steps 2, 8, 9)
- ✅ Config keys are normalized (`amount_threshold_usd` → `amount_threshold`)
