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
| `feasibility.can_execute` | `confidence` | `true` → 0.95, `false` → 0.7 |
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
| `deduplicate` | `filter` | `{ condition: ... }` (specialized) |
| `flatten` | `map` | `{ mapping: ... }` (specialized) |
| `pick_fields` | `map` | `{ mapping: { field: "{{item.field}}" } }` |
| `format` | `map` | `{ mapping: { output: "template" } }` |
| `merge` | `map` | `{ mapping: ... }` (combine objects) |
| `split` | `map` | `{ mapping: ... }` (partition) |
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
```typescript
// Phase 4 inputs
{
  data: { source: "from_step", ref: "step1.leads" },
  template: { source: "constant", value: "<table>...</table>" },
  columns: { source: "constant", value: ["Name", "Email", "Status"] }
}

// PILOT DSL config
{
  input: "{{step1.leads}}",
  config: {
    mapping: {
      html_output: "<table>{{#each items}}...{{/each}}</table>"
    }
  }
}
```

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

## Input Source Resolution

Each `StepInput` in Phase 4 has a `source` field that determines how to resolve the value:

| Source | Phase 4 Example | PILOT_DSL_SCHEMA Output |
|--------|-----------------|-------------------------|
| `constant` | `{ source: "constant", value: "hello" }` | `"hello"` (literal value) |
| `constant` (template) | `{ source: "constant", value: "{{item.id}}" }` | `"{{item.id}}"` (preserved) |
| `from_step` | `{ source: "from_step", ref: "step1.emails" }` | `"{{step1.emails}}"` |
| `user_input` | `{ source: "user_input", key: "recipient_email" }` | `"{{input.recipient_email}}"` |
| `env` | `{ source: "env", key: "API_KEY" }` | `"{{env.API_KEY}}"` |
| `plugin_config` | `{ source: "plugin_config", plugin: "slack", key: "channel" }` | `"{{config.slack.channel}}"` |

**Resolution Logic:**
```typescript
function resolveStepInput(input: StepInput): any {
  switch (input.source) {
    case 'constant':
      return input.value;  // May contain {{...}} templates
    case 'from_step':
      return `{{${input.ref}}}`;
    case 'user_input':
      return `{{input.${input.key}}}`;
    case 'env':
      return `{{env.${input.key}}}`;
    case 'plugin_config':
      return `{{config.${input.plugin}.${input.key}}}`;
  }
}
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
| `deduplicate` | Remove duplicates by key | `condition` (specialized) |
| `flatten` | Convert nested → flat structure | `mapping` (specialized) |
| `pick_fields` | Select subset of fields | `mapping` |
| `format` | Render to string/HTML/markdown | `mapping` |
| `merge` | Combine objects/arrays | `mapping` |
| `split` | Break string/list, partition items | `mapping` |
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

## Files Reference

| File | Purpose |
|------|---------|
| `lib/validation/phase4-schema.ts` | Phase 4 input types and validation |
| `lib/pilot/types.ts` | PILOT_DSL_SCHEMA output types |
| `lib/pilot/schema/pilot-dsl-schema.ts` | Full JSON schema for OpenAI strict mode |
| `lib/agentkit/v4/core/phase4-dsl-builder.ts` | Phase4DSLBuilder implementation |
| `app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v14-chatgpt.txt` | Phase 4 prompt with transform types |
| `app/api/prompt-templates/Workflow-Agent-Technical-Reviewer-SystemPrompt-v3.txt` | Reviewer prompt with transform type validation |

---

**Document Version**: 2.0
**Updated**: 2024-12-25
**Changes**: Added transform type routing, deterministic vs LLM type distinction, config mapping from inputs
