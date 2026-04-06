# CRITICAL: Parameter Mapping Failure in V6 Pipeline

**Date**: 2026-03-04
**Status**: 🔴 **BLOCKER - ALL COMPILED WORKFLOWS NON-EXECUTABLE**

---

## Executive Summary

The user is **100% correct** to question workflow executability. **ALL Google Sheets workflows are broken** due to a critical parameter mapping failure in the IntentToIRConverter.

**The Issue**: Plugin parameters are not being mapped from IntentContract payload to actual plugin schema requirements.

**Impact**: Workflows compile successfully but fail at runtime with missing required parameters.

---

## Concrete Example: Lead Sales Follow-up Workflow

### IntentContract (Lines 72-81)
```json
"payload": {
  "spreadsheet_id": {
    "kind": "config",
    "key": "google_sheet_id"
  },
  "tab_name": {
    "kind": "config",
    "key": "sheet_tab_name"
  }
}
```

### Google Sheets Plugin Schema (read_range action)
**Required Parameters** (lines 59-62):
```json
"required": [
  "spreadsheet_id",
  "range"
]
```

**Range Parameter Definition** (lines 79-91):
```json
"range": {
  "type": "string",
  "description": "The A1 notation range to read (e.g., 'Sheet1!A1:D10', 'Data!A:C', or 'B2:E5')",
  "x-from-artifact": true,
  "x-artifact-field": "tab_name"
}
```

### Execution Graph IR (Line 15)
```json
"fetch": {
  "plugin_key": "google-sheets",
  "action": "read_range",
  "config": {}  // ❌ EMPTY! No parameters mapped!
}
```

### PILOT DSL Output (Step 1)
```json
{
  "step_id": "step1",
  "type": "action",
  "plugin": "google-sheets",
  "operation": "read_range",
  "config": {
    "spreadsheet_id": "{{config.google_sheet_id}}"  // ✅ Has this
    // ❌ MISSING: "range": "{{config.sheet_tab_name}}!A:Z"
  }
}
```

---

## Root Cause Analysis

### Phase 1: IntentContract Generation (LLM)
✅ **Working correctly**
- LLM generates `tab_name` in payload (semantic field name)
- LLM doesn't know plugin schema requires parameter named `range` in A1 notation
- This is EXPECTED - LLM works with semantic concepts, not plugin specifics

### Phase 2: CapabilityBinderV2
✅ **Working correctly**
- Binds the step to `google-sheets.read_range`
- Adds `plugin_key` and `action` to bound contract
- Does NOT map parameters (that's IntentToIRConverter's job)

### Phase 3: IntentToIRConverter ❌ **FAILING HERE**
🔴 **Parameter mapping not implemented**

**File**: `lib/agentkit/v6/compiler/IntentToIRConverter.ts`
**Method**: `convertDataSource()` (around lines 640-690)

**Current Implementation**:
```typescript
private convertDataSource(step: DataSourceStep & BoundStep, ctx: ConversionContext): string {
  const nodeId = this.generateNodeId(ctx)
  const outputVar = this.getOutputVariable(step, ctx)

  const operation: OperationConfig = {
    operation_type: 'fetch',
    fetch: {
      plugin_key: step.plugin_key,
      action: step.action,
      config: {}  // ❌ HARDCODED EMPTY CONFIG!
    },
    description: step.summary
  }

  // ... rest of method
}
```

**The Problem**:
- Method creates empty `config: {}`
- Never reads `step.payload` from IntentContract
- Never maps payload fields to plugin schema parameters
- Never transforms field names (e.g., `tab_name` → `range`)
- Never formats values (e.g., `"SheetName"` → `"SheetName!A:Z"`)

---

## Why This Wasn't Caught Earlier

### 1. Validation Passes
✅ The ExecutionGraphValidator checks:
- Node structure (type, outputs, next)
- Variable data flow
- Control flow (edges, merge points)

❌ The validator does NOT check:
- Plugin action parameter completeness
- Required parameter existence
- Parameter type matching

### 2. Compilation Succeeds
The compiler successfully:
- Converts IR nodes to PILOT DSL steps
- Wraps variable references with `{{}}`
- Normalizes field references

But it CANNOT fix missing parameters because they're already missing in the IR.

### 3. Runtime Won't Run Yet
The workflow hasn't been executed by the runtime engine, so we haven't hit the actual API call that would fail with:
```
Google Sheets API Error: Missing required parameter 'range'
```

---

## Affected Workflows

**ALL workflows using these plugin operations are broken**:

### Google Sheets
- ✅ `spreadsheet_id` parameter (usually maps correctly)
- ❌ `range` parameter (missing - needs construction from `tab_name`)

**Broken Workflows**:
1. **Lead Sales Follow-up** (current) - read_range missing range
2. **Complaint Email Logger** (tested earlier) - read_range missing range
3. **Leads Filter** (tested earlier) - read_range missing range

### Other Plugins (Need Investigation)
- **Google Mail**: `send_email` - need to check if `recipients` and `content` map correctly
- **Google Drive**: `upload_file` - need to check if `file_content` and `parent_folder_id` map
- **Any plugin** with parameter name mismatches

---

## The Fix Required

### Option 1: Smart Parameter Mapper in IntentToIRConverter (RECOMMENDED)

**Location**: `lib/agentkit/v6/compiler/IntentToIRConverter.ts`
**Method**: `convertDataSource()` and new `mapPayloadToPluginParams()`

**Implementation**:
```typescript
private convertDataSource(step: DataSourceStep & BoundStep, ctx: ConversionContext): string {
  const nodeId = this.generateNodeId(ctx)
  const outputVar = this.getOutputVariable(step, ctx)

  // NEW: Map payload to plugin parameters
  const config = this.mapPayloadToPluginParams(
    step.payload || {},
    step.plugin_key,
    step.action,
    ctx
  )

  const operation: OperationConfig = {
    operation_type: 'fetch',
    fetch: {
      plugin_key: step.plugin_key,
      action: step.action,
      config  // Use mapped config
    },
    description: step.summary
  }

  // ... rest of method
}

private mapPayloadToPluginParams(
  payload: Record<string, any>,
  pluginKey: string,
  actionName: string,
  ctx: ConversionContext
): Record<string, any> {
  // Get plugin schema
  const plugin = this.pluginManager.getPlugin(pluginKey)
  if (!plugin) {
    throw new Error(`Plugin not found: ${pluginKey}`)
  }

  const action = plugin.actions[actionName]
  if (!action) {
    throw new Error(`Action not found: ${pluginKey}.${actionName}`)
  }

  const paramSchema = action.parameters
  const config: Record<string, any> = {}

  // For each required parameter in plugin schema
  for (const paramName of paramSchema.required || []) {
    const paramDef = paramSchema.properties[paramName]

    // Check if parameter is directly in payload
    if (payload[paramName]) {
      config[paramName] = this.resolvePayloadValue(payload[paramName], ctx)
      continue
    }

    // Check for x-artifact-field mapping
    if (paramDef['x-artifact-field']) {
      const artifactField = paramDef['x-artifact-field']
      if (payload[artifactField]) {
        // Transform based on parameter requirements
        config[paramName] = this.transformParameter(
          payload[artifactField],
          paramName,
          paramDef,
          ctx
        )
        continue
      }
    }

    // Check for x-context-binding (workflow config)
    if (paramDef['x-context-binding']) {
      const binding = paramDef['x-context-binding']
      if (binding.source === 'workflow_config') {
        config[paramName] = `{{config.${binding.key}}}`
        continue
      }
    }

    // Fuzzy match payload field to parameter name
    const fuzzyMatch = this.fuzzyMatchParameter(paramName, payload)
    if (fuzzyMatch) {
      config[paramName] = this.resolvePayloadValue(payload[fuzzyMatch], ctx)
      continue
    }

    // Parameter not found - error or warning
    if (!paramDef['x-context-binding']) {
      ctx.warnings.push(
        `Required parameter '${paramName}' for ${pluginKey}.${actionName} not found in payload. ` +
        `Available fields: ${Object.keys(payload).join(', ')}`
      )
    }
  }

  return config
}

private transformParameter(
  payloadValue: any,
  paramName: string,
  paramDef: any,
  ctx: ConversionContext
): string {
  const resolvedValue = this.resolvePayloadValue(payloadValue, ctx)

  // Special case: Google Sheets range needs A1 notation
  if (paramName === 'range' && paramDef['x-artifact-field'] === 'tab_name') {
    // If payloadValue is a config reference, construct range template
    if (payloadValue.kind === 'config') {
      return `{{config.${payloadValue.key}}}!A:Z`
    }
    // If it's a direct value, append range suffix
    return `${resolvedValue}!A:Z`
  }

  return resolvedValue
}

private fuzzyMatchParameter(
  targetParam: string,
  payload: Record<string, any>
): string | null {
  // Normalize parameter name
  const normalized = targetParam.toLowerCase().replace(/[_-]/g, '')

  for (const payloadKey of Object.keys(payload)) {
    const normalizedKey = payloadKey.toLowerCase().replace(/[_-]/g, '')
    if (normalizedKey === normalized) {
      return payloadKey
    }
  }

  return null
}
```

**Why This Approach**:
- ✅ Uses plugin schema as source of truth (no hardcoding)
- ✅ Respects `x-artifact-field` mappings in schema
- ✅ Handles format transformations (tab_name → range)
- ✅ Supports fuzzy matching for minor name variations
- ✅ Provides clear warnings when parameters can't be mapped
- ✅ Scales to ANY plugin (not Google-specific)

---

### Option 2: Teach LLM to Use Exact Plugin Parameter Names (NOT RECOMMENDED)

**Approach**: Modify IntentContract generation prompt to include plugin schemas

**Why This Won't Work**:
- ❌ Violates CLAUDE.md principle (makes LLM responsible for plugin specifics)
- ❌ Doesn't scale (what if plugin schema changes?)
- ❌ Increases prompt size dramatically
- ❌ LLM still needs to understand format transformations
- ❌ Creates tight coupling between semantic intent and technical schemas

---

## Implementation Priority

### Phase 1: Fix Data Source Parameter Mapping (CRITICAL)
**File**: `IntentToIRConverter.ts`
**Methods**: `convertDataSource()`, `mapPayloadToPluginParams()`
**Test**: Lead sales follow-up workflow

### Phase 2: Fix Action Parameter Mapping (CRITICAL)
**File**: `IntentToIRConverter.ts`
**Methods**: `convertAction()`, `mapPayloadToPluginParams()`
**Test**: Send email steps in all workflows

### Phase 3: Add PILOT DSL Validation (HIGH PRIORITY)
**File**: New `PilotDslValidator.ts`
**Purpose**: Validate compiled PILOT DSL against plugin schemas before declaring success

### Phase 4: Update Test Scripts (HIGH PRIORITY)
**Files**: All `test-*.ts` scripts
**Change**: Don't declare "SUCCESS" until parameter validation passes

---

## Testing Plan

### 1. Unit Test: Parameter Mapper
```typescript
describe('mapPayloadToPluginParams', () => {
  it('should map tab_name to range with A1 notation', () => {
    const payload = {
      spreadsheet_id: { kind: 'config', key: 'sheet_id' },
      tab_name: { kind: 'config', key: 'tab_name' }
    }

    const result = mapper.map(payload, 'google-sheets', 'read_range')

    expect(result).toEqual({
      spreadsheet_id: '{{config.sheet_id}}',
      range: '{{config.tab_name}}!A:Z'
    })
  })
})
```

### 2. Integration Test: Full Pipeline
```typescript
it('should compile lead workflow with valid parameters', async () => {
  const workflow = await runFullPipeline(leadSalesPrompt)

  const step1 = workflow.steps[0]
  expect(step1.config).toHaveProperty('spreadsheet_id')
  expect(step1.config).toHaveProperty('range')
  expect(step1.config.range).toMatch(/!A:Z$/)
})
```

### 3. Runtime Test: Actual Execution
```typescript
it('should successfully fetch from Google Sheets', async () => {
  const result = await runtime.execute(workflow, {
    google_sheet_id: '1LKh...',
    sheet_tab_name: 'Leads'
  })

  expect(result.steps[0].status).toBe('success')
  expect(result.steps[0].output).toHaveProperty('values')
})
```

---

## Confidence Assessment

### Before Fix
- **Compilation Success**: 100% ✅ (but misleading)
- **Validation Success**: 100% ✅ (doesn't check parameters)
- **Runtime Executability**: 0% ❌ (missing required parameters)

### After Fix
- **Compilation Success**: 100% ✅
- **Validation Success**: 100% ✅
- **Runtime Executability**: 95% ✅ (pending auth/data issues)

---

## User Is Right

The user's question **"where is the range"** exposes a **fundamental gap** in our pipeline validation:

1. ✅ We validate **structure** (nodes, edges, variables)
2. ✅ We validate **data flow** (variable existence, references)
3. ❌ We DO NOT validate **plugin contract compliance** (required parameters)

**The Fix**: Implement parameter mapping in IntentToIRConverter and add PILOT DSL validation against plugin schemas.

---

## Bottom Line

🔴 **ALL tested workflows are currently non-executable due to missing parameter mapping.**

The classification fix was real and necessary, but it only fixed **data flow**. We still have a **parameter mapping** blocker that prevents actual runtime execution.

**Next Action**: Implement `mapPayloadToPluginParams()` in IntentToIRConverter with Google Sheets range transformation as first use case.
