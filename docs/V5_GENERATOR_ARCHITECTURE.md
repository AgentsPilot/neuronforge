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
    };
  };
  analysis?: {
    agent_name?: string;
    description?: string;
  };
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

## Files Reference

| File | Purpose |
|------|---------|
| `lib/agentkit/v4/v5-generator.ts` | Main orchestrator, handles both input paths |
| `lib/agentkit/v4/core/step-plan-extractor.ts` | LLM-based step extraction (Path A) |
| `lib/agentkit/v4/core/dsl-builder.ts` | Deterministic DSL construction (both paths) |
| `lib/validation/phase4-schema.ts` | Zod schemas and TypeScript types for TechnicalWorkflow (v13 prompt) |
| `lib/validation/technical-reviewer-schema.ts` | Zod schemas for Technical Reviewer response validation |
| `app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v13-chatgpt.txt` | Agent creation prompt (Phase 1-4) |
| `app/api/prompt-templates/Workflow-Agent-Technical-Reviewer-SystemPrompt-v2.txt` | Technical Reviewer system prompt |
| `app/api/prompt-templates/Workflow-Agent-Technical-Reviewer-UserPrompt-v2.txt` | Technical Reviewer user prompt |
| `app/api/test/generate-agent-v5-test-wrapper/route.ts` | Test API for V5 generator |
| `app/api/generate-agent-v4/route.ts` | Production API (V4/V5 via feature flag) |
| `lib/utils/featureFlags.ts` | `useEnhancedTechnicalWorkflowReview()` function |
| `lib/repositories/SystemConfigRepository.ts` | `getAgentGenerationConfig()` for provider/model |

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
