# Phase 4 to PILOT_DSL_SCHEMA Mapping

This document explains how Phase 4 technical workflow output maps to PILOT_DSL_SCHEMA for agent execution.

---

## Overview

```
Phase 4 Response                    PILOT_DSL_SCHEMA
─────────────────                   ─────────────────
technical_workflow[] ─────────────► workflow_steps[]
technical_inputs_required[] ──────► required_inputs[]
enhanced_prompt ──────────────────► agent_name, description, system_prompt
feasibility ──────────────────────► confidence score
```

---

## Top-Level Schema Mapping

| Phase 4 Field | PILOT_DSL_SCHEMA Field | Transformation |
|---------------|------------------------|----------------|
| `enhanced_prompt.plan_title` | `agent_name` | Direct copy |
| `enhanced_prompt.plan_description` | `description` | Direct copy |
| `enhanced_prompt.plan_description` | `system_prompt` | Prefix with "You are an automation agent. " |
| `enhanced_prompt.specifics.services_involved` | `suggested_plugins` | Direct copy |
| `technical_inputs_required[]` | `required_inputs[]` | Transform each input (see below) |
| `technical_workflow[]` | `workflow_steps[]` | Transform each step (see below) |
| `feasibility.can_execute` | `confidence` | Calculated (see Confidence Calculation) |
| — | `workflow_type` | Inferred from step types |
| — | `suggested_outputs` | Generated default output |
| — | `reasoning` | Generated summary |

---

## Step Kind Mapping

### 1. Operation Step → Action Step

```
Phase 4 (OperationStep)              PILOT_DSL_SCHEMA (ActionStep)
───────────────────────              ────────────────────────────
{                                    {
  id: "step1",                         id: "step1",
  kind: "operation",         ───────►  type: "action",
  description: "...",                  name: "..." (from description),
  plugin: "google-mail",               plugin: "google-mail",
  action: "searchMessages",            action: "searchMessages",
  inputs: { ... },           ───────►  params: { ... },
  outputs: { ... }                     description: "..."
}                                    }
```

**Key Transformations:**
- `kind: "operation"` → `type: "action"`
- `inputs` → `params` (with source resolution)
- `description` → both `name` (truncated to 100 chars) and `description`

---

### 2. Transform Step Routing (NEW - Type-Based)

Phase 4 transform steps now include a required `type` field that determines the PILOT_DSL output:

```
Phase 4 Transform Step
        │
        └── type field?
                │
                ├── Deterministic type ─────► PILOT_DSL TransformStep
                │   (filter, map, sort,        (type: "transform")
                │    group_by, aggregate,       No LLM call, fast execution
                │    reduce, deduplicate,
                │    flatten, pick_fields,
                │    format, merge, split,
                │    convert)
                │
                └── LLM type (*_with_llm) ──► PILOT_DSL AIProcessingStep
                    (summarize_with_llm,        (type: "ai_processing")
                     classify_with_llm,          Requires LLM call
                     extract_with_llm,
                     analyze_with_llm,
                     generate_with_llm,
                     translate_with_llm,
                     enrich_with_llm)
```

---

### 2a. Deterministic Transform → Transform Step

```
Phase 4 (TransformStep - Deterministic)    PILOT_DSL_SCHEMA (TransformStep)
──────────────────────────────────────     ─────────────────────────────────
{                                          {
  id: "step2",                               id: "step2",
  kind: "transform",                         type: "transform",
  type: "filter",              ───────►      operation: "filter",
  description: "Filter leads...",            name: "Filter leads...",
  inputs: {                                  input: "{{step1.leads}}",
    leads: { source: "from_step",            config: {
             ref: "step1.leads" },             condition: {
    field: { source: "constant",                 conditionType: "simple",
             value: "Stage" },                   field: "{{item.Stage}}",
    operator: { source: "constant",              operator: "equals",
                value: "equals" },               value: "4"
    value: { source: "constant",               }
            value: "4" }                     },
  },                                         description: "Filter leads..."
  outputs: { filtered: "object[]" }        }
}
```

**Key Transformations:**
- `kind: "transform"` + deterministic `type` → `type: "transform"`
- Phase 4 `type` → `operation` (direct mapping)
- `inputs` → `config` (operation-specific mapping, see below)
- First `from_step` input → `input` field

---

### 2b. LLM Transform → AI Processing Step

```
Phase 4 (TransformStep - LLM)            PILOT_DSL_SCHEMA (AIProcessingStep)
─────────────────────────────            ──────────────────────────────────
{                                        {
  id: "step3",                             id: "step3",
  kind: "transform",                       type: "ai_processing",
  type: "summarize_with_llm",  ───────►    name: "Summarize...",
  description: "Summarize...",             prompt: "Summarize...",
  inputs: {                                params: {
    content: { source: "from_step",          data: "{{step2.content}}"
               ref: "step2.content" }      },
  },                                       description: "Summarize..."
  outputs: { summary: "string" }         }
}
```

**Key Transformations:**
- `kind: "transform"` + `*_with_llm` type → `type: "ai_processing"`
- `description` → `prompt`
- `inputs` → `params.data`
- **`intent: "extract"` added** (v2.8) - Explicit intent ensures ExtractHandler is used for JSON parsing

---

### 2c. Transform Type to Operation Mapping

| Phase 4 `type` | PILOT DSL `operation` | Config Structure |
|----------------|----------------------|------------------|
| `filter` | `filter` | `{ condition: Condition }` |
| `map` | `map` | `{ mapping: Record<string, string> }` |
| `sort` | `sort` | `{ field: string, order: 'asc' \| 'desc' }` |
| `group_by` | `group` | `{ field: string }` |
| `aggregate` | `aggregate` | `{ aggregations: [...] }` |
| `reduce` | `reduce` | `{ reducer: string, initialValue: any }` |
| `deduplicate` | `deduplicate` | `{ field: string, keep?: string }` |
| `flatten` | `map` | `{ mapping: ... }` (specialized) |
| `pick_fields` | `map` | `{ mapping: { field: "{{item.field}}" } }` |
| `format` | `format` | `{ mapping: { template: "..." } }` (dedicated operation) |
| `merge` | `map` | `{ mapping: ... }` (combine objects) |
| `split` | `split` | `{ field: string }` (field-based grouping) |
| `convert` | `map` | `{ mapping: ... }` (type coercion) |

---

### 2d. Standard Transform Input Names (Required)

Phase 4 transforms MUST use these standard input names to ensure consistent DSL building:

| Transform Type | Required Inputs |
|----------------|-----------------|
| `filter` | `collection` (from_step), `field` (constant), `operator` (constant), `value` (constant) |
| `sort` | `collection` (from_step), `field` (constant), `order` (constant: "asc" or "desc") |
| `group_by` | `collection` (from_step), `field` (constant) |
| `aggregate` | `collection` (from_step), `aggregations` (constant: array of {field, operation, alias}) |
| `map` | `data` (from_step), plus any transformation-specific inputs |
| `format` | `data` (from_step), `template` (constant) or `columns` (constant) |
| `split` | `collection` (from_step), `field` (constant) |
| `deduplicate` | `collection` (from_step), `field` (constant) |

**Naming Conventions:**
- Use `collection` for the input array/list to process
- Use `field` for the field/column name to operate on
- Use `data` for `map` and `format` transforms (alternative to `collection`)
- Suffixed variants are allowed: `*_collection`, `*_field`, `*_column`, `*_value`

**Example - Filter with standard names:**
```json
{
  "id": "step4",
  "kind": "transform",
  "type": "filter",
  "inputs": {
    "collection": { "source": "from_step", "ref": "step3.leads" },
    "field": { "source": "constant", "value": "Stage" },
    "operator": { "source": "constant", "value": "equals" },
    "value": { "source": "constant", "value": "4" }
  },
  "outputs": { "filtered_leads": "object[]", "next_step": "step5" }
}
```

---

### 2e. Transform Config Building from Inputs

The DSLBuilder maps Phase 4 `inputs` to PILOT DSL `config` based on the operation type:

**Filter Operation:**
```typescript
// Phase 4 inputs
{
  collection: { source: "from_step", ref: "step1.leads" },
  field: { source: "constant", value: "status" },
  operator: { source: "constant", value: "equals" },
  value: { source: "constant", value: "active" }
}

// PILOT DSL config
{
  input: "{{step1.leads}}",
  config: {
    condition: {
      conditionType: "simple",
      field: "{{item.status}}",
      operator: "equals",
      value: "active"
    }
  }
}
```

**Sort Operation:**
```typescript
// Phase 4 inputs
{
  collection: { source: "from_step", ref: "step1.items" },
  field: { source: "constant", value: "created_at" },
  order: { source: "constant", value: "desc" }
}

// PILOT DSL config
{
  input: "{{step1.items}}",
  config: {
    field: "created_at",
    order: "desc"
  }
}
```

**Group By Operation:**
```typescript
// Phase 4 inputs
{
  collection: { source: "from_step", ref: "step1.leads" },
  group_field: { source: "constant", value: "sales_person" }
}

// PILOT DSL config
{
  input: "{{step1.leads}}",
  config: {
    field: "sales_person"
  }
}
```

**Aggregate Operation:**
```typescript
// Phase 4 inputs
{
  collection: { source: "from_step", ref: "step1.items" },
  aggregations: { source: "constant", value: [
    { field: "amount", operation: "sum", alias: "total" },
    { field: "id", operation: "count", alias: "count" }
  ]}
}

// PILOT DSL config
{
  input: "{{step1.items}}",
  config: {
    aggregations: [
      { field: "amount", operation: "sum", alias: "total" },
      { field: "id", operation: "count", alias: "count" }
    ]
  }
}
```

**Format Operation:**

The `format` operation is a dedicated transform for converting objects or arrays to formatted strings using templates. Template variables like `{{field_name}}` are resolved from the input data, not from global context.

```typescript
// Phase 4 inputs (object-to-string)
{
  data: { source: "from_step", ref: "step9.run_summary" },
  template: { source: "constant", value: "Logged {{to_log_count}} items successfully." }
}

// PILOT DSL config
{
  input: "{{step9.data}}",  // Aggregate output at .data level
  config: {
    mapping: {
      template: "Logged {{to_log_count}} items successfully."
    }
  }
}
// Output: "Logged 5 items successfully." (if to_log_count = 5)
```

**Template Variable Resolution Priority:**
1. Input data object fields (e.g., `{{to_log_count}}` → `data.to_log_count`)
2. Nested paths in data (e.g., `{{user.name}}` → `data.user.name`)
3. Context variables for step references (e.g., `{{step1.data.field}}`)

**Array Input Handling:**
- Empty array: Template expanded with empty/zero values
- Single-item array: Template expanded with that item
- Multiple items: Template expanded for each, joined with newlines

---

### 2f. Fallback Behavior

If a transform step is missing the `type` field (legacy Phase 4 output), DSLBuilder should:

1. **Attempt inference from description** using keyword matching:
   - "filter" / "remove" / "keep only" → `filter`
   - "convert" / "reshape" / "transform" → `map`
   - "sort" / "order by" → `sort`
   - "group" / "group by" → `group_by`
   - "sum" / "count" / "average" / "aggregate" → `aggregate`
   - "build HTML" / "format" / "render" → `format`
   - "summarize" / "summary" → `summarize_with_llm`
   - "classify" / "categorize" → `classify_with_llm`
   - "analyze" / "analysis" → `analyze_with_llm`

2. **Default to `ai_processing`** if inference fails (safer, ensures execution)

---

### 3. Control Step (for_each) → Scatter-Gather Step

```
Phase 4 (ControlStep - for_each)     PILOT_DSL_SCHEMA (ScatterGatherStep)
────────────────────────────────     ───────────────────────────────────
{                                    {
  id: "step3",                         id: "step3",
  kind: "control",           ───────►  type: "scatter_gather",
  description: "Loop...",              name: "Process each item",
  control: {                           description: "Loop...",
    type: "for_each",                  scatter: {
    item_name: "email",      ───────►    itemVariable: "email",
    collection_ref: "step1.emails"       input: "{{step1.emails}}",
  },                                     steps: [ ... ]  ◄─── nested steps
  steps: [ ... ],            ───────►  },
  outputs: { ... }                     gather: {
}                                        operation: "collect",
                                         outputKey: "step3"
                                       }
                                     }
```

**Key Transformations:**
- `kind: "control"` + `control.type: "for_each"` → `type: "scatter_gather"`
- `control.item_name` → `scatter.itemVariable`
- `control.collection_ref` → `scatter.input` (wrapped in `{{...}}`)
- `steps[]` → `scatter.steps[]` (recursively converted)
- Default `gather.operation: "collect"`

---

### 4. Control Step (if) → Conditional Step

```
Phase 4 (ControlStep - if)           PILOT_DSL_SCHEMA (ConditionalStep)
──────────────────────────           ─────────────────────────────────
{                                    {
  id: "step4",                         id: "step4",
  kind: "control",           ───────►  type: "conditional",
  description: "Check...",             name: "Check condition",
  control: {                           description: "Check...",
    type: "if",                        condition: {
    condition: "step3.count > 0"         conditionType: "simple",
  },                         ───────►    field: "{{step3.count}}",
  steps: [ ... ],            ───────►    operator: "greater_than",
  else_steps: [ ... ]        ───────►    value: 0
}                                      },
                                       then_steps: [ ... ],
                                       else_steps: [ ... ]
                                     }
```

**Key Transformations:**
- `kind: "control"` + `control.type: "if"` → `type: "conditional"`
- `control.condition` → parsed into structured `condition` object
- `steps[]` → `then_steps[]` (recursively converted)
- `else_steps[]` → `else_steps[]` (recursively converted)

---

### 4a. Post-Conditional Output Wiring (lastBranchOutput)

When a conditional step completes, downstream steps need access to whichever branch was executed. The runtime exposes `lastBranchOutput` on the conditional step's output.

**Problem:**
```
step5 (conditional)
├── then_steps → step5_4 outputs { content: "..." }
└── else_steps → step5_5 outputs { content: "..." }

step8 needs the "content" - but which step produced it?
```

**Solution:**

The `StepExecutor.executeConditional()` returns `lastBranchOutput` containing the last executed branch step's data:

```typescript
// StepExecutor returns:
{
  result: true,
  branch: "then",
  branchResults: [...],
  lastBranchOutput: { content: "..." }  // Last branch step's data
}
```

**DSL Reference Pattern:**

| Pattern | Result | Use Case |
|---------|--------|----------|
| `{{step5.data.lastBranchOutput.content}}` | ✓ Correct | Access conditional output uniformly |
| `{{step5_4.data.content}}` | ✗ Wrong | Fails if else_steps executed |
| `{{step5_5.data.content}}` | ✗ Wrong | Fails if then_steps executed |

**Best Practice:**
- Both branches SHOULD output the same key (e.g., both output `content`)
- Downstream steps reference `{{conditionalStep.data.lastBranchOutput.outputKey}}`

**Example:**
```json
{
  "id": "step8",
  "type": "action",
  "plugin": "google-mail",
  "action": "send_email",
  "params": {
    "content": "{{step5.data.lastBranchOutput.content}}"
  }
}
```

---

## Input Source Resolution

Each `StepInput` in Phase 4 has a `source` field that determines how to resolve the value:

| Source | Phase 4 Example | PILOT_DSL_SCHEMA Output |
|--------|-----------------|-------------------------|
| `constant` | `{ source: "constant", value: "hello" }` | `"hello"` (literal value) |
| `constant` (template) | `{ source: "constant", value: "{{item.id}}" }` | `"{{item.id}}"` (preserved) |
| `from_step` | `{ source: "from_step", ref: "step1.emails" }` | Smart resolution (see below) |
| `user_input` | `{ source: "user_input", key: "recipient_email" }` | `"{{input.recipient_email}}"` |
| `env` | `{ source: "env", key: "API_KEY" }` | `"{{env.API_KEY}}"` |
| `plugin_config` | `{ source: "plugin_config", plugin: "slack", key: "channel" }` | `"{{config.slack.channel}}"` |

### Smart Step Reference Resolution (v2.5, updated v2.6)

The `from_step` source requires special handling because different step types store their outputs differently in the Pilot executor:

| Source Step Type | Phase 4 Reference | PILOT_DSL Output | Reason |
|------------------|-------------------|------------------|--------|
| **action** | `step1.emails` | `{{step1.data.emails}}` | Action steps store fields in `.data` |
| **transform (map)** | `step2.normalized_emails` | `{{step2.data}}` | Map transforms store raw array directly |
| **transform (filter)** | `step3.client_emails` | `{{step3.data.items}}` | Filter transforms return `{items: [...]}` |
| **transform (aggregate)** | `step9.run_summary` | `{{step9.data}}` | Aggregate returns object at `.data` level directly |
| **transform (format)** | `step10.summary_text` | `{{step10.data}}` | Format returns string at `.data` level |
| **transform → ai_processing fallback** | `step2.normalized_emails` | `{{step2.data.items}}` | Fallback ai_processing stores array in `.items` |
| **ai_processing (native)** | `step4.summary` | `{{step4.data.items}}` | AI steps return arrays in `.items` key |
| **other transforms** | `step5.sorted` | `{{step5.data.sorted}}` | Other transforms (sort, etc.) keep field names |

**v2.6 Enhancement: Fallback Prediction**

The step registry now predicts whether a transform will fall back to ai_processing BEFORE conversion. This ensures downstream reference resolution uses the correct pattern:

```typescript
// In populateStepRegistry:
if (willTransformFallbackToAI(step)) {
  stepRegistry.set(step.id, { kind: 'transform', type: 'ai_processing' });
} else {
  stepRegistry.set(step.id, { kind: 'transform', operation: 'map' });
}

// willTransformFallbackToAI checks:
// 1. Is it an LLM transform type (*_with_llm)?
// 2. Is it a filter with cross-step dependency field?
// 3. Is it a mapping-based transform without {{item.*}} references?
```

**How It Works:**

The DSL Builder maintains a step registry that tracks each step's type and operation. When resolving `from_step` references, it looks up the source step to determine the correct data path:

```typescript
// Step registry populated before conversion
stepRegistry: Map<stepId, { kind, type?, operation? }>

// Resolution logic
case 'from_step':
  const [stepId, fieldName] = ref.split('.');
  const stepInfo = stepRegistry.get(stepId);

  if (stepInfo.kind === 'transform') {
    if (stepInfo.operation === 'map') {
      return `{{${stepId}.data}}`;        // Raw array
    }
    if (stepInfo.operation === 'filter') {
      return `{{${stepId}.data.items}}`;  // Structured {items: [...]}
    }
    if (stepInfo.operation === 'aggregate') {
      return `{{${stepId}.data}}`;        // Object with aggregated values
    }
  }
  return `{{${stepId}.data.${fieldName}}}`;  // Keep field name
```

**Example Transformation:**

```
Phase 4 Workflow:
  step1 (action)     → outputs: { emails: "object[]" }
  step2 (map)        → inputs: { data: { ref: "step1.emails" } }, outputs: { normalized: "object[]" }
  step3 (filter)     → inputs: { collection: { ref: "step2.normalized" } }, outputs: { filtered: "T[]" }
  step4 (ai_process) → inputs: { data: { ref: "step3.filtered" } }

PILOT DSL Output:
  step1.params       → uses action params
  step2.input        → "{{step1.data.emails}}"     (action → keep field)
  step3.input        → "{{step2.data}}"            (map → drop field, raw array)
  step4.params.data  → "{{step3.data.items}}"      (filter → use .items)
```

---

## Required Inputs Mapping

```
Phase 4 (TechnicalInputRequired)     PILOT_DSL_SCHEMA (InputField)
────────────────────────────────     ────────────────────────────
{                                    {
  key: "slack_channel_id",             name: "slack_channel_id",
  plugin: "slack",                     type: "text",  ◄─── inferred
  actions: ["send_message"],           label: "Slack Channel ID",
  type: "string",            ───────►  required: true,
  description: "Channel to post"       description: "Channel to post",
}                                      placeholder: "Enter slack channel id",
                                       reasoning: "Required by slack plugin"
                                     }
```

**Type Inference Rules:**
| Input Key Pattern | Inferred Type |
|-------------------|---------------|
| Contains `email` | `email` |
| Contains `url` or `link` | `url` |
| Contains `date` or `time` | `date` |
| Contains `number`, `count`, `amount` | `number` |
| Contains `message`, `description` | `textarea` |
| Default | `text` |

### Auto-Extraction of `{{input.*}}` References

The DSL Builder automatically scans all workflow steps for `{{input.*}}` patterns and ensures they are declared in `required_inputs`. This prevents missing input declarations.

**How it works:**
1. After converting workflow steps, the builder scans all params/config for `{{input.xxx}}` patterns
2. Extracts unique input key names
3. Compares against declared `technical_inputs_required`
4. Auto-generates `InputField` entries for any undeclared inputs
5. Adds a warning for each auto-extracted input

**Example:**
```typescript
// If step1 has: params: { spreadsheet_id: "{{input.my_sheet_id}}" }
// But technical_inputs_required is empty or missing "my_sheet_id"

// DSL Builder will auto-add:
{
  name: "my_sheet_id",
  type: "text",  // inferred from key
  label: "My Sheet Id",
  required: true,
  description: "Auto-extracted from workflow references",
  reasoning: "Auto-detected from {{input.*}} reference in workflow"
}

// And emit warning:
// "[global] Input 'my_sheet_id' referenced in workflow but not declared in technical_inputs_required"
```

**Scanned locations:**
- `ActionStep.params`
- `TransformStep.config` and `TransformStep.input`
- `AIProcessingStep.params`
- `ScatterGatherStep.scatter.input` and nested steps
- `ConditionalStep.then_steps` and `else_steps`

---

## Transform Output Contracts

The DSL Builder includes predefined output contracts for transform operations, making step outputs explicit and eliminating heuristic inference.

### Output Shape Definitions

| Transform Operation | Output Shape | Description |
|---------------------|--------------|-------------|
| `filter` | `T[]` | Filtered array of items matching condition |
| `map` | `U[]` | Transformed array of items |
| `group` | `{key: string, items: T[]}[]` | Array of groups with key and items |
| `split` | `{[bucketKey]: T[], _meta: {...}}` | Items grouped by field value into named buckets |
| `format` | `string` | Formatted string output (HTML, text, etc.) |
| `sort` | `T[]` | Sorted array of items |
| `aggregate` | `{[alias]: value}` | Object with aggregated values |
| `reduce` | `U` | Single reduced value |
| `deduplicate` | `T[]` | Deduplicated array |
| `flatten` | `T[]` | Flattened array |
| `pick_fields` | `Partial<T>[]` | Array with selected fields only |
| `merge` | `T` | Merged object or array |
| `convert` | `U` | Type-converted value |

### Step Output Generation

The builder automatically generates `outputs` for each step based on:
1. Phase 4 `outputs` field (if provided)
2. Operation type contract (for transforms)
3. Step type defaults

**Example - Filter step with outputs:**
```json
{
  "id": "step2",
  "type": "transform",
  "operation": "filter",
  "input": "{{step1.leads}}",
  "config": { ... },
  "outputs": {
    "filtered": {
      "type": "T[]",
      "description": "Filtered array of items matching condition"
    }
  }
}
```

**Example - Group step with outputs:**
```json
{
  "id": "step4",
  "type": "transform",
  "operation": "group",
  "input": "{{step3.leads}}",
  "config": { "field": "sales_person" },
  "outputs": {
    "grouped": {
      "type": "{key: string, items: T[]}[]",
      "description": "Array of groups with key and items"
    }
  }
}
```

This explicit output definition eliminates downstream inference warnings and ensures consistent data contracts between steps.

---

## LLM-Based Plugin Fallback to AI Processing

Certain plugins are LLM-based and don't have real external actions - they rely on AI processing. When the DSL Builder encounters these plugins, it automatically converts them from `action` type to `ai_processing` type.

### LLM-Based Plugins

| Plugin | Converted From | Converted To |
|--------|----------------|--------------|
| `chatgpt-research` | `type: "action"` | `type: "ai_processing"` |

### Conversion Behavior

**Before (would require non-existent plugin execution):**
```json
{
  "id": "step8_1",
  "type": "action",
  "plugin": "chatgpt-research",
  "action": "summarize_content",
  "params": {
    "content": "{{email.body}}",
    "length": "brief",
    "style": "professional"
  }
}
```

**After fallback (executable by LLM):**
```json
{
  "id": "step8_1",
  "type": "ai_processing",
  "prompt": "summarize_content: Summarize the following content briefly in a professional style.",
  "params": {
    "data": "{{email.body}}",
    "focus_on": ["newest message only", "urgent request"]
  }
}
```

### Warning Generated

```
[step8_1] Plugin 'chatgpt-research' is LLM-based - converting to ai_processing
```

### Special Handling for `summarize_content` Action

The `chatgpt-research` plugin's `summarize_content` action receives special prompt construction:
- Length preference (brief, detailed, etc.) is included in prompt
- Style preference (professional, casual, etc.) is included in prompt
- `focus_on` array items are preserved in params
- `content` input becomes `params.data`

---

## Cross-Step Dependency Detection in Filters

When a filter condition references data from another step (cross-step dependency), the DSL Builder automatically falls back to `ai_processing` since deterministic filters cannot evaluate cross-step lookups.

### Detection Logic

A filter condition is considered a cross-step dependency when:
1. The `field` name contains a reference to another step's output (e.g., `not_in_step6`)
2. The condition requires comparing against a dynamically computed set from another step

### Example

**Phase 4 Input (cross-step dependency):**
```json
{
  "id": "step7",
  "kind": "transform",
  "type": "filter",
  "inputs": {
    "collection": { "source": "from_step", "ref": "step4.urgent_client_emails" },
    "field": { "source": "constant", "value": "dedupe_key_not_in_logged_identifiers" },
    "operator": { "source": "constant", "value": "equals" },
    "value": { "source": "constant", "value": true }
  }
}
```

**After fallback (executable by LLM):**
```json
{
  "id": "step7",
  "type": "ai_processing",
  "prompt": "Remove urgent emails that appear to have already been logged (based on the chosen identifier).\n\nFilter the collection where dedupe_key_not_in_logged_identifiers equals true",
  "params": {
    "data": "{{step4.urgent_client_emails}}"
  }
}
```

### Warning Generated

```
[step7] Filter field 'dedupe_key_not_in_logged_identifiers' is a cross-step dependency - falling back to ai_processing
```

---

## Empty Mapping Fallback to AI Processing

When a mapping-based transform (`map`, `format`, `pick_fields`, etc.) has no valid configuration, the DSL Builder automatically falls back to `ai_processing` instead of creating a broken deterministic step.

### Detection Logic

A mapping-based transform is considered to have "no config" when:
1. It only has input source keys (`collection`, `data`, `input`, `items`, `array`, `source`)
2. No `template`, `mapping`, or `fields` keys are present
3. No other constant values are defined

### Fallback Behavior

| Original Step | Fallback Step |
|---------------|---------------|
| `type: "transform"` | `type: "ai_processing"` |
| `operation: "map"` | Uses step description as prompt |
| Empty `config.mapping` | `params.data` = input reference |

**Example - Before (would fail at runtime):**
```json
{
  "id": "step2",
  "type": "transform",
  "operation": "map",
  "input": "{{step1.emails}}",
  "config": { "mapping": {} }
}
```

**After fallback (executable by LLM):**
```json
{
  "id": "step2",
  "type": "ai_processing",
  "prompt": "Normalize Gmail results and derive sender domain and urgency signals needed for filtering.",
  "params": { "data": "{{step1.emails}}" }
}
```

### Warning Generated

```
[step2] Transform type 'map' has no mapping configuration - falling back to ai_processing
```

This ensures the workflow remains executable even when Phase 4 doesn't provide complete mapping logic.

---

## Suggested Plugins Resolution

The `suggested_plugins` field is populated using a fallback chain:

1. **Primary source**: `enhanced_prompt.specifics.services_involved`
2. **Fallback**: `requiredServices` from Phase 4 input

```typescript
// Resolution logic in build()
suggested_plugins: enhanced_prompt?.specifics?.services_involved || requiredServices || []
```

This ensures plugins are always populated even when `enhanced_prompt` is incomplete or missing service information.

---

## Confidence Calculation

The `confidence` score (0.0-1.0) reflects how reliably the DSL was generated. It starts from the feasibility score and is adjusted based on builder statistics.

### Base Score
- `feasibility.can_execute: true` → Base: 0.95
- `feasibility.can_execute: false` → Base: 0.7

### Adjustments

| Factor | Penalty | Description |
|--------|---------|-------------|
| Warnings | -0.01 each | Non-blocking issues detected during conversion |
| Errors | -0.02 each | Blocking issues that may affect execution |
| Fallbacks used | -0.005 each | Inference or fallback logic used (reduced from 0.01) |

### Calculation Formula

```typescript
let confidence = feasibility.can_execute ? 0.95 : 0.7;
confidence -= this.stats.warnings * 0.01;
confidence -= this.stats.errors * 0.02;
confidence -= this.stats.fallbacksUsed * 0.005;
confidence = Math.max(0.5, Math.min(1.0, confidence)); // Clamp to [0.5, 1.0]
```

### Example

For a workflow with:
- `feasibility.can_execute: true` (base 0.95)
- 2 warnings (-0.02)
- 0 errors (0)
- 3 fallbacks used (-0.015)

Final confidence: `0.95 - 0.02 - 0 - 0.015 = 0.915`

---

## Condition Parsing

Phase 4 conditions are string expressions that must be parsed into structured conditions:

| Phase 4 Condition String | PILOT_DSL Condition Object |
|--------------------------|----------------------------|
| `"step1.count > 0"` | `{ conditionType: "simple", field: "{{step1.count}}", operator: "greater_than", value: 0 }` |
| `"step2.status == 'success'"` | `{ conditionType: "simple", field: "{{step2.status}}", operator: "equals", value: "success" }` |
| `"step3.items.length > 0"` | `{ conditionType: "simple", field: "{{step3.items}}", operator: "is_not_empty", value: "" }` |
| `"step3.items.length == 0"` | `{ conditionType: "simple", field: "{{step3.items}}", operator: "is_empty", value: "" }` |

**Parsing Patterns:**
```
Pattern: ref.length > 0     → operator: "is_not_empty"
Pattern: ref.length == 0    → operator: "is_empty"
Pattern: ref == 'value'     → operator: "equals", value: "value"
Pattern: ref != 'value'     → operator: "not_equals", value: "value"
Pattern: ref > N            → operator: "greater_than", value: N
Pattern: ref >= N           → operator: "greater_than_or_equal", value: N
Pattern: ref < N            → operator: "less_than", value: N
Pattern: ref <= N           → operator: "less_than_or_equal", value: N
```

---

## Workflow Type Determination

The `workflow_type` is inferred from the step composition:

| Condition | Workflow Type |
|-----------|---------------|
| Has action steps AND ai_processing steps | `ai_external_actions` |
| Has action steps AND transform steps (no ai_processing) | `ai_external_actions` |
| Has only ai_processing steps | `data_retrieval_ai` |
| Has only action steps | `ai_external_actions` |
| Has only transform steps (deterministic) | `pure_ai` |
| Default | `pure_ai` |

---

## Nested Step Handling

Control steps can contain nested steps that must be recursively converted:

```
Phase 4 Control Step
└── steps[]                    ◄─── Recursively convert each
    ├── OperationStep          ──► ActionStep
    ├── TransformStep
    │   ├── Deterministic      ──► TransformStep
    │   └── LLM (*_with_llm)   ──► AIProcessingStep
    └── ControlStep            ──► ConditionalStep or ScatterGatherStep
        └── steps[]            ◄─── Recurse again
            └── ...
```

**Loop Variable Context:**
When inside a `for_each` control step, the `item_name` becomes available as a variable reference. Nested steps should use `{{item_name}}` or `{{item_name.field}}` to reference the current iteration item.

---

## Output Reference Handling

Phase 4 `outputs` field maps to how subsequent steps reference this step's data:

```
Phase 4 Outputs                      Usage in Later Steps
───────────────                      ────────────────────
{
  emails: "GmailMessage[]",          {{step1.emails}}
  count: "number"                    {{step1.count}}
}

Special output field:
  next_step: "step2"                 → Execution routing (not a data reference)
```

**Note:** The `next_step` field in outputs is for execution flow, not data access. PILOT_DSL_SCHEMA uses implicit sequential execution or dependency fields instead.

---

## Complete Mapping Example

### Phase 4 Input:
```json
{
  "technical_workflow": [
    {
      "id": "step1",
      "kind": "operation",
      "description": "Fetch recent emails from Gmail",
      "plugin": "google-mail",
      "action": "searchMessages",
      "inputs": {
        "query": { "source": "constant", "value": "is:unread" },
        "maxResults": { "source": "constant", "value": 10 }
      },
      "outputs": { "emails": "GmailMessage[]", "next_step": "step2" }
    },
    {
      "id": "step2",
      "kind": "transform",
      "type": "filter",
      "description": "Filter to important emails only",
      "inputs": {
        "collection": { "source": "from_step", "ref": "step1.emails" },
        "field": { "source": "constant", "value": "labelIds" },
        "operator": { "source": "constant", "value": "contains" },
        "value": { "source": "constant", "value": "IMPORTANT" }
      },
      "outputs": { "filtered_emails": "GmailMessage[]", "next_step": "step3" }
    },
    {
      "id": "step3",
      "kind": "control",
      "description": "Process each email",
      "control": {
        "type": "for_each",
        "item_name": "email",
        "collection_ref": "step2.filtered_emails"
      },
      "steps": [
        {
          "id": "step3_1",
          "kind": "transform",
          "type": "summarize_with_llm",
          "description": "Summarize email content",
          "inputs": {
            "content": { "source": "constant", "value": "{{email.body}}" }
          },
          "outputs": { "summary": "string" }
        }
      ],
      "outputs": { "summaries": "string[]", "next_step": "step4" }
    },
    {
      "id": "step4",
      "kind": "transform",
      "type": "format",
      "description": "Build HTML summary report",
      "inputs": {
        "data": { "source": "from_step", "ref": "step3.summaries" },
        "template": { "source": "constant", "value": "<ul>{{#each items}}<li>{{this}}</li>{{/each}}</ul>" }
      },
      "outputs": { "html_report": "string", "next_step": "step5" }
    },
    {
      "id": "step5",
      "kind": "control",
      "description": "Check if summaries exist",
      "control": {
        "type": "if",
        "condition": "step3.summaries.length > 0"
      },
      "steps": [
        {
          "id": "step5_1",
          "kind": "operation",
          "description": "Send summary to Slack",
          "plugin": "slack",
          "action": "send_message",
          "inputs": {
            "channel": { "source": "user_input", "key": "slack_channel", "plugin": "slack" },
            "text": { "source": "from_step", "ref": "step4.html_report" }
          },
          "outputs": { "message_id": "string" },
          "is_last_step": true
        }
      ]
    }
  ],
  "technical_inputs_required": [
    {
      "key": "slack_channel",
      "plugin": "slack",
      "description": "Slack channel to post summaries"
    }
  ],
  "enhanced_prompt": {
    "plan_title": "Email Summary Bot",
    "plan_description": "Fetches unread emails, summarizes them, and posts to Slack",
    "specifics": {
      "services_involved": ["google-mail", "slack"]
    }
  },
  "feasibility": {
    "can_execute": true,
    "blocking_issues": [],
    "warnings": []
  }
}
```

### PILOT_DSL_SCHEMA Output:
```json
{
  "agent_name": "Email Summary Bot",
  "description": "Fetches unread emails, summarizes them, and posts to Slack",
  "system_prompt": "You are an automation agent. Fetches unread emails, summarizes them, and posts to Slack",
  "workflow_type": "ai_external_actions",
  "suggested_plugins": ["google-mail", "slack"],
  "required_inputs": [
    {
      "name": "slack_channel",
      "type": "text",
      "label": "Slack Channel",
      "required": true,
      "description": "Slack channel to post summaries",
      "placeholder": "Enter slack channel",
      "reasoning": "Required by slack plugin"
    }
  ],
  "workflow_steps": [
    {
      "id": "step1",
      "name": "Fetch recent emails from Gmail",
      "type": "action",
      "plugin": "google-mail",
      "action": "searchMessages",
      "description": "Fetch recent emails from Gmail",
      "params": {
        "query": "is:unread",
        "maxResults": 10
      }
    },
    {
      "id": "step2",
      "name": "Filter to important emails only",
      "type": "transform",
      "operation": "filter",
      "input": "{{step1.emails}}",
      "config": {
        "condition": {
          "conditionType": "simple",
          "field": "{{item.labelIds}}",
          "operator": "contains",
          "value": "IMPORTANT"
        }
      },
      "description": "Filter to important emails only"
    },
    {
      "id": "step3",
      "name": "Process each email",
      "type": "scatter_gather",
      "description": "Process each email",
      "scatter": {
        "input": "{{step2.filtered_emails}}",
        "itemVariable": "email",
        "steps": [
          {
            "id": "step3_1",
            "name": "Summarize email content",
            "type": "ai_processing",
            "description": "Summarize email content",
            "prompt": "Summarize email content",
            "params": {
              "data": "{{email.body}}"
            }
          }
        ]
      },
      "gather": {
        "operation": "collect",
        "outputKey": "step3"
      }
    },
    {
      "id": "step4",
      "name": "Build HTML summary report",
      "type": "transform",
      "operation": "map",
      "input": "{{step3.summaries}}",
      "config": {
        "mapping": {
          "html_report": "<ul>{{#each items}}<li>{{this}}</li>{{/each}}</ul>"
        }
      },
      "description": "Build HTML summary report"
    },
    {
      "id": "step5",
      "name": "Check if summaries exist",
      "type": "conditional",
      "description": "Check if summaries exist",
      "condition": {
        "conditionType": "simple",
        "field": "{{step3.summaries}}",
        "operator": "is_not_empty",
        "value": ""
      },
      "then_steps": [
        {
          "id": "step5_1",
          "name": "Send summary to Slack",
          "type": "action",
          "plugin": "slack",
          "action": "send_message",
          "description": "Send summary to Slack",
          "params": {
            "channel": "{{input.slack_channel}}",
            "text": "{{step4.html_report}}"
          }
        }
      ]
    }
  ],
  "suggested_outputs": [
    {
      "name": "workflow_result",
      "type": "SummaryBlock",
      "category": "human-facing",
      "description": "Result of email summary bot",
      "format": "markdown",
      "reasoning": "Primary output showing workflow results"
    }
  ],
  "reasoning": "Generated workflow from technical workflow with 5 steps (1 action, 2 transform, 1 scatter_gather, 1 conditional).",
  "confidence": 0.95
}
```

---

## Decision Tree Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    Phase 4 Step                              │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
       kind: "operation"  kind: "transform"  kind: "control"
              │               │               │
              ▼               │               │
        ActionStep            │               │
        (type: "action")      │               │
                              │               │
                              ▼               │
                    ┌─────────┴─────────┐     │
                    │   Check `type`    │     │
                    └─────────┬─────────┘     │
                              │               │
              ┌───────────────┴───────────────┐
              ▼                               ▼
     Deterministic type?              LLM type (*_with_llm)?
     (filter, map, sort,              (summarize_with_llm,
      group_by, aggregate,             classify_with_llm, etc.)
      reduce, format, etc.)                   │
              │                               ▼
              ▼                         AIProcessingStep
        TransformStep                   (type: "ai_processing")
        (type: "transform")
                                              │
                              ┌───────────────┴───────────────┐
                              ▼                               ▼
                     control.type: "for_each"        control.type: "if"
                              │                               │
                              ▼                               ▼
                    ScatterGatherStep                ConditionalStep
                    (type: "scatter_gather")         (type: "conditional")
```

---

## Transform Type Reference

### Deterministic Types (No LLM Cost)

| Type | Purpose | Config Fields |
|------|---------|---------------|
| `filter` | Keep/remove items by condition | `condition` |
| `map` | Reshape items, compute derived fields | `mapping` |
| `sort` | Order items by key(s) | `field`, `order` |
| `group_by` | Bucket items by key | `field` |
| `aggregate` | Compute metrics (sum/count/avg/min/max) | `aggregations` |
| `reduce` | Fold list to single value | `reducer`, `initialValue` |
| `deduplicate` | Remove duplicates by key | `field`, `keep` (optional) |
| `flatten` | Convert nested → flat structure | `mapping` (specialized) |
| `pick_fields` | Select subset of fields | `mapping` |
| `format` | Render to string/HTML/markdown | `mapping` |
| `merge` | Combine objects/arrays | `mapping` |
| `split` | Group items by field value into buckets | `field` |
| `convert` | Type coercion, normalize formats | `mapping` |

### LLM Types (Requires AI Processing)

| Type | Purpose |
|------|---------|
| `summarize_with_llm` | Produce concise summary from text |
| `classify_with_llm` | Assign labels/categories |
| `extract_with_llm` | Extract structured fields from unstructured text |
| `analyze_with_llm` | Produce analysis/insights |
| `generate_with_llm` | Generate new text content |
| `translate_with_llm` | Translate between languages |
| `enrich_with_llm` | Add inferred attributes/metadata |

---

## Explicit Intent Classification (v2.8)

The DSL Builder now sets an explicit `intent` field on `ai_processing` steps to ensure correct handler routing during execution.

### Problem Solved

The IntentClassifier was incorrectly routing steps with both `input` and `prompt` fields to `GenerateHandler` instead of `ExtractHandler`. This caused:
- Raw string output instead of parsed JSON
- Downstream steps failing with "no input data" errors
- `{{stepX.data.items}}` references resolving to undefined

### Solution

**Phase4DSLBuilder** now adds `intent: "extract"` to all `ai_processing` steps:

```typescript
// In buildAIProcessingStep:
return {
  id: step.id,
  type: 'ai_processing',
  intent: 'extract',  // Explicit intent ensures ExtractHandler is used
  prompt: "...",
  params: { data: "{{...}}" }
}
```

**IntentClassifier** checks for explicit intent first:

```typescript
// At start of classify():
if (step.intent && validIntents.includes(step.intent)) {
  return {
    intent: step.intent,
    confidence: 1.0,
    reasoning: `Explicit intent specified: ${step.intent}`
  };
}
```

### Handler Behavior Difference

| Handler | Output Structure | Use Case |
|---------|------------------|----------|
| `ExtractHandler` | `{ items: [...] }` or `{ result: ... }` | JSON parsing, structured data |
| `GenerateHandler` | `{ result: "raw string" }` | Free-form text generation |

---

## Runtime Cross-Step Reference Resolution (v2.10)

The execution layer includes a fallback mechanism to resolve shorthand variable references that may slip through DSL generation.

### Output Alias Registry

When steps complete, `ExecutionContext` registers their output keys in an alias registry:

```typescript
// ExecutionContext.ts
private outputAliasRegistry: Map<string, string> = new Map();

// When step7 completes with output { counts: {...}, items: [...] }
// Registry populated: { "counts" → "step7", "items" → "step7" }
```

### Resolution Fallback

If a variable reference like `{{counts.total}}` reaches runtime without an explicit step prefix:

1. `resolveVariable()` checks `outputAliasRegistry.get("counts")`
2. Finds `"step7"` → resolves to `stepOutputs.get("step7").data.counts.total`
3. Logs warning: `"Resolving via output alias registry (shorthand reference)"`

### Defense-in-Depth Layers

| Layer | When | Component | Action |
|-------|------|-----------|--------|
| 1 | Generation | Phase 4 Prompt | LLM instructed to use `{{step7.counts.*}}` |
| 2 | Review | Technical Reviewer | Catches and rewrites `{{counts.*}}` → `{{step7.counts.*}}` |
| 3 | Runtime | ExecutionContext | Alias registry resolves remaining shorthand refs |

This ensures robust execution even when shorthand references slip through earlier layers.

---

## Files Reference

| File | Purpose |
|------|---------|
| `lib/validation/phase4-schema.ts` | Phase 4 input types and validation |
| `lib/validation/technical-reviewer-schema.ts` | Reviewer response schema + OutputContract types (Phase 5) |
| `lib/pilot/types.ts` | PILOT_DSL_SCHEMA output types |
| `lib/pilot/schema/pilot-dsl-schema.ts` | Full JSON schema for OpenAI strict mode |
| `lib/pilot/schema-registry.ts` | Schema registry with $ref resolution (Phase 5) |
| `lib/pilot/dsl-compiler.ts` | DSL compiler with $ref and stepX.data.Y validation (Phase 5) |
| `lib/agentkit/v4/core/phase4-dsl-builder.ts` | Phase4DSLBuilder implementation |
| `lib/pilot/StepExecutor.ts` | Transform execution including `transformFormat`, deduplicate with sort_field |
| `lib/orchestration/IntentClassifier.ts` | Intent classification with explicit intent support |
| `app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v15-chatgpt.txt` | Phase 4 prompt with explicit output schema declarations (Phase 5) |
| `app/api/prompt-templates/Workflow-Agent-Technical-Reviewer-SystemPrompt-v4.txt` | Reviewer prompt with output schema enforcement (Phase 5) |

---

**Document Version**: 2.16
**Updated**: 2026-01-15
**Changes**:
- v2.16: **Runtime Execution Fixes (P19-P24)**:
  - **Deterministic Map with Columns (P19)**: `hasMappingConfig()` now recognizes `columns` as valid config for deterministic map transforms
  - **Field Name Normalization (P20)**: Added `findFieldValue()` and `generateFieldNameVariations()` to handle field name variations (snake_case, camelCase, spaces)
  - **Static Values Support (P21)**: Added `extractStaticValuesFromDescription()` to parse patterns like `add Status="Open"` from step descriptions
  - **Map Output Reference Auto-Append (P22)**: `resolveInput()` now auto-appends single output key for map transforms (`{{step5.data}}` → `{{step5.data.rows}}`)
  - **Handlebars Block Helper Path Pre-Resolution (P23)**: `expandHandlebarsTemplate()` now pre-resolves paths in `{{#each step7.data.items}}` blocks before Handlebars compilation
  - **Data Freshness Validation (P24)**: Technical Reviewer v4 prompt includes DATA FRESHNESS VALIDATION section to detect and fix stale read-modify-read patterns
- v2.15: **Phase 5 Schema Validation Fix**:
  - **StepOutputValueSchema**: Extended to accept explicit output schema objects (e.g., `{ subject: "string", html_body: "string" }`)
  - Previously only accepted string type labels or branch objects, causing validation failures for Phase 5 explicit schemas
  - Added `ExplicitOutputSchemaSchema` = `z.record(z.string(), z.string())` to the union
- v2.14: **Phase 5 - Schema Contract Enforcement**:
  - **Output Schema Declaration**: Phase 4 prompt v15 now requires explicit output schema declarations (rejects `"object"`, `"object[]"`, `"any"`)
  - **Reviewer Enforcement**: Reviewer prompt v4 validates output schemas and adds blocking_gap for vague types
  - **Schema Registry Extension**: Added `$ref` resolution, AI schema storage, transform schema storage to `schema-registry.ts`
  - **New Types**: Added `OutputContract`, `AIOutputSchema`, `JSONSchema` types in `technical-reviewer-schema.ts`
  - **DSL Compiler Enhancement**: Validates `$ref` references exist, validates `stepX.data.Y` field references against declared outputs
  - **DSL Builder Enhancement**: Generates explicit split bucket outputs, passes split bucket keys to `buildStepOutputs`
  - **Deduplicate Enhancement**: Added `sort_field` and `keep` config options for deterministic deduplication ordering
- v2.13: Deterministic transform fixes for deduplicate and split:
  - **deduplicate**: Now maps to `deduplicate` operation (was incorrectly mapped to `filter`), uses `{ field: string, keep?: string }` config
  - **split**: Now maps to `split` operation (was incorrectly mapped to `map`), uses `{ field: string }` config for field-based grouping
  - **Field-based grouping**: Split transform groups items by field value into named buckets (e.g., `{ action_required: [...], fyi: [...], _meta: {...} }`)
  - **Removed from mapping-based classification**: deduplicate and split no longer require `{{item.*}}` mapping config
  - **Transform-specific validation**: Added `buildDeduplicateConfig()` and `buildSplitConfig()` in Phase4DSLBuilder
- v2.12: Runtime LLM output handling improvements:
  - **ai_processing Declared Output Mapping**: `StepExecutor.executeLLMDecision()` now maps parsed LLM results to declared output keys (e.g., `outputs: { content: "object" }` → `data.content = parsedResult`)
  - **Filter Case Normalization**: `transformFilter()` normalizes item keys to handle both camelCase and snake_case (e.g., `actionRequired` and `action_required` both work)
  - **Defense-in-depth**: These runtime fixes complement prompt-level guidance for LLM output formatting
- v2.11: Post-conditional output wiring:
  - **lastBranchOutput**: `StepExecutor.executeConditional()` now includes `lastBranchOutput` in return value for downstream step access
  - **Technical Reviewer Update**: Added POST-CONDITIONAL OUTPUT WIRING rules requiring `{{conditionalStep.data.lastBranchOutput.outputKey}}` pattern
  - **Best Practice**: Both branches should output the same key for uniform downstream access
- v2.10: Cross-step reference validation defense-in-depth:
  - **Phase 4 Prompt Update**: Added explicit step reference rules - all `{{...}}` references MUST use step prefixes
  - **Technical Reviewer Enhancement**: Added cross-step reference validation and repair with `reviewer_note`
  - **Runtime Output Alias Registry**: `ExecutionContext.outputAliasRegistry` resolves shorthand references like `{{counts.*}}` to `{{step7.data.counts.*}}`
  - **ExtractHandler JSON Repair**: Added `jsonrepair` fallback for malformed LLM JSON responses
  - **Removed**: `resolveTemplateStepReferences()` from Phase4DSLBuilder (redundant with runtime registry)
- v2.9: Execution layer fixes (see Phase4-DSL-Debugging-Session-Dec31-2025.md):
  - **JSON Response Parsing**: `executeLLMDecision` now parses JSON strings and spreads properties for direct `{{stepX.data.items}}` access
  - **Scatter Variable Resolution**: Non-action steps now resolve `params` field, enabling `{{email}}` scatter variables in ai_processing steps
  - **Google Sheets Values Normalization**: Auto-converts objects to flat value arrays for Sheets API compatibility
- v2.8: Multiple fixes for transform execution:
  - **Explicit Intent Classification**: Added `intent: "extract"` to ai_processing steps to ensure ExtractHandler is used (prevents GenerateHandler from returning raw strings instead of parsed JSON)
  - **Dedicated Format Operation**: Changed `format` transform from mapping to `map` to dedicated `format` operation with `transformFormat` method in StepExecutor
  - **Format Template Variables**: Template variables like `{{to_log_count}}` now resolve from input data fields directly, not from global context
  - **Aggregate Output Path**: Fixed `resolveInput` to return `{{stepId.data}}` for aggregate transforms (not `{{stepId.data.fieldName}}`) since aggregates store results directly at `.data` level
  - **IntentClassifier Enhancement**: Added check for explicit `step.intent` field at start of `classify()` method
- v2.7: Added OUTPUT FORMAT instructions to ai_processing prompts. LLM now returns structured JSON with `{items: [...]}` for arrays or `{result: ...}` for objects. Updated ExtractHandler to parse multiple JSON formats. This ensures consistent `{{stepX.data.items}}` references work reliably.
- v2.6: Enhanced mapping config detection - only configs with `{{item.*}}` references are valid for deterministic execution; constant-only configs (like `user_domain: "gmail.com"`) now correctly fall back to ai_processing. Updated step registry to predict fallbacks before conversion.
- v2.5: Smart step reference resolution based on source step type (map→`.data`, filter→`.data.items`, action/ai→`.data.fieldName`)
- v2.4: Fixed step output variable references to use `.data` path (e.g., `{{step1.data.emails}}` instead of `{{step1.emails}}`) for Pilot compatibility
- v2.3: Added LLM-based plugin fallback (chatgpt-research → ai_processing), cross-step dependency detection in filters
- v2.2: Added empty mapping fallback to ai_processing for mapping-based transforms without config
- v2.1: Added auto-extraction of `{{input.*}}` references, transform output contracts, suggested plugins fallback chain, confidence calculation details
- v2.0: Added transform type routing, deterministic vs LLM type distinction, config mapping from inputs
