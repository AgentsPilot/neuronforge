# V5 Workflow Generator Architecture

## Overview

The V5 Workflow Generator is a multi-stage system that transforms user intent (natural language prompts or pre-built technical workflows) into executable PILOT DSL workflows. It follows OpenAI's recommended 3-stage architecture for achieving 95%+ success rates in workflow generation.

## Why We Built It This Way

### The Problem with Pure LLM Approaches

Early versions relied heavily on LLMs to generate complete DSL schemas directly. This approach had significant issues:

1. **Schema Violations**: LLMs would invent field names, use wrong types, or skip required fields
2. **Plugin Hallucination**: LLMs would reference non-existent plugins or actions
3. **Parameter Drift**: Small prompt changes caused wildly different parameter structures
4. **Non-Determinism**: The same input could produce different outputs on each run

### The OpenAI 3-Stage Solution

Based on OpenAI's production patterns for agentic systems, we adopted a hybrid architecture:

| Stage | Component | Type | Purpose |
|-------|-----------|------|---------|
| 1A | StepPlanExtractor | LLM | Convert enhanced prompt → simple text steps |
| 1B | LLM Technical Reviewer | LLM | Validate & repair technical workflow |
| 2A | DSLBuilder | 100% Deterministic | Convert StepPlan → PILOT DSL (Path A) |
| 2B | Phase4DSLBuilder | 100% Deterministic | Convert TechnicalWorkflow → PILOT DSL (Path B) |
| 3 | LLM Repair Loop | LLM (if needed) | Fix ambiguities |

**Key insight**: By keeping Stage 2 purely deterministic, we guarantee schema compliance regardless of LLM variability.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         V5WorkflowGenerator                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────────┐     ┌──────────────────────┐              │
│  │   INPUT PATH A:      │     │   INPUT PATH B:      │              │
│  │   Enhanced Prompt    │     │   Technical Workflow │              │
│  └──────────┬───────────┘     └──────────┬───────────┘              │
│             │                            │                           │
│             ▼                            ▼                           │
│  ┌──────────────────────┐     ┌──────────────────────┐              │
│  │  STAGE 1A:           │     │  STAGE 1B:           │              │
│  │  StepPlanExtractor   │     │  LLM Technical       │              │
│  │  (Claude Sonnet LLM) │     │  Reviewer            │              │
│  │  - Extract steps     │     │  - Validate workflow │              │
│  │  - Simple text plan  │     │  - Repair issues     │              │
│  └──────────┬───────────┘     │  - Return reviewed   │              │
│             │                 │    technical workflow│              │
│             │                 └──────────┬───────────┘              │
│             │                            │                           │
│             ▼                            ▼                           │
│  ┌──────────────────────┐     ┌──────────────────────┐              │
│  │      StepPlan        │     │  STAGE 2B:           │              │
│  │  (Intermediate IR)   │     │  Phase4DSLBuilder    │              │
│  └──────────┬───────────┘     │  .build()            │              │
│             │                 │  (DIRECT CONVERSION) │              │
│             ▼                 │                      │              │
│  ┌──────────────────────┐     └──────────┬───────────┘              │
│  │  STAGE 2A:           │                │                          │
│  │  DSLBuilder          │                │                          │
│  │  .buildDSL()         │                │                          │
│  │  (100% Deterministic)│                │                          │
│  └──────────┬───────────┘                │                          │
│             │                            │                           │
│             └──────────────┬─────────────┘                           │
│                            │                                         │
│                            ▼                                         │
│                 ┌──────────────────────┐                            │
│                 │     PILOT_DSL        │                            │
│                 │   (Executable)       │                            │
│                 └──────────────────────┘                            │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Architecture Change (v5.2)

**Path B now uses Phase4DSLBuilder** - The new `Phase4DSLBuilder.build()` method directly converts the structured `TechnicalWorkflowStep[]` to PILOT DSL. This replaces the previous `DSLBuilder.buildFromTechnicalWorkflow()` approach and provides:

- **Full type safety** - No text parsing ambiguity
- **Cleaner code** - ~800 lines of adapter code removed
- **Better performance** - No regex-based parameter extraction
- **Explicit nesting** - Control structures use explicit `steps`/`else_steps` arrays

## Input Structures

### Enhanced Prompt (Path A Input)

The enhanced prompt is a JSON string produced by earlier conversation phases. It contains:

```typescript
interface EnhancedPrompt {
  plan_title: string;           // Agent name (e.g., "Email Notifier")
  plan_description: string;     // What the agent does
  specifics: {
    resolved_user_inputs?: Array<{
      key: string;              // e.g., "slack_channel"
      value: string;            // User-provided value
    }>;
    // ... other specifics from conversation
  };
}
```

This is the traditional input path where the LLM (StepPlanExtractor) parses the enhanced prompt and extracts a simple step plan.

---

### Technical Workflow (Path B Input)

The `technical_workflow` is a structured array of steps produced by Phase 4 of the enhanced prompt flow. It is directly converted to PILOT DSL by `Phase4DSLBuilder.build()`.

#### TechnicalWorkflowInput Structure

```typescript
interface TechnicalWorkflowInput {
  technical_workflow: TechnicalWorkflowStep[];
  enhanced_prompt?: {
    plan_title?: string;
    plan_description?: string;
    specifics?: {
      resolved_user_inputs?: Array<{ key: string; value: string }>;
      services_involved?: string[];  // Primary source for suggested_plugins
    };
  };
  analysis?: {
    agent_name?: string;
    description?: string;
  };
  // v2.1: Added for improved DSL generation
  requiredServices?: string[];              // Fallback for suggested_plugins
  technical_inputs_required?: TechnicalInputRequired[];  // Declared inputs from Phase 4
}
```

#### TechnicalWorkflowStep (Discriminated Union)

Each step has a `kind` field that determines its type:

```typescript
type TechnicalWorkflowStep = OperationStep | TransformStep | ControlStep;
```

##### 1. OperationStep (`kind: "operation"`)

Maps directly to a plugin action. This is the most common step type.

```typescript
interface OperationStep {
  id: string;              // e.g., "step1", "step2"
  kind: "operation";
  description: string;     // Human-readable description
  plugin: string;          // Required - e.g., "google-mail", "slack"
  action: string;          // Required - e.g., "send_email", "send_message"
  inputs: Record<string, StepInput>;   // Required - parameter bindings
  outputs: Record<string, string>;     // Required - output field descriptions
}
```

**Example:**
```json
{
  "id": "step3",
  "kind": "operation",
  "description": "Send notification to Slack",
  "plugin": "slack",
  "action": "send_message",
  "inputs": {
    "channel": {
      "source": "user_input",
      "key": "slack_channel"
    },
    "text": {
      "source": "from_step",
      "ref": "step2.summary"
    }
  },
  "outputs": {
    "message_id": "ID of the sent message"
  }
}
```

##### 2. TransformStep (`kind: "transform"`)

Data transformation operations (filtering, mapping, LLM processing). Converted to `ai_processing` type in PILOT DSL.

```typescript
interface TransformStep {
  id: string;
  kind: "transform";
  description: string;
  plugin?: string;         // Optional - for plugin-based transforms
  action?: string;         // Optional - for plugin-based transforms
  operation?: {
    type: string;          // e.g., "filter", "map", "llm_summarize"
  };
  inputs?: Record<string, StepInput>;
  outputs?: Record<string, string>;
}
```

**Example:**
```json
{
  "id": "step2",
  "kind": "transform",
  "description": "Summarize the email content",
  "operation": {
    "type": "llm_summarize"
  },
  "inputs": {
    "content": {
      "source": "from_step",
      "ref": "step1.body"
    }
  },
  "outputs": {
    "summary": "Summarized email content"
  }
}
```

##### 3. ControlStep (`kind: "control"`)

Control flow structures with explicit nested steps.

**Step ID Format:**
Step IDs support unlimited nesting depth using the pattern `stepN_M_P...`:
- `step1` - Top-level step
- `step2_1` - First nested step inside step2
- `step2_1_1` - Doubly nested step (e.g., loop inside a loop)
- `step2_1_1_3` - Arbitrarily deep nesting as needed

The regex pattern is: `/^step\d+(_\d+)*$/`

```typescript
interface ControlStep {
  id: string;
  kind: "control";
  description?: string;
  control?: {
    type: "for_each" | "if";   // Control type
    // For loops (for_each):
    item_name?: string;        // Iterator variable name (e.g., "email")
    collection_ref?: string;   // Reference to collection (e.g., "step1.emails")
    // For conditionals (if):
    condition?: string;        // Condition expression (e.g., "step5.count > 0")
  };
  inputs?: Record<string, StepInput>;
  outputs?: Record<string, string>;
  // Explicit nested steps:
  steps?: TechnicalWorkflowStep[];      // Loop body or if-then branch
  else_steps?: TechnicalWorkflowStep[]; // If-else branch (conditionals only)
}
```

**Loop Example (for_each):**
```json
{
  "id": "step14",
  "kind": "control",
  "control": {
    "type": "for_each",
    "item_name": "email_payload",
    "collection_ref": "step13.per_sales_person_emails"
  },
  "steps": [
    {
      "id": "step14_1",
      "kind": "operation",
      "plugin": "google-mail",
      "action": "send_email",
      "inputs": {
        "recipients": { "ref": "email_payload.recipients", "source": "from_step" },
        "content": { "ref": "email_payload.content", "source": "from_step" }
      },
      "outputs": { "sent_email": "SentEmail" },
      "description": "Send one follow-up email for this sales person payload."
    }
  ],
  "description": "Loop over per-sales-person payloads and send one email per sales person."
}
```

**Conditional Example (if/else):**
```json
{
  "id": "step6",
  "kind": "control",
  "control": {
    "type": "if",
    "condition": "step5.missing_owner.length > 0"
  },
  "steps": [
    {
      "id": "step6_1",
      "kind": "transform",
      "inputs": { "missing_owner": { "ref": "step5.missing_owner", "source": "from_step" } },
      "outputs": { "missing_owner_noted": "LeadRecord[]" },
      "description": "Append 'Sales person is missing' to Notes for each missing_owner lead."
    }
  ],
  "else_steps": [
    {
      "id": "step6_2",
      "kind": "transform",
      "inputs": { "has_owner": { "ref": "step5.has_owner", "source": "from_step" } },
      "outputs": { "missing_owner_noted": "LeadRecord[]" },
      "description": "No-op: pass through has_owner when there are no missing owners."
    }
  ],
  "description": "If missing_owner exists, annotate Notes; otherwise pass through."
}
```

#### Step Routing (v13/v2 Enhancement)

Steps now support explicit routing through `outputs.next_step` and `is_last_step` fields:

```typescript
// Non-final step with routing
{
  "id": "step1",
  "kind": "operation",
  "outputs": {
    "emails": "GmailMessage[]",
    "next_step": "step2"  // Routes to step2 after completion
  }
}

// Final step (no next_step)
{
  "id": "step5",
  "kind": "operation",
  "outputs": {
    "message_id": "string"
  },
  "is_last_step": true  // Marks this as the final step
}

// Branching step (multiple routes)
{
  "id": "step3",
  "kind": "control",
  "control": { "type": "if", "condition": "step2.count > 0" },
  "outputs": {
    "has_items": { "type": "boolean", "next_step": "step4" },
    "no_items": { "type": "boolean", "next_step": "step5" }
  }
}
```

**Routing Rules:**
- Every step except final must include `next_step` in outputs
- Branching steps must include `next_step` in each branch output
- Final step(s) must have `is_last_step: true` and no `next_step`
- All `next_step` values must reference existing step IDs

---

#### StepInput Schema

The `inputs` field maps parameter names to their value sources:

```typescript
interface StepInput {
  source: 'constant' | 'from_step' | 'user_input' | 'env' | 'plugin_config';
  value?: any;           // For 'constant' source
  ref?: string;          // For 'from_step' source (e.g., "step1.emails")
  key?: string;          // For 'user_input' source (e.g., "slack_channel")
  plugin?: string;       // For 'plugin_config' source
  action?: string;       // Optional - which action uses this
}
```

| Source | Description | DSL Output |
|--------|-------------|------------|
| `constant` | Literal value | Direct value or preserved `{{...}}` template |
| `from_step` | Output from previous step | `{{ref}}` |
| `user_input` | Runtime input from user | `{{input.key}}` |
| `env` | Environment variable | `{{env.key}}` |
| `plugin_config` | Plugin configuration | `{{config.plugin.key}}` |

---

## Component Deep Dive

### 1. V5WorkflowGenerator (`v5-generator.ts`)

The orchestrator that coordinates the entire pipeline.

**Two Input Paths:**

```typescript
interface WorkflowGenerationInput {
  // Path A: Traditional LLM extraction
  enhancedPrompt?: string;

  // Path B: Pre-built workflow (from enhanced prompt phase)
  technicalWorkflow?: TechnicalWorkflowInput;

  // For Path B: LLM review configuration
  provider?: ProviderName;  // e.g., "anthropic", "openai"
  model?: string;           // e.g., "claude-sonnet-4-20250514"
  required_services?: string[];
}
```

**Why Two Paths?**

- **Path A (Enhanced Prompt)**: Used when starting from natural language. The LLM extracts a simple step plan, then DSLBuilder converts it to DSL.
- **Path B (Technical Workflow)**: Used when the enhanced prompt phase already produced a structured `technical_workflow`. Adds LLM review for validation, then Phase4DSLBuilder converts to DSL.

### 2. DSLBuilder (`dsl-builder.ts`)

The **100% deterministic** engine that converts Path A inputs into valid PILOT DSL.

| Method | Input | Used By |
|--------|-------|---------|
| `buildDSL(stepPlan)` | Text-based StepPlan | Path A (enhanced prompt) |

**Why Deterministic?**

- **Schema Compliance**: Always produces valid PILOT_DSL_SCHEMA
- **Reproducibility**: Same input = same output, every time
- **Debuggability**: Issues can be traced to specific rules, not LLM randomness
- **Speed**: No API calls, runs in milliseconds

### 3. Phase4DSLBuilder (`phase4-dsl-builder.ts`)

The **100% deterministic** converter for Path B (technical workflow).

| Method | Input | Used By |
|--------|-------|---------|
| `build(phase4Response)` | Phase4Response with technical_workflow | Path B (technical workflow) |

**Note:** The reviewer's feasibility format (strings) is converted to Phase4Response format (objects) before calling `build()`.

#### v2.1 Enhancements

**Auto-Extraction of `{{input.*}}` References:**
The builder scans all workflow steps for `{{input.*}}` patterns and auto-generates `required_inputs` entries for any undeclared inputs. This prevents missing input declarations.

**Transform Output Contracts:**
Each transform operation type has a predefined output shape contract (e.g., `filter` → `T[]`, `group` → `{key, items}[]`). Steps now include explicit `outputs` definitions.

**Suggested Plugins Fallback:**
`suggested_plugins` uses a fallback chain: `enhanced_prompt.specifics.services_involved` → `requiredServices` → `[]`.

**Confidence Calculation:**
- Base: 0.95 (can_execute: true) or 0.7 (false)
- Penalties: -0.01/warning, -0.02/error, -0.005/fallback
- Clamped to [0.5, 1.0]

**LLM-Based Plugin Fallback (v2.3):**
Certain plugins like `chatgpt-research` are LLM-based and don't have real external actions. The builder automatically converts these from `action` to `ai_processing`:
- Detects LLM-based plugins during operation step conversion
- Builds appropriate prompt from action name and parameters
- Special handling for `summarize_content` action (length, style, focus_on)
- Emits warning: `Plugin 'chatgpt-research' is LLM-based - converting to ai_processing`

**Cross-Step Dependency Detection (v2.3):**
Filter conditions that reference other steps' outputs (e.g., `dedupe_key_not_in_logged_identifiers`) cannot be evaluated deterministically. The builder:
- Detects cross-step dependency patterns in filter field names
- Falls back to `ai_processing` with descriptive prompt
- Emits warning: `Filter field '...' is a cross-step dependency - falling back to ai_processing`

#### Additional Enhancements (v2.5-v2.9)

For complete details on recent enhancements, see [Phase4-to-PILOT_DSL-Mapping.md](./Phase4-to-PILOT_DSL-Mapping.md). Key additions include:

- **v2.5**: Smart step reference resolution based on source step type (map→`.data`, filter→`.data.items`, action→`.data.fieldName`)
- **v2.6**: Enhanced mapping config detection - only configs with `{{item.*}}` references are valid for deterministic execution
- **v2.7**: Output format instructions added to ai_processing prompts for consistent JSON output
- **v2.8**: Explicit intent classification (`intent: "extract"`) ensures correct handler routing; dedicated `format` operation for object-to-string formatting
- **v2.9**: Execution layer fixes for JSON response parsing, scatter variable resolution, and Google Sheets values normalization

#### Phase4DSLBuilder.build() - Direct Conversion

This method directly maps TechnicalWorkflowStep to PILOT DSL without text serialization:

| TechnicalWorkflow | → | PILOT DSL |
|-------------------|---|-----------|
| `kind: "operation"` | → | `type: "action"` |
| `kind: "transform"` | → | `type: "ai_processing"` |
| `kind: "control"` + `type: "for_each"` | → | `type: "scatter_gather"` |
| `kind: "control"` + `type: "if"` | → | `type: "conditional"` |
| `steps` (nested) | → | `scatter.steps` or `then_steps` |
| `else_steps` (nested) | → | `else_steps` |

**Input Resolution:**

| StepInput Source | DSL Output |
|------------------|------------|
| `source: "constant"` | Literal value (or preserved `{{...}}` if template) |
| `source: "from_step"` + `ref` | `{{ref}}` |
| `source: "user_input"` + `key` | `{{input.key}}` + tracked for required_inputs |
| `source: "env"` + `key` | `{{env.key}}` |
| `source: "plugin_config"` | `{{config.plugin.key}}` |

**Condition Parsing:**

Conditions like `"step5.missing_owner.length > 0"` are parsed into structured format:

```typescript
// Input: "step5.missing_owner.length > 0"
// Output:
{
  conditionType: 'simple',
  field: '{{step5.missing_owner}}',
  operator: 'is_not_empty',
  value: ''
}
```

---

## Data Flow Example

### Starting Point: Technical Workflow from Phase 4

```json
{
  "technical_workflow": [
    {
      "id": "step1",
      "kind": "operation",
      "plugin": "google-mail",
      "action": "fetch_emails",
      "description": "Fetch recent emails",
      "inputs": {
        "max_results": { "source": "constant", "value": 10 }
      },
      "outputs": { "emails": "List of email objects" }
    },
    {
      "id": "step2",
      "kind": "control",
      "control": {
        "type": "for_each",
        "item_name": "email",
        "collection_ref": "step1.emails"
      },
      "steps": [
        {
          "id": "step2_1",
          "kind": "operation",
          "plugin": "slack",
          "action": "send_message",
          "description": "Send notification to Slack",
          "inputs": {
            "channel": { "source": "user_input", "key": "slack_channel" },
            "text": { "source": "from_step", "ref": "email.subject" }
          },
          "outputs": { "message_id": "ID of sent message" }
        }
      ],
      "description": "Process each email"
    }
  ]
}
```

### After Phase4DSLBuilder.build() → PILOT_DSL_SCHEMA

```json
{
  "agent_name": "Technical Workflow Agent",
  "description": "Agent generated from technical workflow",
  "workflow_type": "ai_external_actions",
  "suggested_plugins": ["google-mail", "slack"],
  "required_inputs": [
    {
      "name": "slack_channel",
      "type": "text",
      "label": "Slack Channel",
      "required": true,
      "description": "Channel for workflow"
    }
  ],
  "workflow_steps": [
    {
      "id": "step1",
      "name": "Fetch recent emails",
      "type": "action",
      "plugin": "google-mail",
      "action": "fetch_emails",
      "description": "Fetch recent emails",
      "params": { "max_results": 10 }
    },
    {
      "id": "step2",
      "name": "Process each email",
      "type": "scatter_gather",
      "description": "Process each email",
      "scatter": {
        "input": "{{step1.emails}}",
        "steps": [
          {
            "id": "step2_1",
            "name": "Send notification to Slack",
            "type": "action",
            "plugin": "slack",
            "action": "send_message",
            "description": "Send notification to Slack",
            "params": {
              "channel": "{{input.slack_channel}}",
              "text": "{{email.subject}}"
            }
          }
        ],
        "itemVariable": "email"
      },
      "gather": {
        "operation": "collect",
        "outputKey": "step2"
      }
    }
  ],
  "confidence": 0.95
}
```

---

## Validation & Safety

### DSLBuilder Validations

- **Plugin existence**: Does the referenced plugin exist?
- **Action existence**: Does the action exist on that plugin?
- **Parameter types**: Do parameter values match schema types?
- **Reference validity**: Do `{{stepX.field}}` references point to real steps?
- **Required fields**: Are all required parameters provided?

### Type Guards

The phase4-schema provides type guards for safe step handling:

```typescript
import {
  isOperationStep,
  isTransformStep,
  isControlStep,
  isForEachControl,
  isIfControl,
} from '@/lib/validation/phase4-schema';

// Usage
if (isControlStep(step) && isForEachControl(step)) {
  // Handle loop
}
```

---

## LLM Review (Path B Enhancement)

When using the technical workflow path, an LLM reviewer validates the workflow before conversion.

### Prompt Templates (v2)

The reviewer uses dedicated prompt templates:
- **System Prompt**: `Workflow-Agent-Technical-Reviewer-SystemPrompt-v2`
- **User Prompt**: `Workflow-Agent-Technical-Reviewer-UserPrompt-v2`

**v2 Enhancements:**
- Mandatory step routing via `next_step` in outputs
- `is_last_step: true` marker for final step(s)
- Explicit routing requirements for loops and conditionals
- No next_step allowed on final steps

### Schema Validation

Responses are validated using Zod schemas defined in `lib/validation/technical-reviewer-schema.ts`:

```typescript
interface ReviewerSummary {
  status: 'approved' | 'repaired' | 'blocked';
  blocking_gaps?: Array<{
    type: string;
    details: string;
    how_to_fix_in_phase2?: string;
  }>;
  warnings?: string[];
  step_changes?: Array<{
    change_type: 'edit' | 'insert' | 'delete' | 'move';
    step_id: string;
    reason: string;
    evidence_refs?: string[];
  }>;
}

interface TechnicalReviewerFeasibility {
  can_execute: boolean;
  blocking_issues?: string[];
  warnings?: string[];
}
```

**Validation Helper:**
```typescript
import { validateTechnicalReviewerResponse } from '@/lib/validation/technical-reviewer-schema';

const result = validateTechnicalReviewerResponse(llmResponse);
if (!result.success) {
  console.error('Validation errors:', result.errors);
}
```

The reviewer can:
- Identify missing steps
- Fix invalid plugin/action references
- Restructure control flow (add explicit `steps`/`else_steps`)
- Ensure proper step routing (`next_step`, `is_last_step`)
- Block generation if issues are unfixable

### Input Preservation (v5.3 Fix)

The LLM reviewer only returns `technical_workflow`, `reviewer_summary`, and `feasibility`. Important fields from the original Phase 4 input must be preserved when merging:

```typescript
// Fields preserved from original input (not returned by reviewer)
const phase4Input: Phase4Response = {
  // From reviewer output (validated/repaired workflow)
  technical_workflow: reviewedWorkflow.technical_workflow,
  feasibility: convertedFeasibility,

  // From original Phase 4 input (preserved)
  enhanced_prompt: originalInput.enhanced_prompt,
  technical_inputs_required: originalInput.technical_inputs_required || [],
  requiredServices: originalInput.requiredServices,
};
```

This ensures `suggested_plugins` (from `enhanced_prompt.specifics.services_involved`) and `required_inputs` (from `technical_inputs_required`) are correctly populated in the final DSL.

### Error Handling & JSON Repair

LLM responses can sometimes be malformed or truncated, even when the model reports `stop_reason: end_turn`. The V5 generator includes robust error handling:

**Response Diagnostics:**
```typescript
// Logged for every LLM response
logger.info({
  finishReason,          // 'stop' (OpenAI) or 'end_turn' (Anthropic)
  contentLength,         // Response length in characters
  inputTokens,           // Prompt tokens used
  outputTokens,          // Completion tokens generated
}, 'LLM response received');
```

**JSON Repair with `jsonrepair`:**
When JSON parsing fails, the system attempts automatic repair using the `jsonrepair` library:

```typescript
try {
  rawParsed = JSON.parse(cleanedContent);
} catch (parseError) {
  // Attempt repair for truncated/malformed JSON
  const repairedJson = jsonrepair(cleanedContent);
  rawParsed = JSON.parse(repairedJson);
  logger.info({ originalLength, repairedLength }, 'JSON repaired successfully');
}
```

This handles common LLM issues:
- Truncated responses (model stopped mid-JSON)
- Missing closing brackets/braces
- Trailing commas
- Incomplete string literals

**Prompt Reinforcement:**
The Technical Reviewer system prompt (v2) includes explicit JSON completion instructions:
> "CRITICAL: You MUST output complete, valid JSON. Do not stop mid-response. Do not truncate."

---

## Cross-Step Reference Validation (Defense-in-Depth)

Variable references in workflows must use explicit step prefixes to be resolvable at runtime. The system uses a 3-layer defense to ensure all references are valid.

### The Problem

Phase 4 LLM might generate templates with shorthand references:
```json
{
  "step7": { "outputs": { "counts": "object" } },
  "step8": { "template": "Total: {{counts.total}}" }  // WRONG: no step prefix
}
```

The runtime only supports qualified references:
- `{{stepX.data.*}}` - Step outputs
- `{{input.*}}` - User inputs
- `{{env.*}}` - Environment variables
- `{{config.*}}` - Plugin config
- `{{item.*}}` - Loop iteration variable

### Defense Layers

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Phase 4 Prompt (Generation)                       │
│  LLM instructed to use {{step7.counts.*}} explicitly        │
│  File: Workflow-Agent-Creation-Prompt-v14-chatgpt.txt       │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Technical Reviewer (Validation & Repair)          │
│  Catches {{counts.*}} → rewrites to {{step7.counts.*}}      │
│  Adds reviewer_note explaining the fix                      │
│  File: Workflow-Agent-Technical-Reviewer-SystemPrompt-v3    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: Runtime outputAliasRegistry (Fallback)            │
│  ExecutionContext resolves any remaining shorthand refs     │
│  Logs warning to help identify issues                       │
│  File: lib/pilot/ExecutionContext.ts                        │
└─────────────────────────────────────────────────────────────┘
```

### Layer 1: Phase 4 Prompt

The Phase 4 prompt includes explicit rules for cross-step references:
- All `{{...}}` references in templates MUST use explicit step prefixes
- Format: `{{stepId.outputKey.field}}`
- CORRECT: `{{step7.counts.total_threads}}`
- WRONG: `{{counts.total_threads}}`

### Layer 2: Technical Reviewer

The Technical Reviewer validates and repairs shorthand references:
1. Identifies which step outputs the referenced key
2. Rewrites to explicit form: `{{counts.total}}` → `{{step7.counts.total}}`
3. Adds `reviewer_note` explaining the fix

### Layer 3: Runtime Registry

The `ExecutionContext.outputAliasRegistry` provides a last-resort fallback:

```typescript
// When step7 completes with output { counts: {...}, items: [...] }
// Registry is populated: { "counts" → "step7", "items" → "step7" }

// If {{counts.total}} reaches runtime:
// 1. Check outputAliasRegistry.get("counts") → "step7"
// 2. Resolve to stepOutputs.get("step7").data.counts.total
// 3. Log warning to help identify the shorthand usage
```

This ensures robust execution even if shorthand references slip through earlier layers.

---

## Conditional Step Output Wiring (v5.4)

When a conditional step executes, the runtime needs to provide downstream steps with access to whichever branch was taken. This is handled via `lastBranchOutput`.

### The Problem

After a conditional step completes, downstream steps need to reference the output:
```json
{
  "id": "step5",
  "type": "conditional",
  "then_steps": [{ "id": "step5_4", "outputs": { "content": "object" } }],
  "else_steps": [{ "id": "step5_5", "outputs": { "content": "object" } }]
}
// step8 needs to use whichever branch's "content" was produced
```

Referencing a specific branch step (e.g., `{{step5_4.data.content}}`) fails if the else branch ran instead.

### Solution: lastBranchOutput

The `StepExecutor.executeConditional()` method now includes `lastBranchOutput` in its return value:

```typescript
// StepExecutor.ts - executeConditional()
const lastBranchResult = branchResults[branchResults.length - 1];
const lastBranchOutput = lastBranchResult?.data ?? null;

return {
  result: conditionResult,
  condition: stepCondition,
  branch: branchName,
  branchResults,
  executedSteps: branchToExecute.length,
  lastBranchOutput,  // Direct access to last executed step's output data
};
```

### Usage in DSL

Downstream steps should reference the conditional step's `lastBranchOutput`:

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

### Technical Reviewer Rules

The Technical Reviewer prompt (v3) includes POST-CONDITIONAL OUTPUT WIRING rules:
- Steps after conditionals MUST use `lastBranchOutput` pattern
- Both branches SHOULD output the same key for uniform downstream access
- WRONG: `{{step5_4.data.content}}` (specific branch reference)
- CORRECT: `{{step5.data.lastBranchOutput.content}}`

---

## ai_processing Declared Output Key Mapping (v5.5)

When a DSL step declares specific output keys, the `ai_processing` handler now maps parsed LLM results to those keys.

### The Problem

DSL steps declare expected outputs:
```json
{
  "id": "step5_5",
  "type": "ai_processing",
  "outputs": { "content": { "type": "object" } }
}
```

But the handler stored output in generic keys (`result`, `response`, etc.), so `{{step5.data.content}}` was undefined.

### Solution: Declared Output Mapping

`StepExecutor.executeLLMDecision()` now maps parsed results to declared output keys:

```typescript
// If step declares outputs like { content: "object" }, map the parsed result
const declaredOutputs = (step as any).outputs;
if (declaredOutputs && parsedData) {
  for (const outputKey of Object.keys(declaredOutputs)) {
    if (outputKey !== 'next_step' && !outputData.hasOwnProperty(outputKey)) {
      // If parsedData has a 'result' wrapper, unwrap it
      if (parsedData.result && typeof parsedData.result === 'object') {
        outputData[outputKey] = parsedData.result;
      } else {
        outputData[outputKey] = parsedData;
      }
    }
  }
}
```

### Behavior

| LLM Returns | Declared Output | Result |
|-------------|-----------------|--------|
| `{"result": {"subject": "...", "body": "..."}}` | `outputs: { content: "object" }` | `data.content = { subject, body }` |
| `{"items": [...]}` | `outputs: { results: "array" }` | `data.results = [...]` |

---

## Filter Case Normalization (v5.5)

LLMs may output field names with different casing than expected by the DSL filter conditions.

### The Problem

```
DSL Filter: item.action_required (snake_case)
LLM Output: item.actionRequired (camelCase)
Result: Filter condition fails, all items filtered out
```

### Solution: Key Normalization

`StepExecutor.transformFilter()` now normalizes item keys before filtering:

```typescript
private normalizeItemKeys(item: any): any {
  const normalized = { ...item };

  for (const key of Object.keys(item)) {
    const value = item[key];

    // Convert camelCase to snake_case
    const snakeCase = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (snakeCase !== key && !normalized.hasOwnProperty(snakeCase)) {
      normalized[snakeCase] = value;
    }

    // Convert snake_case to camelCase
    const camelCase = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    if (camelCase !== key && !normalized.hasOwnProperty(camelCase)) {
      normalized[camelCase] = value;
    }
  }

  return normalized;
}
```

### Behavior

| Input | After Normalization |
|-------|---------------------|
| `{ actionRequired: true }` | `{ actionRequired: true, action_required: true }` |
| `{ action_required: false }` | `{ action_required: false, actionRequired: false }` |

This ensures filters work regardless of LLM output casing.

---

## DSL Execution Pipeline (v5.7)

The execution pipeline includes multiple validation and normalization layers to ensure reliable workflow execution.

### Execution Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PILOT_DSL_SCHEMA                                     │
│                    (Generated by Phase4DSLBuilder)                           │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 1: DSL Compiler/Validator (Pre-Execution)                             │
│  ─────────────────────────────────────────────────                           │
│  File: lib/pilot/dsl-compiler.ts                                            │
│                                                                              │
│  Validates BEFORE execution:                                                 │
│  • Step reference validation ({{stepX.field}} points to real step)          │
│  • Output key validation (referenced keys exist in target step outputs)     │
│  • Template syntax validation (Handlebars expressions are well-formed)      │
│  • Control flow validation (lastBranchOutput for conditionals)              │
│  • Loop item variable tracking (custom item_name scope management)          │
│  • Schema field validation (field names match plugin output schemas)        │
│                                                                              │
│  Returns: CompilationResult { valid, errors[], warnings[], autoFixes[] }    │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 2: Schema Registry                                                    │
│  ────────────────────────                                                    │
│  File: lib/pilot/schema-registry.ts                                         │
│                                                                              │
│  Provides plugin schema access for validation:                               │
│  • Delegates to PluginManagerV2 for action definitions                      │
│  • getOutputSchema(plugin, action) → field names and types                  │
│  • validateFieldPath(plugin, action, path) → checks field exists            │
│  • getAllFieldPaths(plugin, action) → lists all valid field paths           │
│                                                                              │
│  Used by: DSL Compiler for template field validation                        │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 3: Step Executor                                                      │
│  ──────────────────────                                                      │
│  File: lib/pilot/StepExecutor.ts                                            │
│                                                                              │
│  Executes each step with:                                                    │
│  • Output Normalizer integration (consistent data structure)                 │
│  • LLM Output Validator (schema validation with retry for ai_processing)    │
│  • Transform output mapping (declared outputs → actual keys)                 │
│  • Case normalization for filters (camelCase ↔ snake_case)                  │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 4: Output Normalizer                                                  │
│  ─────────────────────────                                                   │
│  File: lib/pilot/output-normalizer.ts                                       │
│                                                                              │
│  Ensures consistent output structure:                                        │
│  • Wraps all outputs in StepOutput { success, data, error?, metadata? }     │
│  • Normalizes output keys to declared names                                  │
│  • Maps common field patterns (e.g., 'result' → declared output key)        │
│  • Handles array/object wrapping consistently                                │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 5: LLM Output Validator (for ai_processing steps)                     │
│  ───────────────────────────────────────────────────────                     │
│  File: lib/pilot/llm-output-validator.ts                                    │
│                                                                              │
│  Validates LLM responses against declared schemas:                           │
│  • JSON schema validation (type, required fields, constraints)               │
│  • Automatic JSON repair for malformed responses                             │
│  • Retry logic (up to 2 retries with error feedback in prompt)              │
│  • Schema pattern library (classification, extraction, summary, list, etc.) │
│                                                                              │
│  Usage in StepExecutor.executeLLMDecision():                                │
│  1. Build prompt with schema instructions if output_schema declared         │
│  2. Execute LLM call                                                         │
│  3. Validate response against schema                                         │
│  4. Retry with error hints if validation fails                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### DSL Compiler Details

The DSL Compiler (`lib/pilot/dsl-compiler.ts`) performs comprehensive pre-execution validation:

**Reference Validation:**
```typescript
// Validates that step references point to existing steps
"{{step3.emails}}" → checks stepIndex.has("step3")

// Validates output keys exist in target step
"{{step3.emails}}" → checks outputRegistry.get("step3").includes("emails")
```

**Control Flow Validation:**
```typescript
// P10: Conditional steps expose lastBranchOutput
"{{step5.lastBranchOutput.content}}" → valid if step5 is conditional (type: "if")

// P11: Loop item variables are scoped correctly
for_each with item_name: "email_payload"
  → "{{email_payload.recipients}}" is valid inside loop body
  → "{{email_payload.recipients}}" is invalid outside loop
```

**Schema Field Validation:**
```typescript
// Validates field names against plugin output schemas
step1 uses google-mail.search_emails
"{{step1.data.emails[].from}}" → valid (from is in output_schema)
"{{step1.data.emails[].sender}}" → error (sender not in schema, use 'from')
```

### LLM Output Validator Details

The LLM Output Validator (`lib/pilot/llm-output-validator.ts`) provides schema enforcement for ai_processing steps:

**Schema Patterns:**
| Pattern | Structure | Use Case |
|---------|-----------|----------|
| `classification` | `{ category, confidence?, reasoning? }` | Categorizing items |
| `extraction` | `{ items: [...] }` | Extracting structured data |
| `summary` | `{ summary, key_points? }` | Summarizing content |
| `list` | `{ items: string[] }` | Simple list output |
| `decision` | `{ decision, reasoning }` | Decision with explanation |
| `boolean_result` | `{ result: boolean, reason? }` | Yes/no decisions |

**Validation Flow:**
```typescript
// In StepExecutor.executeLLMDecision():
const MAX_RETRIES = 2;
for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  const result = await this.callLLM(prompt);

  if (outputSchema) {
    const validation = validateLLMOutput(result.response, outputSchema);
    if (validation.valid) {
      return validation.data;  // Parsed and validated
    }
    // Add retry hint to prompt for next attempt
    prompt = `${prompt}\n\nPREVIOUS ERROR: ${validation.retryHint}`;
  }
}
```

### Files Reference (Execution Pipeline)

| File | Purpose |
|------|---------|
| `lib/pilot/dsl-compiler.ts` | Pre-execution validation of DSL |
| `lib/pilot/schema-registry.ts` | Plugin schema access for field validation |
| `lib/pilot/output-normalizer.ts` | Consistent output structure wrapping |
| `lib/pilot/llm-output-validator.ts` | JSON schema validation for LLM responses |
| `lib/pilot/StepExecutor.ts` | Step execution with all layers integrated |

---

## Runtime Execution Enhancements (v5.6)

The following `StepExecutor` enhancements ensure DSL-generated workflows execute correctly at runtime.

### Transform Output Key Mapping

`StepExecutor.execute()` maps transform results to declared DSL output keys (lines 281-327):

| Transform | Runtime Output | Mapped Output |
|-----------|---------------|---------------|
| `filter` | `{ items: [...] }` | `{ items: [...], [declaredKey]: [...] }` |
| `format` | `"string"` | `{ [declaredKey]: "string" }` |

```typescript
// Filter transform mapping
if (operation === 'filter' && result.items) {
  for (const outputKey of Object.keys(transformOutputs)) {
    if (!result.hasOwnProperty(outputKey)) {
      result[outputKey] = result.items;
    }
  }
}

// Format transform wrapping
if (typeof result === 'string' && operation === 'format') {
  result = { [outputKey]: result };
}
```

This enables downstream steps to reference `{{step4.data.filtered_items}}` when the step declares `outputs: { filtered_items: "object[]" }`.

### Template Expansion

Format templates (`transformFormat`) use prioritized resolution (lines 1850-1974):

1. **Input data fields** - `{{to_log_count}}` → `data.to_log_count`
2. **Nested paths** - `{{user.name}}` → `data.user.name`
3. **Context step refs** - `{{step1.data.field}}` → resolved from ExecutionContext

**Handlebars Detection:**
Templates containing block syntax (`{{#each}}`, `{{#if}}`, `{{/each}}`, `{{@index}}`, `{{this}}`) are auto-detected and routed to the Handlebars engine:

```typescript
const hasHandlebarsBlocks = /\{\{[#/]|else\}\}|\{\{@|\{\{this\}\}/.test(template);
if (hasHandlebarsBlocks) {
  return this.expandHandlebarsTemplate(template, data, context);
}
return this.expandSimpleTemplate(template, data, context);
```

**JSON Template Escaping:**
When templates produce JSON output (detected by `{...}` structure), string values are automatically escaped to prevent JSON syntax errors.

### Structured Output Unwrapping

Transform operations that chain together may receive structured output objects instead of raw arrays. The `unwrapStructuredOutput()` helper extracts the data array:

```typescript
// Handles: { items: [...] }, { filtered: [...] }, { groups: [...] }
private unwrapStructuredOutput(data: any): any {
  if (Array.isArray(data)) return data;
  if (data?.items) return data.items;
  if (data?.filtered) return data.filtered;
  if (data?.groups) return data.groups;
  // ... etc
}
```

This enables chaining like `filter → group → aggregate` without manual unwrapping in the DSL.

---

## Runtime Execution Fixes (v5.8)

Additional fixes for DSL execution reliability, addressing issues discovered during end-to-end testing.

### Deterministic Map with Columns (P19)

Map transforms with `columns` configuration now execute deterministically without falling back to ai_processing.

**Problem:** `hasMappingConfig()` didn't recognize `columns` as valid config, causing map transforms with column specifications to fall back to LLM.

**Solution:** Updated `hasMappingConfig()` in Phase4DSLBuilder:
```typescript
if (key === 'columns' && input?.source === 'constant' && Array.isArray(input.value)) {
  hasValidConfig = true;
}
```

### Field Name Normalization (P20)

Map transforms now handle field name variations automatically.

**Problem:** Column names like "received time" didn't match data fields like `received_time` or `receivedTime`.

**Solution:** Added field name normalization helpers in StepExecutor:
- `findFieldValue()` - Finds values using various name normalizations
- `generateFieldNameVariations()` - Generates variations (snake_case, camelCase, spaces, hyphens)

```typescript
// "received time" → ["received_time", "receivedTime", "ReceivedTime", "received-time"]
// "CTA text" → ["cta_text", "ctaText", "CTA_text"]
```

### Static Values Support (P21)

Map transforms can now include static values extracted from step descriptions.

**Problem:** Values like `Status="Open"` had to be LLM-generated even though they're static.

**Solution:** Added `extractStaticValuesFromDescription()` in Phase4DSLBuilder:
```typescript
// Parses: "add Status='Open'" → { Status: "Open" }
// Patterns: add X="Y", set X="Y", X="Y"
```

### Map Output Reference Auto-Append (P22)

Map transform references now auto-append the single output key.

**Problem:** `{{step5.data}}` referenced a map transform but returned `{ rows: [[...]] }` instead of the array.

**Solution:** Updated `resolveInput()` in Phase4DSLBuilder:
```typescript
if (operation === 'map') {
  const outputKeys = stepInfo.outputKeys || [];
  if (outputKeys.length === 1) {
    return `{{${stepId}.data.${outputKeys[0]}}}`;  // Auto-append
  }
}
```

### Handlebars Block Helper Path Pre-Resolution (P23)

Block helpers like `{{#each}}` now correctly resolve runtime step references.

**Problem:** `{{#each step7.data.open_items}}` couldn't find `step7` in Handlebars context because block helper paths weren't pre-resolved.

**Solution:** Added block helper path pre-resolution in `expandHandlebarsTemplate()` and `expandHandlebarsTemplateWithJsonEscape()`:
```typescript
// Pre-resolve paths inside block helpers BEFORE simple variable regex
template.replace(/\{\{#(each|if|unless|with)\s+(step[^}]+)\}\}/g, (match, helper, path) => {
  const resolved = context.resolveVariable(`{{${path}}}`);
  const safeKey = `__resolved_${path.replace(/\./g, '_')}`;
  handlebarsContext[safeKey] = resolved;
  return `{{#${helper} ${safeKey}}}`;
});
```

### Data Freshness Validation (P24)

Technical Reviewer v4 now detects and fixes stale read-modify-read patterns.

**Problem:** Workflows reading from a resource, modifying it, then referencing the original read would use stale data.

**Solution:** Added DATA FRESHNESS VALIDATION section to Technical Reviewer prompt v4:
- Detects read-modify-read patterns across any plugin
- Generic operation categories: READ (`read_*`, `get_*`, `fetch_*`) vs WRITE (`append_*`, `update_*`, `insert_*`)
- Automatically inserts re-read step after modifications
- Updates downstream references to use fresh data

---

## Session Tracking (Workflow Generation Diary)

The V5 generator includes optional session tracking that records a "diary" of the workflow generation process. This creates an audit trail of all LLM calls, validations, and repairs for debugging and analytics.

### WorkflowSessionTracker

Session tracking is encapsulated in the `WorkflowSessionTracker` helper class, which manages the session lifecycle independently from the generator's business logic.

**File:** `lib/agentkit/v4/utils/workflow-session-tracker.ts`

```typescript
import { WorkflowSessionTracker, SessionTrackerConfig } from '@/lib/agentkit/v4/utils/workflow-session-tracker';

// Create tracker with config
const tracker = new WorkflowSessionTracker({
  enabled: true,
  userId: 'user-123',
  openaiThreadId: 'thread_abc123', // Optional - links to System 1
});

// Session lifecycle
await tracker.start(input, 'technical_workflow');
await tracker.addStage({ stage_name: 'technical_reviewer', ... });
await tracker.completeStage({ output_data: { ... } });
await tracker.complete(outputDsl);
// Or on failure:
await tracker.fail('Error message');
```

### SessionTrackerConfig

```typescript
interface SessionTrackerConfig {
  /** Enable session tracking (creates diary entries in DB) */
  enabled: boolean;
  /** User ID for the session */
  userId: string;
  /** OpenAI thread ID from System 1 for log correlation */
  openaiThreadId?: string;
}
```

### Session Stages

Each stage of the generation pipeline is recorded:

| Stage Name | Description |
|------------|-------------|
| `technical_reviewer` | LLM review and repair of technical workflow |
| `phase4_dsl_builder` | Deterministic conversion to PILOT DSL |
| `validation` | Schema validation of generated DSL |
| `repair` | LLM repair attempts (if validation fails) |

### Database Storage

Sessions are stored in the `agent_prompt_workflow_generation_sessions` table with stages in `agent_prompt_workflow_generation_stages`. Each stage records:

- Input/output data (JSONB)
- AI provider and model used
- Token usage (prompt/completion)
- Latency in milliseconds
- Validation results
- Repair attempts

### System 1 ↔ System 2 Correlation

The `openaiThreadId` field enables log correlation between:

- **System 1**: Thread-based agent creation (Phases 1-4) stored in `agent_prompt_threads`
- **System 2**: V5 workflow generation stored in `agent_prompt_workflow_generation_sessions`

This allows tracing the complete journey from user prompt to executable DSL.

### Enabling Session Tracking

Session tracking is enabled via `V5GeneratorOptions`:

```typescript
const generator = new V5WorkflowGenerator(pluginManager, {
  connectedPlugins: [...],
  userId: 'user-123',
  sessionTracking: {
    enabled: true,
    userId: 'user-123',
    openaiThreadId: 'thread_abc123', // From System 1
  },
});

// After generation, retrieve session ID
const result = await generator.generateWorkflow(input);
console.log('Session ID:', result.sessionId);
```

### API Response

When session tracking is enabled, the `sessionId` is included in the generation result and API response:

```json
{
  "success": true,
  "dsl": { ... },
  "sessionId": "uuid-session-id",
  "workflowGenerationSessionId": "uuid-session-id"
}
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `lib/agentkit/v4/v5-generator.ts` | Main orchestrator, handles both input paths |
| `lib/agentkit/v4/utils/workflow-session-tracker.ts` | Session tracking helper for workflow generation diary |
| `lib/agentkit/v4/core/step-plan-extractor.ts` | LLM-based step extraction (Path A) |
| `lib/agentkit/v4/core/dsl-builder.ts` | Deterministic DSL construction (Path A) |
| `lib/agentkit/v4/core/phase4-dsl-builder.ts` | Deterministic DSL conversion from technical workflow (Path B) |
| `lib/validation/phase4-schema.ts` | Zod schemas and TypeScript types for TechnicalWorkflow (v14 prompt) |
| `lib/validation/technical-reviewer-schema.ts` | Zod schemas for Technical Reviewer response validation |
| `app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v14-chatgpt.txt` | Agent creation prompt (Phase 1-4) |
| `app/api/prompt-templates/Workflow-Agent-Technical-Reviewer-SystemPrompt-v2.txt` | Technical Reviewer system prompt |
| `app/api/prompt-templates/Workflow-Agent-Technical-Reviewer-UserPrompt-v2.txt` | Technical Reviewer user prompt |
| `app/api/test/generate-agent-v5-test-wrapper/route.ts` | Test API for V5 generator |
| `app/api/generate-agent-v4/route.ts` | Production API (V4/V5 via feature flag) |
| `lib/pilot/StepExecutor.ts` | Runtime step execution with transform output mapping, case normalization |
| `lib/utils/featureFlags.ts` | `useEnhancedTechnicalWorkflowReview()` function |
| `lib/repositories/SystemConfigRepository.ts` | `getAgentGenerationConfig()` for provider/model |
| `lib/agent-creation/agent-prompt-workflow-generation-session-repository.ts` | Repository for session/stage CRUD operations |
| `components/agent-creation/types/workflow-generation-session.ts` | TypeScript types for session tracking |

---

## Feature Flag Integration (Production)

The V5 generator is integrated into the production `/api/generate-agent-v4` endpoint via feature flag.

### Environment Variable

```env
# Server-side only (no NEXT_PUBLIC_ prefix)
USE_AGENT_GENERATION_ENHANCED_TECHNICAL_WORKFLOW_REVIEW=true
```

### System Config (Database)

| Key | Default | Category |
|-----|---------|----------|
| `agent_generation_ai_provider` | `"openai"` | `agent_creation` |
| `agent_generation_ai_model` | `"gpt-5.2"` | `agent_creation` |

### Behavior

| Flag | Technical Workflow Path | Enhanced Prompt Path |
|------|------------------------|---------------------|
| `false` (default) | V4: Skip LLM → DSLBuilder | V4: Stage 1 LLM → DSLBuilder |
| `true` | V5: LLM Review → DSLBuilder | V5: Stage 1 LLM → DSLBuilder |

See [V4_OPENAI_3STAGE_ARCHITECTURE.md](./V4_OPENAI_3STAGE_ARCHITECTURE.md#v5-enhancement-llm-technical-workflow-review) for full implementation details.

---

## Summary

The V5 Generator architecture achieves reliability through **separation of concerns**:

1. **LLM handles intent** (what the user wants)
2. **Deterministic builders guarantee correctness** (schema compliance)

### Path A (Enhanced Prompt)
```
Enhanced Prompt → StepPlanExtractor (LLM) → StepPlan → DSLBuilder.buildDSL() → PILOT_DSL
```

### Path B (Technical Workflow)
```
Technical Workflow → LLM Reviewer → Phase4DSLBuilder.build() → PILOT_DSL
```

This hybrid approach gives us the flexibility of LLMs with the reliability of deterministic systems.
