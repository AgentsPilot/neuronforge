# Phase 3 IR Schema Gap Analysis

## Issue Summary

The compiled DSL is "not workable" because the IR schema cannot express the pattern: **"For each extracted item, perform multiple sequential operations"**.

## Current IR Structure (Invoice/Expense Workflow)

```json
{
  "ai_operations": [{
    "type": "deterministic_extract",
    "instruction": "Extract: type, vendor, date, amount, invoice_receipt_number, category",
    "output_schema": { "fields": [...] }
  }],

  "delivery_rules": {
    "multiple_destinations": [
      {
        "plugin_key": "google-drive",
        "operation_type": "create_folder",
        "config": { "folder_name": "{{vendor}}", ... }
      },
      {
        "plugin_key": "google-drive",
        "operation_type": "upload_file",
        "config": { "folder_id": "{{step_result.folder_id}}", ... }
      },
      {
        "plugin_key": "google-drive",
        "operation_type": "share_file",
        "config": { "file_id": "{{step_result.file_id}}", ... }
      },
      {
        "plugin_key": "google-sheets",
        "operation_type": "append_rows",
        "config": { "values": ["{{type}}", "{{vendor}}", ...] }
      }
    ],

    "summary_delivery": {
      "plugin_key": "google-mail",
      "operation_type": "send_message",
      "recipient": "meiribarak@gmail.com",
      "subject": "Daily digest",
      "body_template": "Processed {{count}} documents..."
    }
  },

  "conditionals": [{
    "condition": {
      "type": "complex",
      "combineWith": "AND",
      "conditions": [
        { "field": "amount", "operator": "is_not_empty" },
        { "field": "amount", "operator": "greater_than", "value": 50 }
      ]
    },
    "then_actions": [{ "type": "continue" }],
    "else_actions": [{ "type": "skip_delivery" }]
  }]
}
```

## Current Compiler Output (WRONG)

```json
[
  // Steps 1-12: Gmail search, deduplication, AI extraction
  {
    "id": "step13",
    "type": "action",
    "action": "create_folder",
    "params": {
      "folder_name": "{{vendor}}",  // ❌ WRONG: {{vendor}} doesn't exist at top level
      "parent_folder_id": "..."
    }
  },
  {
    "id": "step14",
    "type": "action",
    "action": "upload_file",
    "params": {
      "folder_id": "{{step_result.folder_id}}",  // ✅ Correct dependency marker
      "file_content": "{{attachment_content}}"  // ❌ WRONG: No attachment at top level
    }
  },
  {
    "id": "step15",
    "type": "action",
    "action": "share_file",
    "params": { "file_id": "{{step_result.file_id}}" }
  },
  {
    "id": "step16",
    "type": "action",
    "action": "append_rows",
    "params": {
      "values": ["{{type}}", "{{vendor}}", ...]  // ❌ WRONG: These fields don't exist at top level
    }
  },
  {
    "id": "step17",
    "type": "action",
    "action": "send_message",
    "params": {}  // ❌ WRONG: Empty params, should have table data
  }
]
```

**Problems:**
1. ❌ Steps 13-16 are **top-level steps**, not inside a loop
2. ❌ Variable references are **wrong scope** (`{{vendor}}` vs `{{invoice.vendor}}`)
3. ❌ Conditional (step7) is **before AI extraction**, not inside per-item loop
4. ❌ Email summary (step17) has **empty params**

## Expected Compiler Output (CORRECT)

```json
[
  // Steps 1-12: Gmail search, deduplication, AI extraction (same as current)

  {
    "id": "step13",
    "type": "scatter_gather",  // ✅ LOOP over extracted items
    "name": "Process Each Invoice/Expense",
    "scatter": {
      "input": "{{step12.data}}",  // AI extraction output
      "itemVariable": "invoice"
    },
    "gather": {
      "mode": "array",
      "outputVariable": "processed_items"
    },
    "steps": [
      // ✅ Inside loop - runs for EACH item

      {
        "id": "step13a",
        "type": "action",
        "action": "create_folder",
        "params": {
          "folder_name": "{{invoice.vendor}}",  // ✅ Correct scope
          "parent_folder_id": "1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-"
        }
      },

      {
        "id": "step13b",
        "type": "action",
        "action": "upload_file",
        "params": {
          "folder_id": "{{step_result.folder_id}}",  // ✅ Sequential dependency
          "file_content": "{{invoice.attachment_content}}",  // ✅ Correct scope
          "file_name": "{{invoice.attachment_filename}}",
          "mime_type": "application/pdf"
        }
      },

      {
        "id": "step13c",
        "type": "action",
        "action": "share_file",
        "params": {
          "file_id": "{{step_result.file_id}}",  // ✅ Sequential dependency
          "permission_type": "anyone",
          "permission_role": "reader"
        }
      },

      {
        "id": "step13d",
        "type": "transform",
        "operation": "set_field",
        "config": {
          "field": "drive_link",
          "value": "{{step_result.web_view_link}}"  // ✅ Capture link
        }
      },

      {
        "id": "step13e",
        "type": "conditional",  // ✅ Inside loop, AFTER data exists
        "condition": {
          "type": "complex",
          "combineWith": "AND",
          "conditions": [
            { "field": "invoice.amount", "operator": "is_not_empty" },
            { "field": "invoice.amount", "operator": "greater_than", "value": 50 }
          ]
        },
        "then": [
          {
            "type": "action",
            "action": "append_rows",
            "params": {
              "spreadsheet_id": "1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE",
              "range": "Sheet1!A:G",
              "values": [[
                "{{invoice.type}}",
                "{{invoice.vendor}}",
                "{{invoice.date}}",
                "{{invoice.amount}}",
                "{{invoice.invoice_receipt_number}}",
                "{{invoice.category}}",
                "{{invoice.drive_link}}"
              ]]
            }
          }
        ],
        "else": []  // ✅ Skip Sheets append if amount <= 50 or missing
      }
    ]
  },

  // ✅ AFTER loop - summary email with ALL processed items
  {
    "id": "step14",
    "type": "action",
    "action": "send_message",
    "params": {
      "to": ["meiribarak@gmail.com"],
      "subject": "Daily invoice/expense digest (last 24 hours)",
      "body": {
        "format": "html",
        "content": "<table>...{{processed_items}}...</table>"  // ✅ Uses loop output
      }
    }
  }
]
```

## IR Schema Gap

**Problem**: `multiple_destinations` has no `execution_scope` field.

**Current TypeScript Definition** ([declarative-ir-types.ts:272-287](lib/agentkit/v6/logical-ir/schemas/declarative-ir-types.ts#L272-L287)):
```typescript
export interface MultiDestinationDelivery {
  name?: string
  recipient?: string
  recipient_source?: string
  cc?: string[]
  subject?: string
  body_template?: string
  include_missing_section?: boolean

  plugin_key: string  // REQUIRED
  operation_type: string  // REQUIRED

  config?: Record<string, any>
}
```

**Current `DeliveryRules` Definition** ([declarative-ir-types.ts:225-231](lib/agentkit/v6/logical-ir/schemas/declarative-ir-types.ts#L225-L231)):
```typescript
export interface DeliveryRules {
  per_item_delivery?: PerItemDelivery
  per_group_delivery?: PerGroupDelivery
  summary_delivery?: SummaryDelivery
  multiple_destinations?: MultiDestinationDelivery[]  // Comment: "Send to multiple channels in parallel"
  send_when_no_results?: boolean
}
```

**Issue**: The comment says "in parallel" but there's no way to specify:
1. Whether operations run in parallel or sequentially
2. Whether operations run once (summary) or per-item

## Proposed Solution: Add `execution_scope` Field

### Option 1: Add Field to `MultiDestinationDelivery`

```typescript
export interface MultiDestinationDelivery {
  name?: string
  recipient?: string
  recipient_source?: string
  cc?: string[]
  subject?: string
  body_template?: string
  include_missing_section?: boolean

  plugin_key: string
  operation_type: string
  config?: Record<string, any>

  // NEW FIELD
  execution_scope?: 'summary' | 'per_item' | 'per_group'  // Default: 'summary'
}
```

**Benefits:**
- ✅ Clear semantics: operations marked `per_item` are wrapped in scatter-gather
- ✅ Backward compatible: default `summary` preserves current behavior
- ✅ Minimal schema change

**IR Example (Fixed)**:
```json
{
  "delivery_rules": {
    "multiple_destinations": [
      {
        "plugin_key": "google-drive",
        "operation_type": "create_folder",
        "config": { "folder_name": "{{vendor}}", ... },
        "execution_scope": "per_item"  // ← NEW
      },
      {
        "plugin_key": "google-drive",
        "operation_type": "upload_file",
        "config": { "folder_id": "{{step_result.folder_id}}", ... },
        "execution_scope": "per_item"  // ← NEW
      },
      {
        "plugin_key": "google-drive",
        "operation_type": "share_file",
        "config": { "file_id": "{{step_result.file_id}}", ... },
        "execution_scope": "per_item"  // ← NEW
      },
      {
        "plugin_key": "google-sheets",
        "operation_type": "append_rows",
        "config": { "values": [...] },
        "execution_scope": "per_item"  // ← NEW
      }
    ],

    "summary_delivery": {
      "plugin_key": "google-mail",
      "operation_type": "send_message",
      "recipient": "meiribarak@gmail.com",
      // execution_scope is implicitly 'summary' (runs once after loop)
    }
  }
}
```

### Option 2: Nested Structure with Explicit Loops

```typescript
export interface DeliveryRules {
  per_item_delivery?: PerItemDelivery
  per_group_delivery?: PerGroupDelivery
  summary_delivery?: SummaryDelivery

  // NEW: Multi-operation workflows
  per_item_workflow?: {
    operations: MultiDestinationDelivery[]  // Sequential operations per item
  }

  multiple_destinations?: MultiDestinationDelivery[]  // Deprecated: use per_item_workflow
  send_when_no_results?: boolean
}
```

**Benefits:**
- ✅ Very explicit structure
- ✅ Clearly separates per-item multi-step from summary multi-destination

**Drawbacks:**
- ❌ More schema changes
- ❌ Breaking change for existing `multiple_destinations` users

## Recommended Fix: Option 1

**Rationale:**
1. Minimal schema change (one optional field)
2. Backward compatible (default preserves current behavior)
3. Clear semantics without nesting complexity

## Implementation Steps

### 1. Update IR Schema

**File**: [lib/agentkit/v6/logical-ir/schemas/declarative-ir-types.ts](lib/agentkit/v6/logical-ir/schemas/declarative-ir-types.ts)

**Changes**:
```typescript
export interface MultiDestinationDelivery {
  // ... existing fields ...

  // NEW: Specifies execution context
  execution_scope?: 'summary' | 'per_item' | 'per_group'
  // Default: 'summary' (execute once after all items processed)
  // 'per_item': Execute inside scatter-gather loop for each item
  // 'per_group': Execute inside group loop (if grouping exists)
}
```

### 2. Update IR Strict Schema (JSON Schema)

**File**: [lib/agentkit/v6/logical-ir/schemas/declarative-ir-schema-strict.ts](lib/agentkit/v6/logical-ir/schemas/declarative-ir-schema-strict.ts)

Add `execution_scope` to `MultiDestinationDelivery` definition.

### 3. Update Phase 3 System Prompt

**File**: [lib/agentkit/v6/semantic-plan/prompts/formalization-system.md](lib/agentkit/v6/semantic-plan/prompts/formalization-system.md)

Add guidance:
```markdown
### execution_scope for multiple_destinations

When delivery_rules.multiple_destinations contains operations that apply to EACH item:
- Set execution_scope: "per_item" for each operation
- Examples: Drive operations (create_folder, upload_file, share_file), per-item Sheets append

When operations run ONCE for all items:
- Set execution_scope: "summary" (or omit, this is default)
- Examples: Summary email, aggregate Sheets operations

**Pattern Recognition:**
- Enhanced Prompt says "For each PDF..." → per_item
- Enhanced Prompt says "Store each attachment..." → per_item
- Enhanced Prompt says "Send a single digest email..." → summary
```

### 4. Update Compiler Pattern Detection

**File**: [lib/agentkit/v6/compiler/DeclarativeCompiler.ts](lib/agentkit/v6/compiler/DeclarativeCompiler.ts)

**New Logic** (around line 1778):
```typescript
private compileMultipleDestinations(ir: DeclarativeLogicalIR, ctx: CompilerContext): WorkflowStep[] {
  const steps: WorkflowStep[] = []
  const { multiple_destinations } = ir.delivery_rules

  if (!multiple_destinations || multiple_destinations.length === 0) {
    return steps
  }

  // Separate destinations by execution scope
  const perItemOps = multiple_destinations.filter(d => d.execution_scope === 'per_item')
  const summaryOps = multiple_destinations.filter(d => !d.execution_scope || d.execution_scope === 'summary')

  // 1. Compile per-item operations (wrap in scatter-gather)
  if (perItemOps.length > 0) {
    this.log(ctx, `Detected ${perItemOps.length} per-item operations in multiple_destinations`)

    const loopSteps = this.compilePerItemMultiDestinations(perItemOps, ir, ctx)
    steps.push(...loopSteps)
  }

  // 2. Compile summary operations (after loop, if any)
  if (summaryOps.length > 0) {
    this.log(ctx, `Detected ${summaryOps.length} summary operations in multiple_destinations`)

    const summarySteps = this.compileSummaryMultiDestinations(summaryOps, ir, ctx)
    steps.push(...summarySteps)
  }

  return steps
}

private compilePerItemMultiDestinations(
  destinations: MultiDestinationDelivery[],
  ir: DeclarativeLogicalIR,
  ctx: CompilerContext
): WorkflowStep[] {
  const loopActions: WorkflowStep[] = []

  // Check for sequential dependencies
  const hasDependencies = destinations.some((dest, idx) => {
    const configStr = JSON.stringify(dest.config || {})
    return configStr.includes('{{step_result.') || /\{\{step\d+\./.test(configStr)
  })

  // Compile each destination as a loop action
  destinations.forEach((dest, idx) => {
    const action = this.compileDestination(dest, idx, ctx, 'item')  // Pass 'item' as variable prefix
    loopActions.push(action)
  })

  // Add conditional handling if post_ai_filters exist
  if (ir.post_ai_filters) {
    // Wrap operations in conditional inside loop
    const conditionalStep = this.createConditionalFromFilters(ir.post_ai_filters, loopActions, ctx)
    loopActions.length = 0
    loopActions.push(conditionalStep)
  }

  // Create scatter-gather loop
  const loopMetadata = this.generateStepMetadata('process_items', 'Process Each Item', ctx)
  return [{
    ...loopMetadata,
    type: 'scatter_gather',
    scatter: {
      input: ctx.currentVariable,
      itemVariable: 'item'
    },
    gather: {
      mode: 'array',
      outputVariable: 'processed_items'
    },
    steps: loopActions
  }]
}
```

### 5. Update Validators

**Files**:
- [lib/agentkit/v6/requirements/IRRequirementsValidator.ts](lib/agentkit/v6/requirements/IRRequirementsValidator.ts)
- [lib/agentkit/v6/requirements/DSLRequirementsValidator.ts](lib/agentkit/v6/requirements/DSLRequirementsValidator.ts)

Update validation logic to check:
- ✅ Per-item operations have correct `execution_scope`
- ✅ Sequential dependencies detected correctly
- ✅ Conditionals are placed inside per-item loop (not before it)

## Testing Plan

1. **Unit Test**: IR with `execution_scope: 'per_item'` compiles to scatter-gather
2. **Unit Test**: IR with `execution_scope: 'summary'` compiles to top-level steps
3. **Integration Test**: Invoice/expense workflow produces correct DSL structure
4. **Validation Test**: All validators pass at 100/100

## Expected Outcome

After implementing Option 1:

✅ **Phase 3 (IR Generation)**: GPT-5.2 generates IR with `execution_scope: 'per_item'` for Drive/Sheets operations

✅ **Phase 4 (Compilation)**: Compiler detects `per_item` scope and wraps operations in scatter-gather loop

✅ **DSL Structure**: Correct loop structure with proper variable scoping

✅ **Validators**: All pass at 100/100 with correct requirement mappings

## Impact Assessment

- **Schema Changes**: 1 optional field added to `MultiDestinationDelivery`
- **Backward Compatibility**: ✅ Yes (default `summary` preserves current behavior)
- **Breaking Changes**: ❌ None
- **Files Modified**: 5 files (schema, strict schema, prompt, compiler, validators)
- **Test Coverage**: 4 new tests needed

## Timeline Estimate

- Schema updates: 30 minutes
- Prompt updates: 30 minutes
- Compiler updates: 2 hours
- Validator updates: 1 hour
- Testing: 2 hours
- **Total**: ~6 hours
