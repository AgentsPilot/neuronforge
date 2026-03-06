# V6 Agent Generation System - API Reference

> **Last aligned to code**: 2026-02-20 (updated for bf425f7)

Complete API documentation for the V6 agent generation endpoints.

## Table of Contents

1. [Overview](#overview)
2. [Main Orchestration Endpoint](#main-orchestration-endpoint)
3. [Individual Phase Endpoints](#individual-phase-endpoints)
4. [Utility Endpoints](#utility-endpoints)
5. [Common Types](#common-types)
6. [Error Handling](#error-handling)

---

## Overview

### Base URL
All V6 endpoints are available under `/api/v6/`.

### Authentication
Most endpoints require a valid user session. Include the session cookie or authorization header.

### Content Type
All requests and responses use `application/json`.

---

## Main Orchestration Endpoint

### POST /api/v6/generate-ir-semantic

**Source**: [`app/api/v6/generate-ir-semantic/route.ts`](app/api/v6/generate-ir-semantic/route.ts)

This endpoint has **two modes** controlled by the `use_v6_orchestrator` flag:

| Mode | Flag | Pipeline | Used by |
|------|------|----------|---------|
| **Orchestrator** (recommended) | `use_v6_orchestrator: true` | P0 Requirements -> (P1/P2 skipped) -> P3 IR -> P4 Compile -> P5 PILOT | `test-v6-declarative.html` |
| **Legacy** | flag absent or `false` | P1 Semantic -> P1.5 Schema -> P2 Grounding -> P3 IR -> P4 Compile -> P5 Normalize | Direct API callers |

---

### Mode 1: V6 Orchestrator (Recommended)

**Purpose**: Full pipeline with hard requirements extraction, validation gates, provider fallback, and auto-recovery. This is the production-recommended path.

**Orchestrator class**: [`lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts`](lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts)

**Design philosophy**: Workflow creation is **compilation, not generation**. Following OpenAI's compiler approach, every transformation must be: Lossless, Traceable, Constraint-preserving, and Rejectable. A workflow that is executable but violates user intent **MUST be rejected**.

**Pipeline flow** (current architecture):

```
Enhanced Prompt
    |
    v
Phase 0: HardRequirementsExtractor.extract()      <- LLM call (admin-configured model)
    |   outputs: HardRequirements + RequirementMap
    v
[Phase 1 & 2 SKIPPED - code is block-commented]   <- Enhanced Prompt has all needed info
    |   saves ~3500 tokens and 15-30s of LLM time
    v
Phase 3: IRFormalizer.formalize()                  <- LLM call (admin-configured model)
    |   receives Enhanced Prompt directly (not semantic plan)
    |   Gate 3: validateIR() + PluginResolver auto-fix + AutoRecoveryHandler
    v
Phase 4: ExecutionGraphCompiler.compile()          <- deterministic (no LLM)
    |   topological sort -> node-by-node compilation
    |   Gate 4: validateCompilation()
    v
Phase 5: translateToPilotFormat()                  <- deterministic (no LLM)
    |   DSL step mapping -> flat PILOT array
    |   Gate 5: validateFinal() (intent satisfaction)
    v
Production PILOT Workflow (flat array of WorkflowStep[])
```

---

#### Phase 0: Hard Requirements Extraction (LLM)

**Class**: [`lib/agentkit/v6/requirements/HardRequirementsExtractor.ts`](lib/agentkit/v6/requirements/HardRequirementsExtractor.ts)

**What it does**: Uses an LLM to extract **machine-checkable constraints** from the Enhanced Prompt. These constraints are tracked through every subsequent phase to ensure nothing is lost during compilation.

**System prompt**: [`lib/agentkit/v6/requirements/prompts/hard-requirements-extraction-system.md`](lib/agentkit/v6/requirements/prompts/hard-requirements-extraction-system.md) — a detailed prompt with examples that instructs the LLM how to identify each requirement type.

**Default model**: `gpt-4o-mini` (fast, reliable for structured extraction). Configurable via admin config key `requirements`.

**LLM interaction**: Sends the full Enhanced Prompt JSON as the user message, receives structured JSON back. Supports both OpenAI (`response_format: json_object`) and Anthropic. Handles markdown code fences in the LLM response.

**Requirement types extracted**:

| Type | Description | Example |
|------|-------------|---------|
| `unit_of_work` | What entity is being iterated over | `email`, `attachment`, `row`, `file`, `record` |
| `threshold` | Conditional filter gating an action | `Stage == 4`, `amount > 50` |
| `routing_rule` | Deterministic data routing to destinations | `group_by=Sales Person → per_person_email` |
| `invariant` | Constraint that must never be violated | `sequential_dependency`, `no_duplicate_writes`, `data_availability` |
| `empty_behavior` | What to do when no data found | `fail`, `skip`, `notify` |
| `required_output` | Fields that must appear in final output | `["Date", "Name", "Email"]` |
| `side_effect_constraint` | Conditions gating when side effects can occur | `append_sheets only when amount > 50` |

**Outputs**:
- `HardRequirements` — the structured constraints object (see Common Types)
- `RequirementMap` — a tracking map `{ [R1]: { status: 'pending' }, [R2]: { status: 'pending' }, ... }` that records how each requirement flows through phases

**Fallback on error**: If the LLM call fails, returns empty requirements (pipeline continues but with no constraint enforcement). Does NOT crash the pipeline.

---

#### Phases 1 & 2: SKIPPED (Block-Commented)

**Current status**: Lines ~143–286 of [`V6PipelineOrchestrator.ts`](lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts) are wrapped in a `/* ... */` block comment. There is no feature flag — this is a code-level skip.

**Why skipped**: The Enhanced Prompt already contains structured sections (`data`, `actions`, `output`, `delivery`) with `specifics.services_involved` and `specifics.resolved_user_inputs`. Phases 1 & 2 were found to just **rephrase** what's already there, adding ~3,500 tokens of noise and 15–30 seconds of LLM time with no new information.

**What the commented code did**:
- **Phase 1** (`SemanticPlanGenerator.generate()`): LLM call to produce a semantic plan with assumptions, ambiguities, and reasoning trace. Gate 1 validated that all requirements had semantic mappings.
- **Phase 2** (Mock grounding): Created a mock `groundedPlan` with `grounding_confidence: 1.0`. Gate 2 passed all requirements through as `mock_grounded`.

**Downstream impact**: Since phases are skipped:
- `semanticPlan` and `groundedPlan` are returned as `undefined` in the response
- Gates 1 & 2 produce dummy PASS results: `{ stage: 'semantic', result: 'PASS', reason: 'SKIPPED (Week 1: ...)' }`
- The requirement map is updated directly from the IR's `requirements_enforcement` array instead of flowing through Gates 1 → 2 → 3

**Re-enabling**: Remove the `/* ... */` block comment. The code remains fully functional. The comment says: *"Do NOT delete this code until we achieve 'golden gate' (90%+ success)!"*

---

#### Phase 3: IR Formalization (LLM)

**Class**: [`lib/agentkit/v6/semantic-plan/IRFormalizer.ts`](lib/agentkit/v6/semantic-plan/IRFormalizer.ts)

**What it does**: Takes the Enhanced Prompt and mechanically maps it to a `DeclarativeLogicalIRv4` execution graph. This is the core LLM-heavy phase.

**Default model**: `claude-opus-4-6` at temperature `0.0` (deterministic formalization). Configurable via admin config key `formalization`.

**Key inputs passed to IRFormalizer**:
- `enhancedPrompt` — full Enhanced Prompt (sections + specifics)
- `hardReqs` — requirements from Phase 0 (used for `requirements_enforcement` tracking in the IR)
- `pluginManager` — for plugin schema injection (the LLM sees real action schemas)
- `servicesInvolved` — from `specifics.services_involved`, used to **filter** which plugin schemas are injected (token optimization)
- `resolvedUserInputs` — from `specifics.resolved_user_inputs`, injected as literal values

**Token optimization**: Instead of injecting all plugin schemas (~800 tokens each), only the plugins listed in `services_involved` are injected. For a system with 20 plugins but only 2 needed, this saves ~14,400 tokens.

**Formalization system prompt**: [`lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md`](lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md) — contains critical enforcement protocols:
- **Data Flow Reasoning Protocol**: Mandatory pre-flight validation before generating any node config
- **Transform on Non-Array prohibition**: Blocks `operation_type: "transform"` when input variable type is not `"array"` (would cause compilation failure)
- **Loop Collection enforcement**: Prevents transform nodes inside loops from referencing the loop's own output variable (which doesn't exist yet)
- **Nested Loop Variable Scope**: Enforces correct field resolution in email→attachment loops (e.g., `{{current_email.message_id}}` not `{{current_attachment.message_id}}`)
- **Field Reference Validation**: Every `{{variable.field}}` must be verified against the source plugin schema before generation

**Output**: `DeclarativeLogicalIRv4` with `ir_version: '4.0'`, an `execution_graph` of typed nodes, and `requirements_enforcement` tracking.

**Validation (Gate 3)**: After formalization, `ValidationGates.validateIR()` checks:
1. Every grounded requirement maps to at least one IR node
2. Unit of work is not flattened (e.g., `attachment` processing isn't collapsed to email-level)
3. Sequential dependencies are explicit in the graph
4. Thresholds occur before side effects
5. **Plugin operation auto-fix**: `PluginResolver` validates every `plugin_key + action` pair against the real plugin registry. Invalid operations are auto-fixed using semantic inference (e.g., `read_emails` → `search_messages`)

**Auto-recovery on Gate 3 failure**: If validation fails, `AutoRecoveryHandler.recover()` attempts structural fixes:
- `nested_groups` → flatten nested conditions
- `missing_field` → add default values
- `wrong_type` → coerce types
- `invalid_field` → remove invalid fields

After fixes, the IR is re-validated. If still failing, the pipeline returns an error.

**Requirement map update (Week 1 fix)**: Since Phases 1 & 2 are skipped, the requirement map is updated directly from `ir.requirements_enforcement[]` — each enforcement entry updates the corresponding requirement to `compiled` status with the `ir_node` reference.

**Error rethrow**: If the LLM call or validation throws, the error is **rethrown** (not caught) so the API route's `withProviderFallback()` can retry with a different provider.

---

#### Phase 4: Deterministic Compilation

**Class**: [`lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`](lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts)

**What it does**: Compiles the IR v4.0 execution graph into PILOT DSL workflow steps. **No LLM calls** — purely deterministic graph traversal.

**Compilation strategy**:
1. Validate IR version is `4.0` and execution graph exists
2. Validate the execution graph structure (cycles, orphans, missing nodes)
3. Perform **topological sort** to determine execution order
4. Traverse the graph from the `start` node
5. Compile each node by type:

| IR Node Type | Compiled PILOT Step Type | Description |
|-------------|-------------------------|-------------|
| `operation` (fetch) | `action` | Plugin API call with `plugin`, `action`, `params` |
| `operation` (transform) | `transform` | Data transformation with `operation`, `input`, `config` |
| `operation` (ai, type != `deterministic_extract`) | `ai_processing` | AI operation with `prompt`, `config.ai_type` |
| `operation` (ai, type == `deterministic_extract`) | `deterministic_extraction` | File extraction (PDF parser + Textract + AI) with `input`, `output_schema`, `prompt` |
| `operation` (deliver) | `action` | Delivery plugin call (same shape as fetch) |
| `operation` (file_op) | `action` | File operation (upload/download/generate) |
| `choice` | `conditional` | Branching with `condition`, `then[]`, `else[]` |
| `loop` | `scatter_gather` | Iteration with `scatter.input`, `scatter.steps[]`, `gather` |
| `parallel` | (expanded inline) | Parallel branches with `wait_strategy` |
| `end` | (no-op) | Marks graph termination |

6. Resolve `{{variable}}` references for data flow
7. Track plugin usage for the metadata

**Validation (Gate 4)**: `ValidationGates.validateCompilation()` checks:
1. Every `compiled` requirement maps to a DSL step
2. Thresholds have guard steps (filter/conditional/scatter_gather)
3. Routing rules have corresponding route/branch steps
4. Sequential dependencies are enforced by step ordering
5. On pass, requirement status is updated to `enforced`

---

#### Phase 5: PILOT Format Translation

**Method**: `V6PipelineOrchestrator.translateToPilotFormat()` (private, in [`V6PipelineOrchestrator.ts`](lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts) lines ~637–749)

**What it does**: Converts the compiled DSL steps into production PILOT format. This is the final normalization before output.

**Key transformations per step type**:

| From (DSL) | To (PILOT) | Details |
|-----------|-----------|---------|
| `step_id` | `id` | Underscores removed (`step_1` → `step1`) |
| `description` | `name` | Title-cased from description or auto-generated from operation |
| `operation` (action) | `action` | Field renamed: `operation` → `action`, `config` → `params` |
| `config.input` (transform) | `input` (top-level) | Input moved from nested config to top-level |
| `config.filters` (filter) | `config.condition` | Filter config restructured |
| `steps` (conditional then) | `then` | DSL `steps` → PILOT `then` |
| `else_steps` (conditional) | `else` | DSL `else_steps` → PILOT `else` |
| `scatter.steps` | `scatter.steps` (recursively translated) | Nested steps are recursively run through `translateStep()` |

**Step name generation** (`generateStepName()`): If the step has a `description`, uses the first segment before `:`, title-cased. Otherwise generates from type + operation (e.g., `search_messages` → `Search Messages`). Fallback: title-case the `step_id`.

**Validation (Gate 5 — Final)**: `ValidationGates.validateFinal()` checks **intent satisfaction**:
1. All requirements are in `enforced` status (no `pending`, `mapped`, or `compiled` leftovers)
2. Side effect constraints have guards — recursively searches through nested `scatter_gather` and `conditional` steps
3. Sequential invariants are enforced by DSL step ordering
4. No parallel execution of dependent steps (steps with `{{step_result.*}}` references can't be in parallel)

If Gate 5 fails, the pipeline returns: *"Intent not satisfied: workflow could do the wrong thing"*

---

#### Admin Configuration

**Service**: [`lib/agentkit/v6/config/AgentGenerationConfigService.ts`](lib/agentkit/v6/config/AgentGenerationConfigService.ts)

**How it works**: The orchestrator calls `getAgentGenerationConfig()` at the start of each run. This reads per-phase model settings from the `system_settings_config` Supabase table (keys matching `agent_generation_phase_%`).

**Caching**: In-memory cache with **5-minute TTL**. Non-blocking — returns cached or default config immediately.

**Default configuration** (when database is unavailable):

| Phase | Provider | Model | Temperature |
|-------|----------|-------|-------------|
| Requirements (P0) | `openai` | `gpt-4o-mini` | `0.0` |
| Semantic (P1, currently skipped) | `anthropic` | `claude-opus-4-6` | `0.3` |
| Formalization (P3) | `anthropic` | `claude-opus-4-6` | `0.0` |

**Config priority**: Client-provided `config` in the request body > Admin config from database > Hardcoded defaults.

**Admin UI**: `GET /api/admin/agent-generation-config` returns the current config (see Utility Endpoints).

---

#### Provider Fallback (API Route Level)

**Utility**: [`lib/agentkit/v6/utils/ProviderFallback.ts`](lib/agentkit/v6/utils/ProviderFallback.ts) — `withProviderFallback()`

**When active**: Only when the client provides a `config` object in the request. When no config is provided, the orchestrator uses admin config per phase (no fallback wrapping).

**How it works**:
1. Runs the **entire orchestrator pipeline** (`orchestrator.run()`) with the primary provider
2. On retryable error (429, 529, 5xx, timeout, overload), retries with exponential backoff: `1s → 2s` (1 retry = 2 attempts per provider)
3. If primary provider exhausted, switches to secondary provider (Anthropic ↔ OpenAI) and repeats
4. Returns `RetryResult<PipelineResult>` with metadata: `provider`, `attemptsUsed`, `fellBackToSecondary`, `totalDurationMs`

**Important**: The fallback wraps the **full pipeline**, not individual phases. A Phase 3 error causes a full pipeline retry from Phase 0.

---

#### Requirement Lineage Tracking

Throughout the pipeline, each requirement flows through a tracked lifecycle:

```
Phase 0: pending → (RequirementMap created, all requirements start as 'pending')
    |
Phase 1 (skipped): pending → mapped     (would set semantic_construct)
Phase 2 (skipped): mapped → grounded    (would set grounded_capability)
    |
    v   [Week 1 fix: updated directly from IR's requirements_enforcement]
Phase 3: pending → compiled              (sets ir_node from enforcement tracking)
    |
Phase 4: compiled → enforced             (sets dsl_step)
    |
Phase 5: Gate 5 checks ALL are enforced  (rejects if any are not)
```

The `getLineageTrace()` method returns the full journey of each requirement for debugging:

```typescript
orchestrator.getLineageTrace(requirementMap, hardReqs)
// Returns: [{ id: "R1", type: "threshold", constraint: "...", status: "enforced",
//            semantic_construct: null, grounded_capability: null, ir_node: "node_2, node_3", dsl_step: "step_5" }]
```

#### Orchestrator Request

```typescript
interface GenerateIRSemanticRequest {
  // Required
  enhanced_prompt: EnhancedPrompt   // See Common Types below

  // Required for orchestrator mode
  use_v6_orchestrator: true

  // Optional: user ID for plugin connection lookup
  userId?: string

  // Optional: override admin config for all phases (testing only)
  config?: {
    provider?: 'openai' | 'anthropic'
    model?: string
    understanding_temperature?: number
    formalization_temperature?: number
    max_tokens?: number
  }
}
```

#### Orchestrator Response (Success)

```typescript
{
  success: true

  // Phase 5: Production PILOT workflow (flat array of steps)
  workflow: WorkflowStep[]

  // Phase 0: Hard requirements extracted from prompt
  hard_requirements: {
    requirements: Array<{
      id: string            // e.g. "R1", "R2"
      type: string          // e.g. "threshold", "invariant", "routing_rule"
      constraint: string    // human-readable constraint
      source: string        // which section it came from
    }>
    unit_of_work: string | null   // e.g. "email message"
    thresholds: Array<{ field: string; operator: string; value: any }>
    invariants: string[]
    routing_rules: any[]
  }

  // Requirement enforcement tracking (Phase 0 -> Phase 5)
  requirement_map: Record<string, {
    status: 'pending' | 'mapped' | 'compiled' | 'enforced'
    semantic_construct?: string
    grounded_capability?: string
    ir_node?: string
    dsl_step?: string
  }>

  // All 5 gate results
  validation_results: {
    semantic:    { stage: string; result: 'PASS'; reason: 'SKIPPED (Week 1: ...)' }
    grounding:   { stage: string; result: 'PASS'; reason: 'SKIPPED (Week 1: ...)' }
    ir:          { stage: string; result: 'PASS' | 'FAIL'; reason?: string }
    compilation: { stage: string; result: 'PASS' | 'FAIL'; reason?: string }
    final:       { stage: string; result: 'PASS' | 'FAIL'; reason?: string }
  }

  // Intermediate phase outputs (for debugging)
  phase1_semantic_plan: undefined     // skipped
  phase2_grounded_plan: undefined     // skipped
  phase3_ir: DeclarativeLogicalIRv4   // full IR with execution_graph
  phase4_dsl_before_translation: WorkflowStep[]  // DSL before PILOT translation

  // Compilation diagnostics
  compilation_logs: string[]    // informational messages from compiler
  compilation_errors: string[]  // errors encountered during compilation

  // Metadata
  metadata: {
    pipeline_version: 'v6_orchestrator'
    execution_time_ms: number
    total_requirements: number
    requirements_enforced: number
    unit_of_work: string | null
    workflow_steps: number
    gates_passed: 5
    provider_used: 'anthropic' | 'openai' | 'admin-config'
    provider_fallback: boolean
    retry_attempts: number
    fallback_duration_ms: number
  }
}
```

#### Orchestrator Response (Error)

```typescript
{
  success: false
  error: string           // e.g. "V6 pipeline failed after retries and fallback"
  details?: string        // error message
  phase?: string          // which phase failed (e.g. "requirements_extraction", "ir", "compilation")

  // Partial results available for debugging
  hard_requirements?: HardRequirements
  requirement_map?: RequirementMap
  phase1_semantic_plan?: undefined
  phase2_grounded_plan?: undefined
  phase3_ir?: DeclarativeLogicalIRv4
  validation_results?: any
  compilation_errors?: string[]

  metadata?: {
    provider_used: string
    provider_fallback: boolean
    retry_attempts: number
    fallback_duration_ms: number
  }
}
```

#### Orchestrator Example

```bash
curl -X POST http://localhost:3000/api/v6/generate-ir-semantic \
  -H "Content-Type: application/json" \
  -d '{
    "enhanced_prompt": {
      "sections": {
        "data": ["Read emails from Gmail from the last 7 days"],
        "actions": ["Filter emails containing keywords: complaint, refund, angry"],
        "output": ["Append matching emails with sender, subject, date, body, link"],
        "delivery": ["Write to Google Sheets spreadsheet ID abc123, tab UrgentEmails"]
      },
      "specifics": {
        "services_involved": ["google-mail", "google-sheets"],
        "resolved_user_inputs": [
          { "key": "filter_keywords", "value": ["complaint", "refund", "angry"] },
          { "key": "spreadsheet_id", "value": "abc123" }
        ]
      }
    },
    "userId": "offir.omer@gmail.com",
    "use_v6_orchestrator": true
  }'
```

---

### Mode 2: Legacy 5-Phase (Non-Orchestrator)

**Purpose**: Original sequential pipeline. Still runs all 5 phases including semantic planning and grounding. Activated when `use_v6_orchestrator` is not set.

**Pipeline flow**:

```
Enhanced Prompt
    |
    v
Phase 1:   SemanticPlanGenerator.generate()       <- LLM call
Phase 1.5: Plugin schema extraction (no auth)     <- deterministic
Phase 2:   GroundingEngine.ground()                <- deterministic (fuzzy matching)
Phase 3:   IRFormalizer.formalize()                <- LLM call
Phase 4:   ExecutionGraphCompiler.compile()        <- deterministic
Phase 5:   PilotNormalizer.stableResponseEnvelope() <- deterministic
```

#### Legacy Request

```typescript
{
  // Required
  enhanced_prompt: EnhancedPrompt

  // Optional: data source metadata for grounding
  data_source_metadata?: {
    type: 'tabular' | 'api'
    headers?: string[]
    fields?: Array<{ name: string; description?: string; type?: string }>
    sample_rows?: Record<string, any>[]
    plugin_key?: string
  }

  // Optional: auto-fetch metadata using authenticated plugin
  userId?: string
  data_source_config?: {
    plugin_key: string
    action_name?: string
    parameters: Record<string, any>
  }

  // Optional: configuration
  config?: {
    provider?: 'openai' | 'anthropic'        // Default: 'anthropic'
    model?: string                           // Default: provider-specific
    understanding_temperature?: number       // Default: 0.3
    formalization_temperature?: number       // Default: 0.0
    grounding_min_confidence?: number        // Default: 0.7
    return_intermediate_results?: boolean    // Default: true
    intent_category?: 'api' | 'tabular'
    validate_plugins?: boolean
    max_tokens?: number
  }
}
```

#### Legacy Response (Success)

```typescript
{
  success: true

  workflow: {
    workflow_steps: WorkflowStep[]
    suggested_plugins: string[]
  }

  validation: {
    valid: boolean
    issues: any[]
    autoFixed: boolean
    issueCount: number
  }

  ir: DeclarativeLogicalIRv4    // Full IR for debugging

  intermediate_results?: {       // when return_intermediate_results: true
    semantic_plan: SemanticPlan
    grounded_plan: GroundedSemanticPlan
    grounded_facts: Record<string, any>
    formalization_metadata: FormalizationMetadata
    validation: { valid: boolean; errors: any[]; warnings: any[] }
  }

  pipeline_context: {
    semantic_plan: { goal: string; understanding: any; reasoning_trace: any[] }
    grounded_facts: Record<string, any>
    formalization_metadata: FormalizationMetadata
  }

  metadata: {
    architecture: 'semantic_plan_5_phase'
    provider: string
    model: string
    total_time_ms: number
    phase_times_ms: {
      understanding: number
      grounding: number
      formalization: number
      compilation: number
      normalization: number
    }
    grounding_confidence: number
    formalization_confidence: number
    validated_assumptions: number
    total_assumptions: number
    grounded_facts_count: number
    missing_facts_count: number
    steps_generated: number
    plugins_used: string[]
    timestamp: string
  }
}
```

#### Legacy Example

```bash
curl -X POST http://localhost:3000/api/v6/generate-ir-semantic \
  -H "Content-Type: application/json" \
  -d '{
    "enhanced_prompt": {
      "sections": {
        "data": ["Read emails from Gmail from the last 7 days"],
        "actions": ["Categorize each email as urgent, normal, or low priority"],
        "delivery": ["Write results to Google Sheets"]
      },
      "specifics": {
        "services_involved": ["google-mail", "google-sheets"]
      }
    },
    "config": {
      "return_intermediate_results": true
    }
  }'
```

---

## Individual Phase Endpoints

### POST /api/v6/generate-semantic-plan

**Purpose**: Phase 1 only - Generate semantic plan from enhanced prompt.

#### Request

```typescript
{
  enhanced_prompt: EnhancedPrompt
  config?: {
    provider?: 'openai' | 'anthropic'
    model?: string
    temperature?: number   // Default: 0.3
    max_tokens?: number    // Default: 6000
  }
}
```

#### Response

```typescript
{
  success: boolean
  semantic_plan?: SemanticPlan
  metadata: {
    phase: 'understanding'
    provider: string
    model: string
    timestamp: string
  }
  error?: string
  details?: string
}
```

---

### POST /api/v6/ground-semantic-plan

**Purpose**: Phase 2 only - Validate semantic plan assumptions against real data.

#### Request

```typescript
{
  semantic_plan: SemanticPlan
  data_source_metadata: {
    type: 'tabular' | 'api'
    headers?: string[]
    fields?: Array<{ name: string; description?: string }>
    sample_rows?: Record<string, any>[]
  }
  config?: {
    min_confidence?: number              // Default: 0.7
    fail_fast?: boolean                  // Default: false
    require_confirmation_threshold?: number // Default: 0.85
    max_candidates?: number              // Default: 3
  }
}
```

#### Response

```typescript
{
  success: boolean
  grounded_plan?: GroundedSemanticPlan
  grounded_facts?: Record<string, any>
  metadata: {
    phase: 'grounding'
    validated_count: number
    total_count: number
    confidence: number
    errors_count: number
    timestamp: string
  }
  error?: string
}
```

---

### POST /api/v6/formalize-to-ir

**Purpose**: Phase 3 only - Convert grounded semantic plan (or Enhanced Prompt) to Declarative IR v4.

#### Request

```typescript
{
  grounded_plan: GroundedSemanticPlan   // or EnhancedPrompt in orchestrator mode
  config?: {
    model?: string         // Default: admin-configured
    temperature?: number   // Default: 0.0
    max_tokens?: number    // Default: 4000
  }
}
```

#### Response

```typescript
{
  success: boolean
  ir?: DeclarativeLogicalIRv4
  formalization_metadata?: {
    provider: string
    model: string
    grounded_facts_used: Record<string, any>
    missing_facts: string[]
    formalization_confidence: number
    timestamp: string
  }
  error?: string
}
```

---

### POST /api/v6/compile-declarative *(DISABLED)*

> **Status**: Route file renamed to `route.ts.disabled` — not currently active. The orchestrator mode handles compilation internally via `ExecutionGraphCompiler`.

**Purpose**: Phase 4 - Compile Declarative IR v4 to PILOT DSL workflow.

#### Request

```typescript
{
  ir: DeclarativeLogicalIRv4
  userId?: string
  agentId?: string
  pipeline_context?: {
    semantic_plan?: {
      goal: string
      understanding?: any
      reasoning_trace?: any[]
    }
    grounded_facts?: Record<string, any>
    formalization_metadata?: {
      grounded_facts_used: Record<string, any>
      missing_facts: string[]
      formalization_confidence: number
    }
  }
  compiler_config?: {
    provider?: 'openai' | 'anthropic'
    model?: string
  }
}
```

#### Response

```typescript
{
  success: boolean
  workflow?: WorkflowStep[]
  dsl?: {
    pilot_dsl_version: string
    workflow: {
      id: string
      name: string
      description: string
      steps: WorkflowStep[]
    }
    metadata: any
  }
  validation?: {
    valid: boolean
    errors?: any[]
  }
  metadata?: {
    compilation_time_ms: number
    step_count: number
    plugins_used: string[]
    compiler_used?: string
    fallback_reason?: string
  }
  errors?: string[]
}
```

---

### POST /api/v6/execute-test

**Purpose**: Execute a compiled PILOT workflow against real plugins in sandbox mode.

#### Request

```typescript
{
  workflow: WorkflowStep[]       // PILOT workflow steps array
  plugins_required: string[]     // Plugin keys needed (e.g. ["google-mail", "google-sheets"])
  user_id: string                // User ID for plugin auth
  workflow_name?: string         // Display name
  input_variables?: Record<string, any>  // Runtime variables
}
```

#### Response

```typescript
{
  success: boolean
  data?: {
    stepsCompleted: number
    stepsFailed: number
    completedStepIds: string[]
    failedStepIds: string[]
    execution_time_ms: number
    tokens_used?: number
  }
  error?: string
}
```

---

### POST /api/v6/generate-workflow-validated

**Purpose**: Alternative pipeline with explicit validation gates and auto-recovery. Used by the "Run with Validation & Auto-Recovery" button in the test page.

#### Request

```typescript
{
  enhanced_prompt: EnhancedPrompt
  config?: {
    provider?: 'openai' | 'anthropic'
    model?: string
    temperature?: number
  }
}
```

#### Response

```typescript
{
  success: boolean
  workflow?: { steps: WorkflowStep[] }
  hard_requirements?: {
    count: number
    unit_of_work: string
    thresholds_count: number
    invariants_count: number
  }
  validation_results?: {
    semantic: 'PASS' | 'FAIL'
    grounding: 'PASS' | 'FAIL'
    ir: 'PASS' | 'FAIL'
    compilation: 'PASS' | 'FAIL'
    final: 'PASS' | 'FAIL'
  }
  metadata?: {
    pipeline_complete: boolean
    enforced_requirements: number
    auto_recovery_applied?: boolean
    recovery_details?: string
  }
  error?: {
    phase: string
    message: string
  }
}
```

---

## Utility Endpoints

### POST /api/v6/generate-declarative-ir *(DISABLED)*

> **Status**: Route file renamed to `route.ts.disabled` — not currently active. Use the orchestrator mode of `/api/v6/generate-ir-semantic` instead.

**Purpose**: Generate Declarative IR directly from enhanced prompt (skips semantic plan phase).

#### Request

```typescript
{
  enhanced_prompt: EnhancedPrompt
  config?: {
    provider?: 'openai' | 'anthropic'
    model?: string
    temperature?: number
  }
}
```

---

### POST /api/v6/generate-workflow-plan

**Purpose**: Generate a workflow plan (for planning mode).

#### Request

```typescript
{
  enhanced_prompt: EnhancedPrompt
  userId?: string
  config?: {
    provider?: string
    model?: string
  }
}
```

---

### POST /api/v6/update-workflow-plan

**Purpose**: Update an existing workflow plan with modifications.

#### Request

```typescript
{
  existing_plan: any
  modifications: string[]
  userId?: string
}
```

---

### POST /api/v6/fetch-plugin-data

**Purpose**: Fetch data from a plugin for metadata/grounding purposes.

#### Request

```typescript
{
  userId: string
  plugin_key: string
  action_name: string
  parameters: Record<string, any>
  limit?: number
}
```

#### Response

```typescript
{
  success: boolean
  data?: any
  metadata?: {
    headers?: string[]
    row_count?: number
    sample_rows?: any[]
  }
  error?: string
}
```

---

### GET /api/admin/agent-generation-config

**Purpose**: Fetch admin-configured model settings per pipeline phase. Used by the test page to display which models will be used. The orchestrator fetches this internally.

#### Response

```typescript
{
  success: boolean
  config: {
    requirements: { provider: string; model: string; temperature: number }
    semantic:     { provider: string; model: string; temperature: number }
    formalization:{ provider: string; model: string; temperature: number }
  }
}
```

---

## Common Types

### EnhancedPrompt

```typescript
interface EnhancedPrompt {
  sections: {
    data: string[]              // Required: data source descriptions
    actions?: string[]          // Optional: operations to perform
    output?: string[]           // Optional: output format specs
    delivery: string[]          // Required: delivery destinations
    processing_steps?: string[] // Optional: explicit processing steps
  }
  user_context?: {
    original_request: string    // The user's original input
    clarifications?: Record<string, string>
  }
  specifics?: {
    services_involved?: string[]  // Plugin keys (e.g. ['google-mail', 'google-sheets'])
    user_inputs_required?: any[]  // Inputs still needed from user
    resolved_user_inputs?: Array<{  // CRITICAL: resolved values for filter rules, IDs, etc.
      key: string                    // e.g. "filter_keywords", "spreadsheet_id"
      value: any                     // e.g. ["complaint", "refund"], "abc123"
    }>
  }
}
```

**Source**: [`lib/agentkit/v6/semantic-plan/SemanticPlanGenerator.ts`](lib/agentkit/v6/semantic-plan/SemanticPlanGenerator.ts) (lines 38-59)

### DeclarativeLogicalIRv4

The IR uses an **execution graph** architecture (v4.0) replacing the flat v3.0 structure.

**Source**: [`lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4.ts`](lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4.ts)

```typescript
interface DeclarativeLogicalIRv4 {
  ir_version: '3.0' | '4.0'    // '4.0' for execution graph
  goal: string

  // V4.0: Execution graph (when ir_version === '4.0')
  execution_graph?: {
    start: string                           // Entry point node ID
    nodes: Record<string, ExecutionNode>    // Flat node map
    data_schema?: WorkflowDataSchema        // Field-level type declarations for all data flow
  }

  // Context from previous phases
  context?: {
    enhanced_prompt?: any
    semantic_plan?: any
    grounding_results?: any[]
    hard_requirements?: HardRequirements    // Embedded from Phase 0
  }

  // Requirement enforcement tracking
  requirements_enforcement?: Array<{
    requirement_id: string                  // e.g. "R1"
    enforced_by: {
      node_ids: string[]                    // Which nodes enforce it
      enforcement_mechanism: 'choice' | 'sequence' | 'input_binding' | 'output_capture'
    }
    validation_passed: boolean
  }>
}
```

#### ExecutionNode

```typescript
interface ExecutionNode {
  id: string
  type: 'operation' | 'choice' | 'parallel' | 'loop' | 'end'

  // Type-specific configs (discriminated union)
  operation?: {
    operation_type: 'fetch' | 'transform' | 'ai' | 'deliver' | 'file_op'
    fetch?: { plugin_key: string; action: string; config?: Record<string, any> }
    transform?: { type: 'map' | 'filter' | 'reduce' | 'group_by' | 'sort' | 'deduplicate'; input: string; ... }
    ai?: { type: 'summarize' | 'extract' | 'deterministic_extract' | 'classify' | 'sentiment' | 'generate' | 'decide' | 'normalize' | 'transform' | 'validate' | 'enrich'; instruction: string; ... }
    deliver?: { plugin_key: string; action: string; config?: Record<string, any> }
    file_op?: { type: 'upload' | 'download' | 'generate'; ... }
  }
  choice?: { rules: ChoiceRule[]; default: string }
  loop?: { iterate_over: string; item_variable: string; body_start: string; collect_outputs?: boolean; collect_from?: string }
  parallel?: { branches: ParallelBranch[]; wait_strategy: 'all' | 'any' | 'n' }

  // Control flow
  next?: string | string[]

  // Data flow
  inputs?: Array<{ variable: string; path?: string; required?: boolean }>
  outputs?: Array<{ variable: string; path?: string }>

  // Error handling
  error_handler?: {
    strategy: 'fail' | 'continue' | 'retry' | 'fallback'
    retry_config?: { max_attempts: number; backoff: 'linear' | 'exponential'; initial_delay_ms: number }
  }

  description?: string
}
```

### WorkflowStep (PILOT Format)

The output format after Phase 5 translation. This is what gets stored in `agents.pilot_steps`.

```typescript
interface WorkflowStep {
  id: string           // e.g. "step1" (underscores removed from step_id)
  step_id: string      // same as id (kept for compatibility)
  name: string         // human-readable name (auto-generated from description or operation)
  type: 'action' | 'transform' | 'ai_processing' | 'deterministic_extraction' | 'scatter_gather' | 'conditional'

  // For action steps
  plugin?: string      // e.g. "google-mail"
  action?: string      // e.g. "search_messages" (mapped from IR's `operation` field)
  params?: Record<string, any>   // mapped from IR's `config` field

  // For transform steps
  operation?: string   // e.g. "filter", "map"
  input?: string       // e.g. "{{step1.data.emails}}"
  config?: Record<string, any>

  // For ai_processing steps
  prompt?: string
  config?: {
    ai_type?: string
    output_schema?: any
    temperature?: number
  }

  // For deterministic_extraction steps (file extraction: PDF parser + Textract + AI)
  // input?: string            // variable reference to file data (e.g. "{{attachment_data}}")
  // prompt?: string           // extraction instruction
  // output_schema?: any       // JSON Schema for structured output

  // For scatter_gather (loop) steps
  scatter?: {
    input: string
    itemVariable: string
    steps: WorkflowStep[]   // nested steps (recursively translated)
  }
  gather?: { operation: 'collect' | 'merge' | 'reduce'; from?: string }

  // For conditional steps
  condition?: ConditionExpression
  then?: WorkflowStep[]      // mapped from IR's `steps` or `then`
  else?: WorkflowStep[]      // mapped from IR's `else_steps` or `else`

  // Common
  output_variable?: string
  description?: string
}
```

### SemanticPlan

```typescript
interface SemanticPlan {
  plan_version: string
  goal: string

  understanding: {
    data_sources: {
      name: string
      type: 'tabular' | 'api'
      plugin_key?: string
      search_criteria?: any
    }[]
    operations: {
      type: string
      description: string
      inputs: string[]
      output: string
    }[]
    delivery: {
      destination: string
      format: string
      plugin_key?: string
    }
  }

  assumptions: {
    id: string
    category: 'field_name' | 'data_type' | 'value_format' | 'structure' | 'behavior'
    description: string
    impact_if_wrong: 'critical' | 'major' | 'minor'
    fallback?: string
    validation_strategy: {
      method: 'field_match' | 'data_sample' | 'pattern_match' | 'heuristic'
      parameters?: {
        candidates?: string[]
        expected_type?: string
        pattern?: string
      }
    }
  }[]

  ambiguities: {
    id: string
    description: string
    possible_interpretations: string[]
    default_choice: string
    reasoning: string
  }[]

  inferences: {
    id: string
    conclusion: string
    based_on: string[]
    confidence: 'high' | 'medium' | 'low'
  }[]

  reasoning_trace: {
    step: number
    thought: string
    choice_made: string
    reasoning: string
  }[]
}
```

### HardRequirements (Phase 0 Output)

```typescript
interface HardRequirements {
  requirements: Array<{
    id: string          // e.g. "R1"
    type: string        // e.g. "threshold", "invariant", "routing_rule", "side_effect_constraint"
    constraint: string  // human-readable description
    source: string      // which section it came from
  }>
  unit_of_work: string | null      // e.g. "email message", "spreadsheet row"
  thresholds: Array<{
    field: string
    operator: string
    value: any
  }>
  invariants: string[]
  routing_rules: any[]
}
```

**Source**: [`lib/agentkit/v6/requirements/HardRequirementsExtractor.ts`](lib/agentkit/v6/requirements/HardRequirementsExtractor.ts)

### ProviderConfig / RetryResult

```typescript
interface ProviderConfig {
  provider: 'anthropic' | 'openai'
  model?: string
  temperature?: number
  max_tokens?: number
}

interface RetryResult<T> {
  success: boolean
  data?: T
  error?: any
  attemptsUsed: number
  provider: 'anthropic' | 'openai'
  fellBackToSecondary: boolean
  totalDurationMs: number
}
```

**Source**: [`lib/agentkit/v6/utils/ProviderFallback.ts`](lib/agentkit/v6/utils/ProviderFallback.ts)

---

## Error Handling

### Standard Error Response

```typescript
{
  success: false
  error: string           // Short error message
  details?: string        // Detailed error information
  phase?: string          // Which phase failed
  suggestions?: string[]  // How to fix the error
  stack?: string          // Stack trace (development only)
}
```

### Common Error Codes

| HTTP Status | Meaning |
|-------------|---------|
| 400 | Bad Request - Invalid input structure, or pipeline completed but compilation failed |
| 401 | Unauthorized - Missing or invalid authentication |
| 403 | Forbidden - User lacks permission |
| 422 | Unprocessable Entity - Semantic validation failed |
| 500 | Internal Server Error - Unexpected error or orchestrator initialization failure |
| 504 | Gateway Timeout - LLM call timed out |

### Phase-Specific Errors

**Phase 0 (Requirements Extraction)**:
- `Hard requirements extraction failed`: LLM failed to extract requirements from prompt

**Phase 1 (Understanding)** *(legacy path only, skipped in orchestrator)*:
- `JSON parse error`: LLM returned invalid JSON
- `Schema validation failed`: Output doesn't match semantic plan schema

**Phase 2 (Grounding)** *(legacy path only, skipped in orchestrator)*:
- `No matching field found`: Field name couldn't be resolved
- `Insufficient validation`: >50% of assumptions skipped

**Phase 3 (Formalization)**:
- `IR formalization failed - no IR generated`: LLM didn't produce valid IR
- `IR formalization failed - execution_graph missing or empty`: IR missing required graph structure
- `Invalid plugin_key`: Plugin doesn't exist in registry
- `Invalid operation_type`: Action doesn't exist on plugin
- Error is **rethrown** to enable provider fallback retry

**Phase 4 (Compilation)**:
- `DSL compilation failed`: Compiler couldn't process the IR
- `Compilation validation failed`: Gate 4 check failed

**Phase 5 (Final Validation)**:
- `Workflow violates intent`: Gate 5 detected that the workflow doesn't satisfy requirements

### Provider Fallback Errors

When the orchestrator exhausts all retries and fallback:

```typescript
{
  success: false
  error: 'V6 pipeline failed after retries and fallback'
  details: '...'
  metadata: {
    attempts: number
    fell_back_to: 'openai' | null
    duration_ms: number
  }
}
```

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [V6_OVERVIEW.md](./V6_OVERVIEW.md) | High-level V6 introduction |
| [V6_ARCHITECTURE.md](./V6_ARCHITECTURE.md) | Phase-by-phase technical details |
| [V6_TEST_DECLARATIVE.md](./V6_TEST_DECLARATIVE.md) | Test page documentation |
| [V6_DEVELOPER_GUIDE.md](./V6_DEVELOPER_GUIDE.md) | Integration and debugging guide |

---

*V6 Pipeline Orchestrator - Neuronforge*
